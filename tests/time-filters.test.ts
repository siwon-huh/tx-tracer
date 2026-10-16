import test from "node:test";
import assert from "node:assert/strict";
import { incomingTransfers } from "../server/transfers";
import { lifi } from "../server/adapters/lifi";
import { wormhole } from "../server/adapters/wormhole";
import { thorchain } from "../server/adapters/thorchain";
const since = Date.parse("2026-10-16T12:30:00Z"), until = since + 300_000;
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

test("Blockscout outgoing time filtering does not spend event budget outside the window and stops older pages", async t => {
  const urls: string[] = [];
  const row = (id: string, timestamp: number) => ({ hash: id, timestamp: new Date(timestamp).toISOString(), status: "ok", from: { hash: "0xfrom" }, to: { hash: "0xto" }, value: "1000000000000000000" });
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url); return response({ items: [row("new", until + 1000), row("inside", since + 1000), row("old", since - 1000)], next_page_params: { block_number: 123 } });
  });
  const budget = { remaining: 1, deadline: Date.now() + 10_000 };
  const out = await incomingTransfers({ chainId: "1", address: "0xfrom", tokens: ["native"], direction: "out", since, until, pages: 5, budget });
  assert.equal(urls.length, 1);
  assert.equal(new URL(urls[0]).searchParams.get("filter"), "from");
  assert.deepEqual(out.transfers.map(t => t.txHash), ["inside"]);
  assert.equal(out.truncated, false);
});

test("Tron outgoing history sends both native time bounds upstream", async t => {
  let url = "";
  t.mock.method(globalThis, "fetch", async (value: string) => { url = value; return response({ success: true, data: [] }); });
  await incomingTransfers({ chainId: "tron", address: "TronWallet", tokens: [], direction: "out", since, until, pages: 1, budget: { remaining: 80, deadline: Date.now() + 10_000 } });
  const params = new URL(url).searchParams;
  assert.equal(params.get("only_from"), "true"); assert.equal(params.get("only_to"), null);
  assert.equal(params.get("min_timestamp"), String(since)); assert.equal(params.get("max_timestamp"), String(until));
});

test("LI.FI, Wormholescan and Midgard use their documented upstream time filter formats", async t => {
  const urls: URL[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => { urls.push(new URL(url)); return response({ transfers: [], operations: [], actions: [] }); });
  const input = { kind: "address" as const, query: `0x${"a".repeat(40)}`, days: 30, page: 1, limit: 25, startTime: new Date(since).toISOString(), endTime: new Date(until).toISOString() };
  await lifi(input); await wormhole(input); await thorchain(input);
  assert.equal(urls[0].searchParams.get("fromTimestamp"), String(since / 1000));
  assert.equal(urls[0].searchParams.get("toTimestamp"), String(until / 1000));
  assert.equal(urls[1].searchParams.get("from"), input.startTime);
  assert.equal(urls[1].searchParams.get("to"), input.endTime);
  assert.equal(urls[2].searchParams.get("fromTimestamp"), String(since / 1000 - 1));
  assert.equal(urls[2].searchParams.get("timestamp"), String(until / 1000 + 1));
});
