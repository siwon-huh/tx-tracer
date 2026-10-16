import snapshot from "./chainlist-snapshot.json";
import type { Chain } from "../shared/types";
import { jsonFetch } from "./http";
import {
  allCatalogChains,
  catalogMetadata,
  resolveChain,
  type ChainNamespace,
} from "./chain-catalog";

export const AUTO_CHAIN_IDS = [
  1, 8453, 42161, 10, 56, 137, 43114, 100, 324, 59144, 534352, 5000,
];
let chains: Chain[] = snapshot.chains;
let fetchedAt = snapshot.fetchedAt;
let lastAttempt = 0;
let refreshTask: Promise<void> | undefined;
let registryError: string | undefined;

export function isPublicRpcUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      !/^[\d.]+$|:|localhost|\.local$|\.internal$|\.test$/i.test(u.hostname) &&
      !/[${}<>]|api[_-]?key=|\/v[23]\//i.test(value)
    );
  } catch {
    return false;
  }
}
function rank(url: string) {
  if (/publicnode\.com/.test(url)) return 0;
  if (/drpc\.org|mainnet\.base\.org|arb1\.arbitrum\.io/.test(url)) return 1;
  if (/1rpc\.io|blastapi\.io|blockpi\.network/.test(url)) return 2;
  return 3;
}
export async function refreshChains(force = false) {
  if (refreshTask) return refreshTask;
  if (!force && Date.now() - lastAttempt < 6 * 3600_000) return;
  lastAttempt = Date.now();
  refreshTask = (async () => {
    try {
      const raw = await jsonFetch<any[]>(
        "https://chainlist.org/rpcs.json",
        {},
        8000,
      );
      if (!Array.isArray(raw)) throw new Error("Invalid Chainlist response");
      const next = normalizeChainlist(raw);
      if (next.length < 10) throw new Error("Chainlist 목록이 비어 있음");
      chains = next;
      fetchedAt = new Date().toISOString();
      registryError = undefined;
    } catch (e) {
      registryError = e instanceof Error ? e.message : "Chainlist unavailable";
    }
  })().finally(() => {
    refreshTask = undefined;
  });
  return refreshTask;
}
export function normalizeChainlist(raw: any[]): Chain[] {
  return raw
    .filter(
      (c) =>
        !c.isTestnet &&
        // Chainlist also includes TRON networks; they do not use this EVM RPC adapter.
        c.chain?.toUpperCase() !== "TRON" &&
        !/testnet|test net|sepolia|holesky|devnet/i.test(c.name || "") &&
        Number.isSafeInteger(c.chainId) &&
        c.chainId > 0,
    )
    .map((c) => ({
      id: c.chainId,
      name: c.name,
      symbol: c.nativeCurrency?.symbol || "ETH",
      explorer: c.explorers?.find((e: any) => e.standard === "EIP3091")?.url,
      rpcs: [
        ...new Set<string>(
          (c.rpc || [])
            .map((r: any) => (typeof r === "string" ? r : r.url))
            .filter(isPublicRpcUrl),
        ),
      ]
        .sort((a, b) => rank(a) - rank(b))
        .slice(0, 12),
    }));
}
export function allChains() {
  return chains;
}
export function getChain(id: string | number) {
  const key = canonicalChain(id);
  // This accessor is intentionally EVM-only: non-EVM metadata must never enable eth_* calls.
  if (
    key &&
    catalogMetadata(key)?.family !== undefined &&
    catalogMetadata(key)?.family !== "evm"
  )
    return undefined;
  return chains.find((c) => String(c.id) === key);
}
export function chainName(id?: string | number) {
  const key = canonicalChain(id);
  if (!key) return "확인되지 않음";
  return (
    getChain(key)?.name ??
    catalogMetadata(key)?.name ??
    (key.startsWith("layerzero:")
      ? `LayerZero EID ${key.slice(10)}`
      : key.startsWith("wormhole:")
        ? `Wormhole chain ${key.slice(9)}`
        : `Chain ${key}`)
  );
}
export function canonicalChain(
  id: unknown,
  namespace: ChainNamespace = "native",
): string | undefined {
  return resolveChain(id, namespace);
}
export function hasChain(id: string) {
  const key = canonicalChain(id)!;
  return !!getChain(key) || !!catalogMetadata(key);
}
export function displayChains() {
  const entries = new Map(
    allCatalogChains().map((c) => [
      c.id,
      { id: c.id, name: c.name, family: c.family, rpcCount: 0 },
    ]),
  );
  for (const c of chains) {
    const id = canonicalChain(c.id)!;
    if (id !== String(c.id)) continue;
    entries.set(id, {
      id,
      name: c.name,
      family: "evm",
      rpcCount: c.rpcs.length,
    });
  }
  return [...entries.values()];
}
export function txUrl(id?: string, hash?: string) {
  if (!hash) return undefined;
  const key = canonicalChain(id);
  const metadata = key ? catalogMetadata(key) : undefined;
  if (metadata && metadata.family !== "evm")
    return metadata.txTemplate?.replace(
      "{hash}",
      encodeURIComponent(key === "tron" ? hash.replace(/^0x/, "") : hash),
    );
  const explorer = key && getChain(key)?.explorer;
  return explorer
    ? `${explorer.replace(/\/$/, "")}/tx/${encodeURIComponent(hash)}`
    : metadata?.txTemplate?.replace("{hash}", encodeURIComponent(hash));
}
export function registryStatus() {
  return {
    source: "https://chainlist.org/rpcs.json",
    fetchedAt,
    error: registryError,
    count: chains.length,
  };
}
