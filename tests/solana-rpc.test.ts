import test from "node:test";
import assert from "node:assert/strict";
import { solanaRpc } from "../server/solana-rpc";

test("Solana public RPC rejects a different cluster and switches to the backup", async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    const { method } = JSON.parse(String(options.body)); calls.push(`${url}:${method}`);
    const result = method === "getGenesisHash" ? url.includes("publicnode") ? "devnet-genesis" : "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" : [{ signature: "test" }];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { headers: { "Content-Type": "application/json" } });
  });
  const response = await solanaRpc("getSignaturesForAddress", ["test-address"]);
  assert.equal(response.endpoint, "https://api.mainnet-beta.solana.com");
  assert.equal(response.result[0].signature, "test");
  assert.equal(calls.filter(c => c.includes("publicnode")).length, 1);
});
