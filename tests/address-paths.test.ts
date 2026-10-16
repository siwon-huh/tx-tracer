import test from "node:test";
import assert from "node:assert/strict";
import fixture from "./fixtures/arbitrum-solana-forward.json";
import { findAddressPaths, follows, followsBridge } from "../server/address-paths";
import { assetKey, incomingTransfers, parseBlockscoutTransfer, parseSolanaTransfers, type TransferScan } from "../server/transfers";
import { investigate } from "../server/investigate";
import type { BridgeRoute, TransferEvent, TraceResult } from "../shared/types";

const route = fixture.route as BridgeRoute;
const real = () => parseSolanaTransfers(fixture.tx, fixture.hash, "https://solana-rpc.publicnode.com", "2026-10-16T13:00:00.000Z")[0];
const pair = { mode: "address-pair" as const, sourceAddress: route.source.address!, destinationAddress: fixture.transfers[0].to,
  sourceChainId: "42161", destinationChainId: "solana", days: 365, pages: 1, maxHops: 2 };
const scan = (transfers: TransferEvent[]): TransferScan => ({ transfers, diagnostics: [], warnings: [], truncated: false });

test("real Arbitrum → Solana bridge receipt followed by native SOL forwarding has exact evidence", async () => {
  const transfer = real();
  assert.equal(transfer.rawAmount, "3196596302");
  assert.equal(transfer.amount, "3.196596302");
  assert.equal(transfer.from, route.destination.address);
  assert.equal(transfer.to, pair.destinationAddress);
  assert.equal(followsBridge(route, transfer), true);
  assert.equal(assetKey(route.destination.tokenAddress!), "native");
  const output = await findAddressPaths([route], pair, async q => scan(q.address === pair.destinationAddress ? [transfer] : []));
  assert.equal(output.paths[0].status, "connected");
  assert.deepEqual(output.paths[0].transfers.map(t => t.txHash), [fixture.hash]);
});

test("A → bridge → C is kept when C differs from B, and the forwarding transaction is exported", async () => {
  const r = structuredClone(route);
  r.source.timestamp = new Date(Date.now() - 120_000).toISOString();
  r.destination.timestamp = new Date(Date.now() - 90_000).toISOString();
  const transfer = { ...real(), timestamp: new Date(Date.now() - 60_000).toISOString() };
  const output = await investigate(pair, async () => ({ query: pair.sourceAddress, kind: "address", routes: [r], candidates: [], diagnostics: [], warnings: [], fetchedAt: "", elapsedMs: 0, searchedChains: [] } as TraceResult),
    async q => scan(q.address === route.destination.address ? [transfer] : []));
  assert.equal(output.routes.length, 1);
  assert.equal(output.investigation?.addressPaths?.[0].status, "connected");
  assert.equal(output.investigation?.transactions.length, 3);
  assert.ok(output.investigation?.transactions.some(t => t.txHash === fixture.hash && t.roles.includes("transfer")));
});

test("two ordinary transfers form C → D → B in chronological order", async () => {
  const first = { ...real(), to: "IntermediateWallet", id: "first", txHash: "first" };
  const second = { ...first, id: "second", txHash: "second", from: "IntermediateWallet", to: pair.destinationAddress,
    rawAmount: "3000000000", amount: "3.0", timestamp: "2026-10-16T12:33:45.000Z" };
  const output = await findAddressPaths([route], pair, async q => scan(q.address === pair.destinationAddress ? [second] : q.address === "IntermediateWallet" ? [first] : []));
  assert.deepEqual(output.paths[0].transfers.map(t => t.id), ["first", "second"]);
  const bounded = await findAddressPaths([route], { ...pair, maxHops: 1 }, async () => scan([second]));
  assert.equal(bounded.paths[0].status, "unresolved");
});

test("wrong asset, earlier transfer, excess amount, failed bridge and missing arrival metadata never connect", () => {
  const transfer = real();
  assert.equal(followsBridge(route, { ...transfer, tokenAddress: "DifferentMint" }), false);
  assert.equal(followsBridge(route, { ...transfer, timestamp: "2026-10-16T12:30:00.000Z" }), false);
  assert.equal(followsBridge(route, { ...transfer, rawAmount: "999999999999" }), false);
  assert.equal(followsBridge(route, { ...transfer, txHash: route.destination.txHash! }), false);
  assert.equal(followsBridge({ ...route, status: "refunded" }, transfer), false);
  assert.equal(followsBridge({ ...route, destination: { ...route.destination, timestamp: undefined } }, transfer), false);
  assert.equal(followsBridge({ ...route, destination: { ...route.destination, tokenAddress: undefined } }, transfer), false);
});

test("three forwarding hops retain both intermediate wallets and respect a two-hop limit", async () => {
  const first = { ...real(), to: "IntermediateD", id: "hop-1", txHash: "hop-1" };
  const second = { ...first, from: "IntermediateD", to: "IntermediateE", id: "hop-2", txHash: "hop-2",
    rawAmount: "3100000000", amount: "3.1", timestamp: "2026-10-16T12:33:45.000Z" };
  const third = { ...second, from: "IntermediateE", to: pair.destinationAddress, id: "hop-3", txHash: "hop-3",
    rawAmount: "3000000000", amount: "3.0", timestamp: "2026-10-16T12:34:45.000Z" };
  const load = async (q: { address: string }) => scan([first, second, third].filter(t => t.to === q.address));
  const output = await findAddressPaths([route], { ...pair, maxHops: 3 }, load);
  assert.equal(output.paths[0].status, "connected");
  assert.deepEqual(output.paths[0].transfers.map(t => t.to), ["IntermediateD", "IntermediateE", pair.destinationAddress]);
  const bounded = await findAddressPaths([route], { ...pair, maxHops: 2 }, load);
  assert.equal(bounded.paths[0].status, "unresolved");
});

