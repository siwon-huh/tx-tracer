import test from "node:test";
import assert from "node:assert/strict";
import { Interface } from "ethers";
import { RpcPool } from "../server/rpc";
import { isPublicRpcUrl } from "../server/chains";
import { classify, mergeRoutes } from "../server/trace";
import { normalizeLifi } from "../server/adapters/lifi";
import { normalizeLayerzero } from "../server/adapters/layerzero";
import { normalizeWormhole } from "../server/adapters/wormhole";
import { normalizeThorchain } from "../server/adapters/thorchain";
import { normalizeDebridge } from "../server/adapters/debridge";
import { decodeOfficial, opDeployments, verifyRoutes } from "../server/onchain";
import { rpc } from "../server/rpc";
import fs from "node:fs";
import { amount, leg } from "../server/adapters/common";
import type { BridgeRoute } from "../shared/types";
import { addressHistory } from "../server/history";
const hash = "0x" + "a".repeat(64),
  address = "0x" + "b".repeat(40);
test("address history retains token receipts when the transaction endpoint fails", async (t) => {
  const oldKey = process.env.ETHERSCAN_API_KEY;
  delete process.env.ETHERSCAN_API_KEY;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.includes("/transactions?")) throw new Error("upstream unavailable");
    return new Response(
      JSON.stringify({
        items: [
          {
            transaction_hash: hash,
            from: { hash: address },
            timestamp: "2026-10-15T00:00:00Z",
          },
        ],
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
  try {
    const result = await addressHistory(address, "8453", 1, 25);
    assert.equal(result.candidates[0]?.hash, hash);
    assert.ok(
      result.diagnostics.some(
        (d) => d.state === "error" && d.provider.endsWith("transactions"),
      ),
    );
    assert.ok(result.diagnostics.some((d) => d.state === "ok"));
  } finally {
    if (oldKey !== undefined) process.env.ETHERSCAN_API_KEY = oldKey;
    t.mock.restoreAll();
  }
});
test("input validation distinguishes EVM address/hash, BTC hash, Solana and rejects URLs", () => {
  assert.equal(classify(hash), "transaction");
  assert.equal(classify(address), "address");
  assert.equal(classify("A".repeat(64)), "transaction");
  assert.equal(
    classify(
      "5VqK66MGLHpuYbJnhTt5SFQSXdca12SjsbRRdBwG7w2jijMAEzFR2Vs8rKwwGTBDTQuQqURcgPafFAHM6ERKPtaQ",
    ),
    "transaction",
  );
  assert.throws(() => classify("https://evil.example/private"));
  assert.throws(() => classify(address, "transaction"));
});
test("amounts never round through floating-point integers", () => {
  assert.equal(
    amount("9007199254740993123456789", 18),
    "9007199.254740993123456789",
  );
  assert.equal(amount("123", null), undefined);
});
test("undefined labels cannot erase a canonical chain name", () =>
  assert.equal(leg("1", { chain: undefined }).chain, "Ethereum Mainnet"));
test("RPC rejects wrong-chain primary and switches to backup, cooling down the bad endpoint", async () => {
  const calls: string[] = [];
  const pool = new RpcPool(async (url, method) => {
    calls.push(`${url}:${method}`);
    return method === "eth_chainId"
      ? url.includes("bad")
        ? "0x89"
        : "0x1"
      : "0x123";
  });
  const result = await pool.call(1, "eth_blockNumber", [], {
    endpoints: ["https://bad.example", "https://good.example"],
  });
  assert.equal(result.result, "0x123");
  assert.equal(result.endpoint, "good.example");
  assert.ok(pool.health.get("https://bad.example")!.cooldownUntil > Date.now());
  assert.ok(!calls.includes("https://bad.example:eth_blockNumber"));
});
test("RPC timeout or rate limit fails over, successful later request resets health", async () => {
  const pool = new RpcPool(async (url, method) => {
    if (url.includes("bad")) throw new Error("429");
    return method === "eth_chainId" ? "0x1" : { status: "0x1" };
  });
  const r = await pool.call(1, "eth_getTransactionReceipt", [hash], {
    endpoints: ["https://bad.example", "https://good.example"],
  });
  assert.equal(r.endpoint, "good.example");
  assert.equal(pool.health.get("https://good.example")?.failures, 0);
});
test("RPC corroborates negative receipts and still accepts a positive backup", async () => {
  const pool = new RpcPool(async (url, method) =>
    method === "eth_chainId"
      ? "0x1"
      : url.includes("second")
        ? { transactionHash: hash }
        : null,
  );
  const result = await pool.call(1, "eth_getTransactionReceipt", [hash], {
    nullQuorum: 2,
    endpoints: ["https://first.example", "https://second.example"],
  });
  assert.equal(result.result.transactionHash, hash);
  const negative = new RpcPool(async (_url, method) =>
    method === "eth_chainId" ? "0x1" : null,
  );
  await assert.rejects(() =>
    negative.call(1, "eth_getTransactionReceipt", [hash], {
      nullQuorum: 2,
      endpoints: ["https://only.example"],
    }),
  );
});
test("public RPC URL filters local/private syntax and key templates", () => {
  for (const url of [
    "http://rpc.example",
    "https://127.0.0.1",
    "https://[::1]",
    "https://rpc.local",
    "https://user:pass@host.com",
    "https://host.com/${API_KEY}",
    "https://host.com?api_key=secret",
  ])
    assert.equal(isPublicRpcUrl(url), false, url);
  assert.equal(isPublicRpcUrl("https://ethereum-rpc.publicnode.com"), true);
});
test("LI.FI refunds and partial deliveries are not silently labeled normal completion", () => {
  const row = {
    sending: { txHash: hash, chainId: 1 },
    receiving: { chainId: 8453 },
    status: "DONE",
    substatus: "REFUNDED",
  };
  assert.equal(normalizeLifi(row, "https://li.quest")?.status, "refunded");
  assert.ok(
    normalizeLifi(
      { ...row, substatus: "PARTIAL" },
      "https://li.quest",
    )?.notes[0].includes("PARTIAL"),
  );
  assert.equal(
    normalizeLifi({ ...row, status: "NOT_FOUND" }, "https://li.quest"),
    null,
  );
});
test("LayerZero EIDs map independently; protocol contract and relayer are not user addresses", () => {
  const r = normalizeLayerzero(
    {
      guid: hash,
      pathway: {
        srcEid: 30111,
        dstEid: 30101,
        sender: { name: "Stargate", address },
        receiver: { address },
      },
      source: { tx: { txHash: hash, from: address } },
      status: { name: "DELIVERED" },
    },
    "https://scan.layerzero-api.com",
  );
  assert.equal(r.source.chainId, "10");
  assert.equal(r.destination.chainId, "1");
  assert.equal(r.source.address, undefined);
  assert.equal(r.destination.address, undefined);
  assert.equal(r.bridge, "Stargate");
});
test("Wormhole payload 3 intermediary is not presented as final wallet", () => {
  const r = normalizeWormhole(
    {
      id: hash,
      content: {
        payload: { payloadType: 3 },
        standarizedProperties: {
          fromChain: 30,
          toChain: 1,
          toAddress: address,
          appIds: ["PORTAL_TOKEN_BRIDGE"],
        },
      },
      sourceChain: { chainId: 30, transaction: { txHash: hash } },
      targetChain: { chainId: 1, status: "completed", to: address },
      data: { tokenAmount: "1.234", symbol: "USDC" },
    },
    "https://api.wormholescan.io",
  );
  assert.equal(r.source.chainId, "8453");
  assert.equal(r.destination.chainId, "solana");
  assert.equal(r.destination.address, undefined);
  assert.equal(r.source.amount, "1.234");
});
test("Midgard precision, affiliates, multiple outputs, and synthetic assets", () => {
  const r = normalizeThorchain(
    {
      type: "swap",
      status: "success",
      date: "1700000000000000000",
      in: [{ txID: "ABC", coins: [{ asset: "ETH.ETH", amount: "100000000" }] }],
      out: [
        { txID: "FEE", affiliate: true, coins: [] },
        {
          txID: "A",
          address: "recipient",
          coins: [{ asset: "BTC.BTC", amount: "2286" }],
        },
        { txID: "B", coins: [{ asset: "ETH~ETH", amount: "123" }] },
      ],
    },
    "https://midgard",
  );
  assert.equal(r.length, 2);
  assert.equal(r[0].destination.amount, "0.00002286");
  assert.equal(r[1].destination.chainId, "thorchain");
  assert.equal(r[0].source.amount, "1.0");
});
test("deBridge uses exact stringValue for amounts rather than unsafe numeric JSON", () => {
  const offer = {
    chainId: { stringValue: "1" },
    finalAmount: {
      stringValue: "9007199254740993123",
      bigIntegerValue: 9007199254740993000,
    },
    metadata: { decimals: 18, symbol: "ETH" },
  };
  const r = normalizeDebridge(
    {
      orderId: { stringValue: hash },
      state: "ClaimedUnlock",
      giveOfferWithMetadata: offer,
      takeOfferWithMetadata: offer,
    },
    "https://dln-api.debridge.finance",
  );
  assert.equal(r.source.amount, "9.007199254740993123");
});
test("spoofed official event is rejected; trusted initiation remains source-only", () => {
  const iface = new Interface([
    "event ETHBridgeInitiated(address indexed from,address indexed to,uint256 amount,bytes extraData)",
  ]);
  const event = iface.encodeEventLog(iface.getEvent("ETHBridgeInitiated")!, [
    address,
    address,
    1n,
    "0x",
  ]);
  const receipt = {
    transactionHash: hash,
    status: "0x1",
    blockNumber: "0x1",
    logs: [{ ...event, address, logIndex: "0x0" }],
  };
  assert.equal(decodeOfficial("1", receipt).length, 0);
  const route = decodeOfficial("1", {
    ...receipt,
    logs: [{ ...receipt.logs[0], address: opDeployments["8453"].bridge }],
  })[0];
  assert.equal(route.status, "observed");
  assert.equal(route.destination.txHash, undefined);
  assert.equal(route.confidence, "source-only");
  assert.equal(route.destination.chainId, "8453");
});
const route = (
  id: string,
  protocol: string,
  sourceTx = hash,
  destTx = "0x" + "c".repeat(64),
): BridgeRoute => ({
  id,
  protocol,
  bridge: protocol,
  status: "delivered",
  source: leg("1", { txHash: sourceTx }),
  destination: leg("8453", { txHash: destTx }),
  confidence: "indexed",
  notes: [],
  evidence: [],
});
test("distinct messages in the same transaction are never collapsed by pair matching", () => {
  assert.equal(
    mergeRoutes([
      route("a", "wormhole"),
      route("b", "wormhole"),
      route("c", "lifi"),
    ]).length,
    3,
  );
  assert.equal(
    mergeRoutes([route("a", "wormhole"), route("b", "lifi")]).length,
    1,
  );
  assert.equal(
    mergeRoutes([route("a", "wormhole", "AaBb"), route("b", "lifi", "aabb")])
      .length,
    2,
  );
});
test("real Portal fixture derives the exact Base destination hash", () => {
  const receipt = JSON.parse(
    fs.readFileSync(
      new URL("./fixtures/base-deposit-receipt.json", import.meta.url),
      "utf8",
    ),
  );
  const rows = decodeOfficial("1", receipt);
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0].destination.txHash,
    "0x4cb5cb8217835d7edf5279c8f6486a67a57b6f27d468665c4099d8ff39773914",
  );
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].source.rawAmount, "2000000000000000000000");
});
test("OP successful receipt without finalized transfer event cannot prove delivery", async () => {
  const original = rpc.call;
  const src = "0x" + "1".repeat(64),
    dst = "0x" + "2".repeat(64);
  rpc.call = async (_chain, _method, params) => ({
    result: {
      transactionHash: params[0],
      status: "0x1",
      blockNumber: "0x1",
      logs: [],
    },
    endpoint: "mock.example",
    checked: ["mock.example"],
  });
  try {
    const r = route("official-unknown", "official", src, dst);
    r.status = "pending";
    r.source.address = address;
    r.destination.address = address;
    r.source.rawAmount = "1";
    r.destination.rawAmount = "1";
    await verifyRoutes([r]);
    assert.equal(r.status, "unknown");
    assert.ok(r.notes.some((n) => n.includes("Finalized")));
  } finally {
    rpc.call = original;
  }
});
test("OP finalization requires the same recipient and amount", async () => {
  const original = rpc.call;
  const src = "0x" + "3".repeat(64),
    dst = "0x" + "4".repeat(64);
  const iface = new Interface([
    "event ETHBridgeFinalized(address indexed from,address indexed to,uint256 amount,bytes extraData)",
  ]);
  const ev = iface.encodeEventLog(iface.getEvent("ETHBridgeFinalized")!, [
    address,
    address,
    1n,
    "0x",
  ]);
  rpc.call = async (chain, _method, params) => ({
    result: {
      transactionHash: params[0],
      status: "0x1",
      blockNumber: "0x1",
      logs:
        chain === "8453"
          ? [
              {
                ...ev,
                address: "0x4200000000000000000000000000000000000010",
                logIndex: "0x1",
              },
            ]
          : [],
    },
    endpoint: "mock.example",
    checked: ["mock.example"],
  });
  try {
    const r = route("official-complete", "official", src, dst);
    r.status = "pending";
    r.source.address = address;
    r.destination.address = address;
    r.source.rawAmount = "1";
    r.destination.rawAmount = "1";
    await verifyRoutes([r]);
    assert.equal(r.status, "delivered");
    assert.ok(
      r.evidence.some((e) => e.description.includes("ETHBridgeFinalized")),
    );
  } finally {
    rpc.call = original;
  }
});
test("RPC endpoint identity is rechecked when the same URL is listed under another chain", async () => {
  const pool = new RpcPool(async (_url, method) =>
    method === "eth_chainId" ? "0x1" : "0x123",
  );
  await pool.call(1, "eth_blockNumber", [], {
    endpoints: ["https://shared.example"],
  });
  await assert.rejects(
    () =>
      pool.call(8453, "eth_blockNumber", [], {
        endpoints: ["https://shared.example"],
      }),
    /체인 불일치/,
  );
});
