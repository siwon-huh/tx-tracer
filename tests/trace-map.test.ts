import test from "node:test";
import assert from "node:assert/strict";
import { appendMapSearch, buildTraceMap, continuationKind } from "../src/trace-map";
import type { BridgeRoute, TraceResult, TransferEvent } from "../shared/types";
import fixture from "./fixtures/arbitrum-solana-forward.json";
import { parseSolanaTransfers } from "../server/transfers";

const address = (c: string) => `0x${c.repeat(40)}`;
const hash = (c: string) => `0x${c.repeat(64)}`;
const A = address("a"), B = address("b"), C = address("c"), D = address("d");
const at = (second: number) => new Date(1700000000000 + second * 1000).toISOString();
function transfer(id: string, from = A, to = B, second = 1, chainId = "1"): TransferEvent {
  return { id, chainId, chain: chainId, txHash: hash(id), from, to, timestamp: at(second), tokenAddress: "native", amount: "1", rawAmount: "1000000000000000000", decimals: 18, sequence: -1,
    evidence: { provider: "fixture", kind: "event", description: "transfer", fetchedAt: at(20) } };
}
function bridge(id: string, from = A, to = B, second = 1, src = "1", dst = "8453"): BridgeRoute {
  return { id, protocol: "fixture", bridge: "Fixture", status: "delivered", confidence: "indexed", evidence: [], notes: [],
    source: { chainId: src, chain: src, txHash: `source-${id}`, address: from, timestamp: at(second), tokenAddress: "native", amount: "1" },
    destination: { chainId: dst, chain: dst, txHash: `dest-${id}`, address: to, timestamp: at(second + 1), tokenAddress: "native", amount: "1" } };
}
function result(query: string, routes: BridgeRoute[] = [], transfers: TransferEvent[] = []): TraceResult {
  return { query, kind: "transaction", routes, transfers, candidates: [], diagnostics: [], warnings: [], fetchedAt: at(20), elapsedMs: 0, searchedChains: [] };
}
const search = (r: TraceResult) => ({ key: r.query, result: r });

test("accumulated bridge and onward send connect, while an unrelated result remains a separate entry", () => {
  const first = bridge("first"), onward = transfer("a", B, C, 5, "8453"), separate = transfer("b", D, A, 7);
  const map = buildTraceMap([search(result("bridge", [first])), search(result("onward", [], [onward])), search(result("separate", [], [separate]))]);
  assert.equal(map.entries.length, 3);
  assert.deepEqual(map.connections, [{ fromEntryId: first.id, fromStage: 2, toEntryId: `transfer:${onward.id}`, kind: "address-continuation", chainId: "8453", address: B }]);
  assert.ok(map.entries.some(e => e.id === `transfer:${separate.id}`));
});

test("real Arbitrum bridge and separate Solana signature form a continuation in either search order", () => {
  const send = parseSolanaTransfers(fixture.tx, fixture.hash, "rpc", fixture.route.evidence[0].fetchedAt)[0];
  const searches = [search(result("bridge", [fixture.route as BridgeRoute])), search(result("send", [], [send]))];
  for (const input of [searches, searches.slice().reverse()]) {
    const map = buildTraceMap(input);
    assert.equal(map.connections.length, 1);
    assert.equal(map.connections[0].kind, "address-continuation");
    assert.equal(map.entries[0].route?.id, fixture.route.id);
  }
});

test("same address on another chain, another asset, reverse time and excess quantity never join", () => {
  const previous = bridge("first").destination;
  const next = { ...previous, txHash: "different", timestamp: at(5) };
  assert.equal(continuationKind(previous, next), "address-continuation");
  for (const patch of [{ chainId: "1" }, { address: C }, { tokenAddress: "other" }, { timestamp: at(1) }, { timestamp: undefined }, { amount: "1.000000000000000001" }, { amount: "0" }, { txHash: undefined }, { receiptVerified: false }])
    assert.equal(continuationKind(previous, { ...next, ...patch }), undefined);
  assert.equal(continuationKind({ ...previous, address: "WalletABC" }, { ...next, address: "walletabc" }), undefined);
  assert.equal(continuationKind({ ...previous, address: B.toUpperCase().replace("0X", "0x") }, next), "address-continuation");
});

test("shared bridge transaction is a distinct junction and failed deliveries cannot extend", () => {
  const first = bridge("first"), second = bridge("second", B, C, 4, "8453", "10");
  first.destination.txHash = hash("a"); second.source.txHash = hash("a").slice(2).toUpperCase();
  let map = buildTraceMap([search(result("first", [first])), search(result("second", [second]))]);
  assert.equal(map.connections[0].kind, "shared-transaction");
  first.status = "refunded";
  map = buildTraceMap([search(result("first", [first])), search(result("second", [second]))]);
  assert.equal(map.connections.length, 0);
});

test("same-transaction transfer events connect only in event order and with matching recipients and assets", () => {
  const first = { ...transfer("a"), sequence: 1 }, second = { ...transfer("b", B, C), txHash: first.txHash, sequence: 2 };
  const map = buildTraceMap([search(result("events", [], [first, second]))]);
  assert.equal(map.connections.length, 1);
  assert.equal(map.connections[0].fromEntryId, `transfer:${first.id}`);
  assert.equal(buildTraceMap([search(result("events", [], [first, { ...second, from: D }]))]).connections.length, 0);
});

test("mixed address-pair and standalone searches retain only accepted paths and deduplicate embedded transactions", () => {
  const root = bridge("root"), middle = transfer("a", B, C, 5, "8453"), continuation = bridge("next", C, D, 10, "8453", "1");
  const pair = result("pair", [root]);
  pair.investigation = { request: { mode: "address-pair", sourceAddress: A, destinationAddress: C, days: 1, pages: 1 },
    inputs: [], observedRouteCount: 1, excludedRouteCount: 0, transactions: [], connections: [],
    addressPaths: [{ id: "accepted", bridgeRouteId: root.id, status: "connected", source: root.source, transfers: [middle], steps: [{ type: "transfer", transfer: middle }] },
      { id: "unresolved", bridgeRouteId: root.id, status: "unresolved", transfers: [] }] };
  const before = JSON.stringify(pair);
  const map = buildTraceMap([search(pair), search(result("same-bridge", [root])), search(result("same-send", [], [middle])), search(result("next", [continuation]))]);
  assert.equal(map.entries.length, 2);
  assert.equal(map.connections.length, 1);
  assert.equal(map.connections[0].fromStage, 3);
  assert.deepEqual(map.entries[0].searchKeys, ["pair", "same-bridge", "same-send"]);
  assert.equal(JSON.stringify(pair), before);
});

test("refresh updates a search in place, empty additions preserve the map, and reset starts empty", () => {
  const initial = search(result("first", [bridge("first")]));
  const searches = appendMapSearch([], initial);
  const refreshed = appendMapSearch(searches, search(result("first", [{ ...bridge("first"), status: "pending" }])));
  assert.equal(refreshed.length, 1);
  assert.equal(buildTraceMap(refreshed).entries[0].route?.status, "pending");
  assert.equal(searches[0].result.routes[0].status, "delivered");
  assert.equal(buildTraceMap(appendMapSearch(searches, search(result("empty")))).entries.length, 1);
  assert.equal(buildTraceMap([]).entries.length, 0);
  assert.equal(buildTraceMap([initial, search(result("counterpart", [bridge("first")]))]).entries.length, 1);
});