test("same-transaction instruction ordering and same-token amount bounds are enforced", () => {
  const a = { ...real(), to: "middle", sequence: 2 };
  const b = { ...a, from: "middle", to: "end", sequence: 3 };
  assert.equal(follows(a, b), true);
  assert.equal(follows(a, { ...b, sequence: 1 }), false);
  assert.equal(follows(a, { ...b, chainId: "8453" }), false);
  assert.equal(follows(a, { ...b, tokenAddress: "Other" }), false);
  assert.equal(follows(a, { ...b, rawAmount: "999999999999" }), false);
});

test("multiple observed forwarding paths are retained with an attribution caveat", async () => {
  const a = real(), b = { ...a, id: "another", txHash: "another", rawAmount: "1000000000", amount: "1" };
  const output = await findAddressPaths([route], pair, async q => scan(q.address === pair.destinationAddress ? [a, b] : []));
  assert.equal(output.paths.filter(p => p.status === "connected").length, 2);
  assert.match(output.warnings.join(" "), /잔액 혼합/);
});

test("history failures keep the observed bridge and expose an unresolved path", async () => {
  const output = await findAddressPaths([route], pair, async () => { throw new Error("RPC timeout"); });
  assert.equal(output.paths[0].status, "unresolved");
  assert.equal(output.scope.truncated, true);
  assert.equal(output.diagnostics[0].state, "error");
  assert.match(output.warnings.join(" "), /RPC timeout/);
});

test("one forwarding transfer matching several bridge arrivals is explicitly ambiguous", async () => {
  const output = await findAddressPaths([route, { ...route, id: "another-bridge-order" }], pair,
    async q => scan(q.address === pair.destinationAddress ? [real()] : []));
  assert.equal(output.paths.length, 2);
  assert.ok(output.paths.every(p => p.status === "connected" && /입금이 2개/.test(p.reason || "")));
});

test("direct bridge arrivals do not query unrelated ordinary transfer histories", async () => {
  const output = await findAddressPaths([route], { ...pair, destinationAddress: route.destination.address! }, async () => { throw new Error("must not run"); });
  assert.equal(output.paths[0].status, "connected");
  assert.equal(output.scope.walletsScanned, 0);
});

test("Solana token owners come from balance metadata, not a delegated transfer authority", () => {
  const tx = { blockTime: 1792154000, slot: 1, transaction: { message: { accountKeys: ["sourceATA", "destinationATA"], instructions: [{ programId: "wrapper" }] } },
    meta: { err: null, preTokenBalances: [{ accountIndex: 0, mint: "Mint", owner: "OwnerC", uiTokenAmount: { decimals: 6 } }],
      postTokenBalances: [{ accountIndex: 1, mint: "Mint", owner: "OwnerB", uiTokenAmount: { decimals: 6 } }],
      innerInstructions: [{ index: 0, instructions: [{ programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", parsed: { type: "transferChecked", info: { source: "sourceATA", destination: "destinationATA", authority: "Delegate", mint: "Mint", tokenAmount: { amount: "9007199254740993", decimals: 6 } } } }] }] } };
  const transfers = parseSolanaTransfers(tx, "sig", "rpc", "time");
  assert.equal(transfers[0].from, "OwnerC");
  assert.equal(transfers[0].to, "OwnerB");
  assert.equal(transfers[0].amount, "9007199254.740993");
  assert.equal(transfers[0].sequence, 1);
  tx.meta.innerInstructions[0].instructions[0].programId = "FakeTokenProgram";
  assert.equal(parseSolanaTransfers(tx, "sig", "rpc", "time").length, 0);
});

test("failed Solana transactions and unsafe numeric lamports are rejected", () => {
  const tx = structuredClone(fixture.tx) as any;
  tx.meta.err = { InstructionError: [0, "Custom"] };
  assert.equal(parseSolanaTransfers(tx, fixture.hash, "rpc", "time").length, 0);
  tx.meta.err = null;
  for (const instruction of tx.transaction.message.instructions) if (instruction.parsed?.info?.lamports) instruction.parsed.info.lamports = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(parseSolanaTransfers(tx, fixture.hash, "rpc", "time").length, 0);
});

test("EVM normalizer requires ERC-20 event identity or a successful native transfer", () => {
  const row = { transaction_hash: "0xhash", log_index: 1, from: { hash: "from" }, to: { hash: "to" },
    timestamp: "2026-10-16T12:33:00.000Z", token: { type: "ERC-20", address_hash: "0xtoken", symbol: "USDC" }, total: { value: "9007199254740993", decimals: "6" } };
  assert.equal(parseBlockscoutTransfer(row, "42161", "url")?.amount, "9007199254.740993");
  assert.equal(parseBlockscoutTransfer({ ...row, token: { ...row.token, type: "ERC-721" } }, "42161", "url"), undefined);
  assert.equal(parseBlockscoutTransfer({ ...row, hash: "hash", value: "1", status: "error" }, "42161", "url", true), undefined);
});

test("native-only EVM path searches spend their budget on native history", async t => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify({ items: [{ hash: "0xnative", from: { hash: "0xfrom" }, to: { hash: "0xto" },
      timestamp: "2026-10-16T12:33:00.000Z", status: "ok", value: "1000000000000000000" }], next_page_params: null }),
      { headers: { "Content-Type": "application/json" } });
  });
  const output = await incomingTransfers({ chainId: "42161", address: "0xto", tokens: ["native"], since: 0,
    until: Date.parse("2026-10-17"), pages: 1, budget: { remaining: 1, deadline: Date.now() + 1000 } });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/transactions\?/);
  assert.equal(output.transfers[0].tokenAddress, "native");
  assert.equal(output.truncated, false);
});
