import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalChain,
  chainName,
  displayChains,
  getChain,
  normalizeChainlist,
  txUrl,
} from "../server/chains";
import {
  applyDebridge,
  applyLayerzero,
  emptyCatalog,
} from "../server/chain-catalog";
import { leg } from "../server/adapters/common";
import { normalizeCcip } from "../server/adapters/ccip";
import { querySchema, rpcChainsForQuery } from "../server/trace";

test("Tron IDs from deBridge, LI.FI, LayerZero and the native network converge", () => {
  for (const [id, namespace] of [
    [100000026, "debridge"],
    [728126428, "lifi"],
    [30420, "layerzero"],
    [420, "layerzero"],
    [728126428, "native"],
    ["0x2b6653dc", "native"],
  ] as const) {
    assert.equal(canonicalChain(id, namespace), "tron");
    const side = leg(id, { txHash: "0x" + "a".repeat(64) }, namespace);
    assert.equal(side.chain, "Tron");
    assert.equal(
      side.explorerUrl,
      `https://tronscan.org/#/transaction/${"a".repeat(64)}`,
    );
  }
  assert.equal(getChain("tron"), undefined);
  assert.equal(getChain(728126428), undefined);
});

test("deBridge virtual EVM IDs resolve to native networks", () => {
  for (const [id, native] of [
    [100000013, "1514"],
    [100000019, "25"],
    [100000022, "999"],
    [100000029, "1776"],
    [100000030, "143"],
    [100000031, "4326"],
  ] as const)
    assert.equal(canonicalChain(id, "debridge"), native);
});

test("chain ID namespaces cannot turn Solana, Aptos or HyperCore into Ethereum", () => {
  assert.equal(canonicalChain(1, "wormhole"), "solana");
  assert.equal(canonicalChain(1), "1");
  assert.equal(canonicalChain(30108, "layerzero"), "aptos");
  assert.equal(canonicalChain(1337, "lifi"), "hypercore");
  assert.equal(canonicalChain(1337), "1337");
  assert.equal(canonicalChain(99999999, "layerzero"), "layerzero:99999999");
  assert.equal(canonicalChain(99999, "wormhole"), "wormhole:99999");
  assert.equal(getChain("wormhole:1"), undefined);
});

test("Wormhole legacy and recent IDs match the official SDK", () => {
  for (const [id, native] of [
    [25, "100"],
    [34, "534352"],
    [35, "5000"],
    [37, "196"],
    [38, "59144"],
    [39, "80094"],
    [40, "1329"],
    [43, "2192"],
    [44, "130"],
    [46, "57073"],
    [48, "143"],
    [52, "146"],
  ] as const)
    assert.equal(canonicalChain(id, "wormhole"), native, `Wormhole ${id}`);
});

test("non-EVM chains remain selectable and have readable names without EVM RPCs", () => {
  for (const id of [
    "tron",
    "solana",
    "bitcoin",
    "sui",
    "aptos",
    "stellar",
    "ton",
    "fogo",
    "starknet",
    "xrp",
  ]) {
    assert.ok(!chainName(id).startsWith("Chain "), id);
    assert.ok(
      displayChains().some((c) => c.id === id),
      id,
    );
    assert.equal(getChain(id), undefined, id);
    assert.equal(
      querySchema.parse({ query: "a".repeat(64), chainId: id }).chainId,
      id,
    );
  }
  assert.equal(canonicalChain("9270000000000000", "lifi"), "sui");
  assert.ok(txUrl("stellar", "abc")?.includes("/public/tx/abc"));
});

test("metadata keeps a chain name even when every RPC requires a key", () => {
  const rows = normalizeChainlist([
    {
      chainId: 123456789,
      name: "Named Chain",
      rpc: ["https://rpc.example/v3/${KEY}"],
      nativeCurrency: { symbol: "TEST" },
    },
  ]);
  assert.equal(rows[0]?.name, "Named Chain");
  assert.deepEqual(rows[0]?.rpcs, []);
  assert.deepEqual(normalizeChainlist([{ chainId: 3448148188, chain: "TRON", name: "Tron Nile", isTestnet: false, rpc: [] }]), []);
});

test("new protocol IDs can be learned from official metadata with family separation", () => {
  const data = emptyCatalog();
  applyDebridge(data, {
    chains: [
      { chainId: 100000099, originalChainId: 12345, chainName: "New Chain" },
    ],
  });
  assert.equal(data.aliases.debridge["100000099"], "12345");
  applyLayerzero(
    data,
    Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        String(i),
        {
          chainDetails: {
            chainType: "aptos",
            nativeChainId: 1,
            chainKey: "aptos",
          },
          deployments: [
            { eid: String(39900 + i), stage: i ? "testnet" : "mainnet" },
          ],
        },
      ]),
    ),
  );
  assert.equal(data.aliases.layerzero["39900"], "aptos");
  assert.equal(data.aliases.layerzero["39901"], undefined);
});

test("API-provided slugs do not overwrite known names; CCIP family disambiguates native IDs", () => {
  assert.equal(
    leg(30420, { chain: "tron-mainnet" }, "layerzero").chain,
    "Tron",
  );
  const route = normalizeCcip(
    {
      messageId: "test",
      sourceNetworkInfo: { chainFamily: "aptos", chainId: "1" },
      destNetworkInfo: { chainFamily: "evm", chainId: 1 },
    },
    "https://api.ccip.chain.link",
  );
  assert.equal(route.source.chain, "Aptos");
  assert.equal(route.destination.chainId, "1");
});

test("a known Tron transaction is never probed through Ethereum RPCs", () => {
  const hash = "a".repeat(64);
  const route = normalizeCcip(
    {
      messageId: "test",
      sourceNetworkInfo: { chainFamily: "tron", chainId: 728126428 },
      sendTransactionHash: hash,
    },
    "https://api.ccip.chain.link",
  );
  assert.deepEqual(rpcChainsForQuery(`0x${hash}`, undefined, [route]), []);
  assert.deepEqual(rpcChainsForQuery(`0x${hash}`, "tron", []), []);
});
