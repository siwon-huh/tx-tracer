import test from "node:test";
import assert from "node:assert/strict";
import type { BridgeRoute, TraceResult } from "../shared/types";
import { connectedTransactions, connectRoutes, investigate as runInvestigation, matchesAddressPair } from "../server/investigate";
import unrelatedStargate from "./fixtures/unrelated-stargate-route.json";

const investigate: typeof runInvestigation = (raw, lookup, transfers) => runInvestigation(raw, lookup, transfers || (async () => ({ transfers: [], diagnostics: [], warnings: [], truncated: false })));

const hash = (letter: string) => `0x${letter.repeat(64)}`;
const sender = `0x${"a".repeat(40)}`;
const receiver = `0x${"b".repeat(40)}`;
function route(id = "r1"): BridgeRoute {
  return {
    id, protocol: "debridge", bridge: "deBridge DLN", status: "delivered", confidence: "indexed",
    source: { chainId: "1", chain: "Ethereum", txHash: hash("a"), address: sender, timestamp: new Date(Date.now() - 3600_000).toISOString() },
    destination: { chainId: "8453", chain: "Base", txHash: hash("b"), address: receiver, timestamp: new Date(Date.now() - 3500_000).toISOString() },
    evidence: [{ provider: "deBridge", kind: "indexer", description: "order", fetchedAt: new Date().toISOString() }], notes: [],
  };
}
function result(query: string, routes: BridgeRoute[]): TraceResult {
  return {
    query, kind: "transaction", routes, candidates: [],
    diagnostics: [{ provider: "indexer", state: routes.length ? "ok" : "empty", count: routes.length, durationMs: 0, detail: "test" }],
    warnings: [], elapsedMs: 0, fetchedAt: new Date().toISOString(), searchedChains: [],
  };
}
const pair = { mode: "address-pair" as const, sourceAddress: sender, destinationAddress: receiver, days: 30, pages: 1 };

test("batch unifies duplicate hashes and counterpart observations without mutating cached routes", async () => {
  const original = route();
  const calls: string[] = [];
  const output = await investigate({ mode: "batch", queries: [hash("a"), hash("a").toUpperCase().replace("0X", "0x"), hash("b")] }, async (input: any) => {
    calls.push(input.query); return result(input.query, [original]);
  });
  assert.equal(calls.length, 2);
  assert.equal(output.routes.length, 1);
  assert.equal(output.investigation?.transactions.length, 2);
  assert.equal(output.routes[0].evidence.length, 1);
  assert.equal(original.evidence.length, 1);
});

test("batch preserves distinct messages within the same source and destination transactions", async () => {
  const output = await investigate({ mode: "batch", queries: [hash("a"), hash("b")] }, async (input: any) => result(input.query, [route("m1"), route("m2")]));
  assert.equal(output.routes.length, 2);
  assert.deepEqual([...(output.investigation?.transactions[0].routeIds || [])].sort(), ["m1", "m2"]);
});

test("batch preserves successful results alongside invalid and failed inputs", async () => {
  const output = await investigate({ mode: "batch", queries: [hash("a"), hash("c"), "bad"] }, async (input: any) => {
    if (input.query === hash("c")) throw new Error("upstream unavailable");
    return result(input.query, [route()]);
  });
  assert.equal(output.routes.length, 1);
  assert.deepEqual(output.investigation?.inputs.map(i => i.state), ["ok", "error", "error"]);
  assert.match(output.warnings.join(" "), /일부 입력/);
});

test("all failed provider calls are never reported as empty or complete", async () => {
  const output = await investigate({ mode: "batch", queries: [hash("a")] }, async (input: any) => {
    const response = result(input.query, []);
    response.diagnostics[0].state = "error";
    return response;
  });
  assert.equal(output.investigation?.inputs[0].state, "error");
});

test("partial order-detail failures remain visible even when the provider returned routes", async () => {
  const output = await investigate({ mode: "batch", queries: [hash("a")] }, async (input: any) => {
    const response = result(input.query, [route()]);
    response.diagnostics[0].state = "partial";
    return response;
  });
  assert.equal(output.routes.length, 1);
  assert.equal(output.investigation?.inputs[0].state, "partial");
});

test("address pair enforces direction, optional chain, time window and known timestamps", async () => {
  const valid = route("valid");
  const reverse = route("reverse"); reverse.source.address = receiver; reverse.destination.address = sender;
  const wrongChain = route("wrongChain"); wrongChain.destination.chainId = "10";
  const old = route("old"); old.source.timestamp = new Date(Date.now() - 90 * 86400_000).toISOString();
  const unknown = route("unknown"); delete unknown.source.timestamp;
  const noRecipient = route("noRecipient"); delete noRecipient.destination.address;
  const output = await investigate({ ...pair, destinationChainId: "8453" }, async (input: any) => result(input.query, [valid, reverse, wrongChain, old, unknown, noRecipient]));
  assert.deepEqual(output.routes.map(r => r.id), ["valid"]);
  assert.equal(output.investigation?.excludedRouteCount, 5);
  assert.deepEqual(output.investigation?.addressPaths?.map(p => [p.bridgeRouteId, p.status]), [["valid", "connected"]]);
  assert.equal(output.investigation?.transactions.length, 2);
  assert.ok(output.investigation?.transactions.every(t => t.routeIds.length === 1 && t.routeIds[0] === "valid"));
  assert.match(output.warnings.join(" "), /출발 시간이 없는.*1개/);
});

