import test from "node:test";
import assert from "node:assert/strict";
import { findFundPaths, canEnterBridge, type BridgeLookup } from "../server/fund-paths";
import { investigate } from "../server/investigate";
import { timeWindow } from "../server/time-window";
import type { TransferLookup } from "../server/address-paths";
import type { BridgeRoute, InvestigationRequest, TransferEvent, TraceResult } from "../shared/types";
const address = (c: string) => `0x${c.repeat(40)}`;
const A = address("a"), B = address("b"), C = address("c"), D = address("d"), E = address("e"), F = address("f");
const base = Date.now() - 3600_000;
const at = (seconds: number) => new Date(base + seconds * 1000).toISOString();
const request = { mode: "address-pair", sourceAddress: A, destinationAddress: B, sourceChainId: "1", destinationChainId: "1", days: 1, pages: 1, maxHops: 3, maxBridges: 2, startTime: at(0), endTime: at(600) } satisfies InvestigationRequest;
function transfer(id: string, from: string, to: string, seconds: number, chainId = "1", token = "native", amount = "10"): TransferEvent {
  return { id, chainId, chain: chainId, txHash: id, from, to, tokenAddress: token, amount, rawAmount: String(Number(amount) * 1000), decimals: 3,
    timestamp: at(seconds), sequence: 0, evidence: { provider: "fixture", kind: "event", description: "synthetic transfer", fetchedAt: at(600) } };
}
function bridge(id: string, from: string, to: string, seconds: number, src = "1", dst = "8453", sourceToken = "native", destToken = "native"): BridgeRoute {
  return { id, bridge: "Fixture bridge", protocol: "fixture", status: "delivered", confidence: "indexed", evidence: [], notes: [],
    source: { chainId: src, chain: src, address: from, tokenAddress: sourceToken, amount: "9", txHash: `${id}-source`, timestamp: at(seconds) },
    destination: { chainId: dst, chain: dst, address: to, tokenAddress: destToken, amount: "8", txHash: `${id}-dest`, timestamp: at(seconds + 1) } };
}
const load = (events: TransferEvent[], calls: any[] = []): TransferLookup => async q => {
  calls.push(q); return { transfers: events.filter(t => t.chainId === q.chainId && t.from === q.address), warnings: [], diagnostics: [], truncated: false };
};
const bridges = (routes: BridgeRoute[]): BridgeLookup => async (address, chainId) => ({ routes: routes.filter(r => r.source.address === address && r.source.chainId === chainId), warnings: [], diagnostics: [], truncated: false });
const connected = (output: Awaited<ReturnType<typeof findFundPaths>>) => output.paths.filter(p => p.status === "connected");

test("ordinary-only A → C → D → B displays all three sends without a bridge root", async () => {
  const events = [transfer("one", A, C, 10), transfer("two", C, D, 20), transfer("three", D, B, 30)];
  const calls: any[] = [];
  const out = await findFundPaths([], { ...request, maxBridges: 0 }, load(events, calls), async () => { throw new Error("bridge API must not run"); });
  assert.equal(connected(out).length, 1);
  const path = out.paths[0];
  assert.equal(path.bridgeRouteId, undefined);
  assert.equal(path.source?.address, A);
  assert.deepEqual(path.transfers.map(t => t.id), ["one", "two", "three"]);
  assert.ok(calls.every(q => q.direction === "out" && q.since === base && q.until === base + 600_000));
  assert.equal(connected(await findFundPaths([], { ...request, maxHops: 2 }, load(events))).length, 0);
});

test("bridge → send → bridge → send changes chain and asset only at verified bridge legs", async () => {
  const first = bridge("first", A, C, 10);
  const next = bridge("second", D, E, 30, "8453", "solana", "native", "Mint");
  next.source.amount = "7";
  const events = [transfer("middle", C, D, 20, "8453", "native", "7"), transfer("last", E, B, 40, "solana", "Mint", "6")];
  const out = await findFundPaths([first], { ...request, destinationChainId: "solana" }, load(events), bridges([next]));
  assert.equal(connected(out).length, 1);
  assert.deepEqual(out.paths[0].steps?.map(s => s.type), ["transfer", "bridge", "transfer"]);
  assert.equal(connected(await findFundPaths([first], { ...request, destinationChainId: "solana", maxBridges: 1 }, load(events), bridges([next]))).length, 0);
});

test("ordinary send before the first bridge is part of the same exported path", async () => {
  const first = bridge("mid", C, D, 20);
  const events = [transfer("first-send", A, C, 10), transfer("last-send", D, B, 30, "8453", "native", "7")];
  const out = await findFundPaths([], { ...request, destinationChainId: "8453" }, load(events), bridges([first]));
  assert.equal(connected(out).length, 1);
  assert.equal(out.paths[0].bridgeRouteId, undefined);
  assert.deepEqual(out.paths[0].steps?.map(s => s.type), ["transfer", "bridge", "transfer"]);
});

test("three sequential bridges honor the bridge count and final chain", async () => {
  const first = bridge("first", A, C, 10);
  const second = bridge("second", C, D, 20, "8453", "10"); second.source.amount = "8";
  const third = bridge("third", D, B, 30, "10", "solana"); third.source.amount = "8";
  const out = await findFundPaths([first], { ...request, maxBridges: 3, destinationChainId: "solana" }, load([]), bridges([second, third]));
  assert.equal(connected(out).length, 1);
  assert.equal(out.paths[0].steps?.filter(s => s.type === "bridge").length, 2);
  assert.equal(connected(await findFundPaths([first], { ...request, maxBridges: 2, destinationChainId: "solana" }, load([]), bridges([second, third]))).length, 0);
});

