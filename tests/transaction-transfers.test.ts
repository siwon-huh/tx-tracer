import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Interface } from "ethers";
import { rpc } from "../server/rpc";
import { evmTransactionTransfers } from "../server/transaction-transfers";
import { investigate } from "../server/investigate";

const address = (c: string) => `0x${c.repeat(40)}`;
const hash = `0x${"a".repeat(64)}`, blockHash = `0x${"b".repeat(64)}`;
const abi = new Interface(["function decimals() view returns(uint8)", "function symbol() view returns(string)", "event Transfer(address indexed from,address indexed to,uint256 value)"]);
const event = abi.encodeEventLog(abi.getEvent("Transfer")!, [address("a"), address("b"), 60000000n]);
const receipt = { status: "0x1", transactionHash: hash, blockHash, blockNumber: "0x123", logs: [{ ...event, address: address("c"), logIndex: "0x2" }] };
function mockRpc(t: TestContext) {
  t.mock.method(rpc, "call", async (_chain: string, method: string, params: any[]) => {
    const result = method === "eth_getBlockByHash" ? { hash: blockHash, timestamp: "0x6553f100" }
      : method === "eth_getTransactionByHash" ? { hash, blockHash, from: address("a"), to: address("c"), value: "0x0" }
      : params[0].data === abi.encodeFunctionData("decimals") ? abi.encodeFunctionResult("decimals", [6]) : abi.encodeFunctionResult("symbol", ["USDC"]);
    return { result, endpoint: "fixture", checked: ["fixture"] };
  });
}

test("single ERC-20 receipt produces a wallet transfer rather than treating the token contract as the recipient", async t => {
  mockRpc(t);
  const out = await evmTransactionTransfers("1", receipt);
  assert.equal(out.partial, false);
  assert.equal(out.transfers.length, 1);
  assert.equal(out.transfers[0].to, address("b"));
  assert.equal(out.transfers[0].amount, "60.0");
  assert.equal(out.transfers[0].symbol, "USDC");
  assert.equal(out.transfers[0].timestamp, "2023-11-14T22:13:20.000Z");
});

test("failed transactions, NFT transfers, mint events and removed logs cannot produce payments", async t => {
  mockRpc(t);
  assert.deepEqual((await evmTransactionTransfers("1", { ...receipt, status: "0x0" })).transfers, []);
  for (const bad of [{ ...receipt.logs[0], removed: true }, { ...receipt.logs[0], topics: [...event.topics, event.data], data: "0x" },
    { ...receipt.logs[0], topics: [event.topics[0], `0x${"0".repeat(64)}`, event.topics[2]] }])
    assert.deepEqual((await evmTransactionTransfers("1", { ...receipt, logs: [bad] })).transfers, []);
  await assert.rejects(evmTransactionTransfers("1", { ...receipt, blockHash: "wrong" }), /일치/);
});

test("missing token metadata is partial and does not guess an amount", async t => {
  mockRpc(t);
  const previous = rpc.call;
  t.mock.method(rpc, "call", async (...args: Parameters<typeof rpc.call>) => {
    if (args[1] === "eth_call") throw new Error("archive unavailable");
    return previous(...args);
  });
  const out = await evmTransactionTransfers("1", receipt);
  assert.equal(out.partial, true);
  assert.deepEqual(out.transfers, []);
});

test("batch searches preserve ordinary transfers and export their transaction hashes once", async t => {
  mockRpc(t);
  const { transfers } = await evmTransactionTransfers("1", receipt);
  const out = await investigate({ mode: "batch", queries: [hash] }, async () => ({ query: hash, kind: "transaction", routes: [], transfers, candidates: [], diagnostics: [], warnings: [], fetchedAt: "", elapsedMs: 0, searchedChains: [] }));
  assert.equal(out.transfers?.length, 1);
  assert.equal(out.investigation?.inputs[0].state, "ok");
  assert.equal(out.investigation?.inputs[0].count, 1);
  assert.deepEqual(out.investigation?.transactions.map(tx => tx.txHash), [hash]);
});