test("reported Stargate transaction is excluded without an onward path to B, including partial searches", async () => {
  const observed = unrelatedStargate.route as BridgeRoute;
  const lookup = async (input: any) => result(input.query, input.query === unrelatedStargate.request.sourceAddress ? [observed] : []);
  for (const partial of [false, true]) {
    const output = await investigate(unrelatedStargate.request, lookup, async () => ({
      transfers: [], truncated: partial, warnings: partial ? ["history unavailable"] : [],
      diagnostics: partial ? [{ provider: "fixture history", state: "error", count: 0, durationMs: 0, detail: "history unavailable" }] : [],
    }));
    assert.deepEqual(output.routes, []);
    assert.deepEqual(output.investigation?.addressPaths, []);
    assert.deepEqual(output.investigation?.transactions, []);
    assert.deepEqual(output.investigation?.connections, []);
    assert.equal(output.investigation?.observedRouteCount, 1);
    assert.equal(output.investigation?.excludedRouteCount, 1);
    if (partial) {
      assert.equal(output.investigation?.pathSearch?.truncated, true);
      assert.ok(output.diagnostics.some(d => d.state === "error"));
      assert.ok(output.warnings.includes("history unavailable"));
    }
  }
  // A transaction search has no target wallet, so the same route is still valid there.
  const batch = await investigate({ mode: "batch", queries: [observed.source.txHash!] }, async (input: any) => result(input.query, [observed]));
  assert.deepEqual(batch.routes.map(r => r.id), [observed.id]);
  assert.equal(batch.investigation?.transactions.length, 2);
});

test("address matching preserves base58 case and accepts EVM checksum case", () => {
  assert.equal(matchesAddressPair(route(), { ...pair, sourceAddress: `0x${"A".repeat(40)}` }), true);
  const nonEvm = route(); nonEvm.destination.address = "Abcdef123";
  assert.equal(matchesAddressPair(nonEvm, { ...pair, destinationAddress: "abcdef123" }), false);
});

test("address pages are accumulated and repeated non-paginated sources are skipped", async () => {
  const calls: any[] = [];
  const output = await investigate({ ...pair, pages: 3 }, async (input: any, options) => {
    calls.push({ input, options });
    return result(input.query, [route(`page-${input.page}`)]);
  });
  assert.equal(calls.length, 3);
  assert.equal(output.routes.length, 3);
  assert.equal(calls.filter(c => c.options.paginatedOnly).length, 2);
  assert.ok(calls.every(c => c.options.bridgesOnly));
});

test("identical source/destination wallet and chain are queried once per page", async () => {
  let calls = 0;
  await investigate({ ...pair, destinationAddress: sender, pages: 3 }, async (input: any) => {
    calls++; return result(input.query, []);
  });
  assert.equal(calls, 3);
});

test("route junction requires the same chain and transaction, never just the same address", () => {
  const first = route("first");
  const next = route("next"); next.source.chainId = "8453"; next.source.txHash = hash("b").slice(2).toUpperCase();
  assert.equal(connectRoutes([first, next]).length, 1);
  next.source.chainId = "10";
  assert.equal(connectRoutes([first, next]).length, 0);
  next.source.chainId = "8453"; next.source.txHash = hash("c"); next.source.address = receiver;
  assert.equal(connectRoutes([first, next]).length, 0);
  next.source.txHash = hash("b"); first.status = "refunded";
  assert.equal(connectRoutes([first, next]).length, 0);
});

test("connected transaction deduplication respects chains and base58 case", () => {
  const first = route("first"); first.source.chainId = "solana"; first.source.txHash = "Abc";
  const second = route("second"); second.source.chainId = "solana"; second.source.txHash = "abc";
  const third = route("third"); third.destination.chainId = "10";
  assert.equal(connectedTransactions([first, second, third]).length, 5);
});

test("oversized batches and address scans reject before performing lookups", async () => {
  const lookup = async () => { throw new Error("must not run"); };
  await assert.rejects(investigate({ mode: "batch", queries: Array(11).fill(hash("a")) }, lookup), /Array must contain at most 10/);
  await assert.rejects(investigate({ ...pair, pages: 6 }, lookup), /less than or equal to 5/);
});
