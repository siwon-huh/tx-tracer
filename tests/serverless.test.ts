import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../server/app";
import { createRateLimiter } from "../server/rate-limit";
import { jsonFetch } from "../server/http";
import { investigate } from "../server/investigate";
import { trace } from "../server/trace";
import { normalizeLifi } from "../server/adapters/lifi";
import { RpcPool } from "../server/rpc";
import { withSearchBudget, searchSignal, waitForSearch, SEARCH_TIMEOUT_MESSAGE } from "../server/search-context";
import type { TraceResult } from "../shared/types";

const hash = (char: string) => `0x${char.repeat(64)}`;
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
const empty = (query: string): TraceResult => ({ query, kind: "transaction", routes: [], candidates: [], diagnostics: [], warnings: [], fetchedAt: new Date().toISOString(), elapsedMs: 0, searchedChains: [] });
async function listen(t: any, app: ReturnType<typeof createApp>) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
const post = (base: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api/trace`, {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});

test("API responds from bundled snapshots and registers refresh work without blocking the response", async t => {
  let finish!: () => void;
  let task: Promise<unknown> | undefined;
  const base = await listen(t, createApp({
    refresh: () => new Promise<void>(resolve => { finish = resolve; }),
    backgroundTask: value => { task = value; },
  }));
  const config = await fetch(`${base}/api/config`);
  assert.equal(config.status, 200);
  assert.equal(config.headers.get("cache-control"), "no-store");
  assert.ok((await config.json()).chains.some((chain: any) => chain.name === "Tron"));
  assert.ok(task);
  finish(); await task;
  assert.equal((await (await fetch(`${base}/api/health`)).json()).status, "ok");
});

test("unknown API paths, invalid JSON, oversized bodies and malformed origins return JSON errors", async t => {
  const base = await listen(t, createApp({ trace: async () => empty("test") }));
  const unknown = await fetch(`${base}/api/missing`);
  assert.equal(unknown.status, 404); assert.ok((await unknown.json()).error);
  const large = await post(base, { query: "x".repeat(5000) });
  assert.equal(large.status, 413); assert.ok((await large.json()).error);
  const invalid = await fetch(`${base}/api/trace`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  assert.equal(invalid.status, 400); assert.ok((await invalid.json()).error);
  for (const origin of ["null", "not-a-url", "https://another-site.example"]) {
    const denied = await post(base, {}, { Origin: origin });
    assert.equal(denied.status, 403); assert.ok((await denied.json()).error);
  }
  assert.equal((await post(base, {}, { Origin: base })).status, 200);
});

test("local deployment ignores forged proxy IP headers and rate limits with Retry-After", async t => {
  const base = await listen(t, createApp({ rateLimit: createRateLimiter({}), trace: async () => empty("test") }));
  for (let i = 0; i < 15; i++) assert.equal((await post(base, {}, { "x-real-ip": `192.0.2.${i}` })).status, 200);
  const denied = await post(base, {}, { "x-real-ip": "203.0.113.5" });
  assert.equal(denied.status, 429); assert.ok(Number(denied.headers.get("retry-after")) > 0);
});

test("optional Redis limiter shares counters across instances and does not send raw IP addresses", async t => {
  const counts = new Map<string, number>();
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    const command = JSON.parse(String(options.body));
    assert.equal(command[0], "EVAL"); assert.equal(command[2], "1");
    assert.doesNotMatch(command[3], /192\.0\.2\.1/);
    const count = (counts.get(command[3]) || 0) + 1;
    counts.set(command[3], count);
    return response({ result: [count, 60_000] });
  });
  const env = { UPSTASH_REDIS_REST_URL: "https://redis.example", UPSTASH_REDIS_REST_TOKEN: "test-token" };
  const a = createRateLimiter(env), b = createRateLimiter(env);
  for (let i = 0; i < 15; i++) assert.equal((await (i % 2 ? a : b)("192.0.2.1")).allowed, true);
  assert.equal((await b("192.0.2.1")).allowed, false);
  assert.equal((await b("192.0.2.2")).allowed, true);
});

test("configured limiter outage is a recoverable 503 and releases the instance slot", async t => {
  let broken = true;
  const base = await listen(t, createApp({ rateLimit: async () => {
    if (broken) throw new Error("private store detail");
    return { allowed: true, retryAfter: 0 };
  }, trace: async () => empty("test") }));
  for (let i = 0; i < 4; i++) {
    const result = await post(base, {});
    assert.equal(result.status, 503);
    assert.doesNotMatch(JSON.stringify(await result.json()), /private store detail/);
  }
  broken = false;
  assert.equal((await post(base, {})).status, 200);
});

test("search deadline aborts fetches, preserves completed batch results and skips unstarted work", async t => {
  let observedSignal: AbortSignal | undefined;
  t.mock.method(globalThis, "fetch", (_url: string, options: RequestInit) => {
    observedSignal = options.signal!;
    return new Promise<Response>((_resolve, reject) => observedSignal!.addEventListener("abort", () => reject(observedSignal!.reason), { once: true }));
  });
  const calls: string[] = [];
  const result = await withSearchBudget(() => investigate({ mode: "batch", queries: [hash("a"), hash("b"), hash("c"), hash("d")] }, async (input: any) => {
    calls.push(input.query);
    if (input.query !== hash("a")) await jsonFetch("https://slow.example");
    return { ...empty(input.query), routes: [normalizeLifi({
      sending: { txHash: input.query, chainId: 1 }, receiving: { txHash: hash("f"), chainId: 8453 }, status: "DONE",
    }, "https://li.quest")!] };
  }), { timeoutMs: 40 });
  assert.equal(observedSignal?.aborted, true);
  assert.equal(result.investigation?.inputs[0].state, "ok");
  assert.equal(result.routes.length, 1);
  assert.equal(result.investigation?.transactions.length, 2);
  assert.equal(result.investigation?.inputs[3].state, "error");
  assert.ok(result.warnings.includes(SEARCH_TIMEOUT_MESSAGE));
  assert.equal(calls.includes(hash("d")), false);
});

test("a timed out trace retains completed provider routes and does not cache the incomplete result", async t => {
  let lifiCalls = 0;
  t.mock.method(globalThis, "fetch", (url: string, options: RequestInit) => {
    if (url.startsWith("https://li.quest")) {
      lifiCalls++;
      return Promise.resolve(response({ sending: { txHash: hash("e"), chainId: 728126428 }, receiving: { chainId: 7565164 }, status: "DONE" }));
    }
    return new Promise<Response>((_resolve, reject) => options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true }));
  });
  for (let i = 0; i < 2; i++) {
    const result = await withSearchBudget(() => trace({ query: hash("e"), kind: "transaction", chainId: "tron" }), { timeoutMs: 40 });
    assert.equal(result.routes.length, 1);
    assert.ok(result.warnings.includes(SEARCH_TIMEOUT_MESSAGE));
    assert.ok(result.diagnostics.some(d => d.state === "partial"));
  }
  assert.equal(lifiCalls, 2);
});

test("parallel request cancellation is isolated and does not mark a healthy RPC as failed", async () => {
  const pool = new RpcPool(async (_url, method) => {
    if (method === "eth_chainId") return "0x1";
    await waitForSearch(delay(80));
    return { status: "0x1" };
  });
  const [short, long] = await Promise.allSettled([
    withSearchBudget(() => pool.call(1, "eth_getTransactionReceipt", [], { endpoints: ["https://one.example"] }), { timeoutMs: 20 }),
    withSearchBudget(() => pool.call(1, "eth_getTransactionReceipt", [], { endpoints: ["https://two.example"] }), { timeoutMs: 300 }),
  ]);
  assert.equal(short.status, "rejected"); assert.equal(long.status, "fulfilled");
  assert.equal(pool.health.get("https://one.example")?.failures, 0);
});

test("disconnecting a search aborts upstream work", async t => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let cancelled!: () => void;
  const stopped = new Promise<void>(resolve => { cancelled = resolve; });
  const base = await listen(t, createApp({ trace: async () => {
    started();
    searchSignal()!.addEventListener("abort", () => cancelled(), { once: true });
    await waitForSearch(delay(500));
    return empty("cancelled");
  } }));
  const controller = new AbortController();
  const request = fetch(`${base}/api/trace`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: controller.signal });
  const rejection = assert.rejects(request);
  await ready; controller.abort();
  await rejection; await stopped;
});

test("concurrent searches for the same hash do not share another request's cancellation", async t => {
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    if (url.startsWith("https://li.quest")) {
      await delay(60, undefined, { signal: options.signal! });
      return response({ sending: { txHash: hash("f"), chainId: 728126428 }, receiving: { chainId: 7565164 }, status: "DONE" });
    }
    return new Promise<Response>((_resolve, reject) => options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true }));
  });
  const query = { query: hash("f"), kind: "transaction", chainId: "tron" };
  const [short, long] = await Promise.all([
    withSearchBudget(() => trace(query), { timeoutMs: 20 }),
    withSearchBudget(() => trace(query), { timeoutMs: 120 }),
  ]);
  assert.equal(short.routes.length, 0);
  assert.equal(long.routes.length, 1);
});

test("an address search keeps a connected bridge path when onward scans reach the deadline", async t => {
  const sourceAddress = `0x${"a".repeat(40)}`, destinationAddress = `0x${"b".repeat(40)}`;
  const now = Date.now();
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
  }));
  const result = await withSearchBudget(() => investigate({
    mode: "address-pair", sourceAddress, destinationAddress, sourceChainId: "1", destinationChainId: "8453",
    pages: 1, maxBridges: 1, maxHops: 1, startTime: new Date(now - 60_000).toISOString(), endTime: new Date(now).toISOString(),
  }, async () => ({ ...empty(sourceAddress), routes: [normalizeLifi({
    sending: { txHash: hash("a"), chainId: 1, timestamp: (now - 30_000) / 1000 },
    receiving: { txHash: hash("b"), chainId: 8453, timestamp: (now - 20_000) / 1000 },
    fromAddress: sourceAddress, toAddress: destinationAddress, status: "DONE",
  }, "https://li.quest")!] }), async () => {
    await jsonFetch("https://slow.example");
    return { transfers: [], diagnostics: [], warnings: [], truncated: false };
  }), { timeoutMs: 40 });
  assert.equal(result.investigation?.addressPaths?.filter(p => p.status === "connected").length, 1);
  assert.equal(result.investigation?.pathSearch?.truncated, true);
  assert.ok(result.warnings.includes(SEARCH_TIMEOUT_MESSAGE));
});