test("bridge entry rejects another asset, larger amount, reversed time, shared tx and chain mismatch", () => {
  const t = transfer("send", A, C, 10);
  const previous = { ...t, address: C };
  const next = bridge("bridge", C, D, 20);
  assert.equal(canEnterBridge(previous, next), true);
  for (const patch of [{ tokenAddress: "Other" }, { amount: "11" }, { timestamp: at(5) }, { txHash: t.txHash }, { chainId: "10" }])
    assert.equal(canEnterBridge(previous, { ...next, source: { ...next.source, ...patch } }), false);
});

test("reversed sends, outside-window sends, other assets, cycles and larger outgoing amount do not connect", async () => {
  const first = transfer("first", A, C, 10);
  for (const bad of [transfer("bad", C, B, 5), transfer("bad", C, B, 601), transfer("bad", C, B, 20, "1", "other"), transfer("bad", C, B, 20, "1", "native", "11")]) {
    assert.equal(connected(await findFundPaths([], request, load([first, bad]))).length, 0);
  }
  const out = await findFundPaths([], request, load([first, transfer("cycle", C, A, 20), transfer("future", A, B, 700)]));
  assert.equal(connected(out).length, 0);
});

test("failed bridge and arrival outside period cannot be traversed", async () => {
  for (const r of [{ ...bridge("r", A, B, 10), status: "refunded" as const }, bridge("r", A, B, 600)]) {
    const out = await findFundPaths([r], { ...request, destinationChainId: "8453" }, load([]));
    assert.equal(connected(out).length, 0);
    assert.equal(out.paths[0].status, "unresolved");
  }
});

test("history failures are partial, and no EVM chain is silently guessed", async () => {
  const failed = await findFundPaths([], request, async () => { throw new Error("history unavailable"); });
  assert.equal(failed.scope.truncated, true);
  assert.equal(failed.diagnostics[0].state, "error");
  const unknown = await findFundPaths([], { ...request, sourceChainId: undefined }, async () => { throw new Error("must not run"); });
  assert.equal(unknown.scope.walletsScanned, 0);
  assert.match(unknown.warnings.join(" "), /출발 체인을 선택/);
});

test("API ordinary-only mode skips all bridge lookups and exports transfer hashes and the exact window", async () => {
  const out = await investigate({ ...request, maxBridges: 0 }, async () => { throw new Error("must not run"); }, load([
    transfer("one", A, C, 10), transfer("two", C, B, 20), transfer("dead-end", A, F, 15), transfer("after-target", B, E, 30),
  ]));
  assert.equal(out.routes.length, 0);
  assert.equal(out.investigation?.addressPaths?.[0].status, "connected");
  assert.deepEqual(out.investigation?.transactions.map(t => t.txHash), ["one", "two"]);
  assert.equal(out.investigation?.pathSearch?.startTime, request.startTime);
});

test("API follows intermediate bridge to a different final chain and exports both bridge legs", async () => {
  const first = bridge("first", A, C, 10), second = bridge("second", D, E, 30, "8453", "solana"); second.source.amount = "7";
  const unrelated = bridge("unrelated", A, F, 15), detour = bridge("detour", D, F, 30, "8453", "solana"); detour.source.amount = "7";
  const events = [transfer("middle", C, D, 20, "8453", "native", "7"), transfer("last", E, B, 40, "solana", "native", "6"),
    transfer("dead-end", C, F, 20, "8453", "native", "7"), transfer("after-target", B, F, 50, "solana", "native", "5")];
  const out = await investigate({ ...request, destinationChainId: "solana" }, async (raw: any): Promise<TraceResult> => ({ query: raw.query, kind: "address", routes: raw.query === A ? [first, unrelated] : raw.query === D ? [second, detour] : [], candidates: [], diagnostics: [], warnings: [], fetchedAt: at(600), elapsedMs: 0, searchedChains: [] }), load(events));
  assert.deepEqual(out.routes.map(r => r.id), ["first"]);
  assert.equal(out.investigation?.addressPaths?.length, 1);
  assert.equal(out.investigation?.addressPaths?.[0].status, "connected");
  assert.deepEqual(out.investigation?.addressPaths?.[0].steps?.map(s => s.type === "bridge" ? s.route.id : s.transfer.id), ["middle", "second", "last"]);
  assert.deepEqual(out.investigation?.transactions.map(t => t.txHash).sort(), ["first-source", "first-dest", "second-source", "second-dest", "middle", "last"].sort());
});

test("finished providers are not paged again and absolute bounds reach upstream", async () => {
  const calls: any[] = [];
  const complete = ["LI.FI", "deBridge DLN", "LayerZero / Stargate", "Wormhole / Portal", "THORChain", "Chainlink CCIP"];
  const out = await investigate({ ...request, pages: 5 }, async (raw: any, options): Promise<TraceResult> => {
    calls.push({ raw, options });
    return { query: raw.query, kind: "address", routes: [], candidates: [], diagnostics: [], warnings: [], fetchedAt: at(600), elapsedMs: 0, searchedChains: [], pagination: { completeProviders: complete } };
  }, load([]));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].raw.startTime, request.startTime);
  assert.equal(calls[0].raw.endTime, request.endTime);
  assert.equal(out.investigation?.pathSearch?.truncated, false);
});

test("invalid or one-sided windows fail before any network request", async () => {
  assert.throws(() => timeWindow({ days: 1, startTime: at(0) }), /모두/);
  assert.throws(() => timeWindow({ days: 1, startTime: at(10), endTime: at(0) }), /빨라야/);
  await assert.rejects(investigate({ ...request, endTime: at(-1) }, async () => { throw new Error("must not run"); }), /빨라야/);
});
