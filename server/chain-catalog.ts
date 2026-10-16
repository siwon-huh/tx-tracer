import snapshot from "./protocol-chain-snapshot.json";
import { jsonFetch } from "./http";

export type ChainNamespace =
  "native" | "lifi" | "debridge" | "layerzero" | "wormhole";
export interface ChainMetadata {
  id: string;
  name: string;
  family: string;
  symbol?: string;
  txTemplate?: string;
}
export interface ChainCatalog {
  fetchedAt: string;
  sources: string[];
  chains: Record<string, ChainMetadata>;
  aliases: Record<ChainNamespace, Record<string, string>>;
}
export const catalogSources = {
  lifi: "https://li.quest/v1/chains?chainTypes=EVM,SVM,UTXO,MVM,TVM,STL",
  debridge: "https://dln.debridge.finance/v1.0/supported-chains-info",
  layerzero: "https://metadata.layerzero-api.com/v1/metadata/deployments",
};
const nativeAliases: Record<string, string> = {
  "728126428": "tron",
  "7565164": "solana",
  "1151111081099710": "solana",
  "1021111031099710": "fogo",
  "9270000000000000": "sui",
  "1201081091099710": "stellar",
  "20000000000001": "bitcoin",
  "20000000000002": "bitcoincash",
  "20000000000003": "litecoin",
  "20000000000004": "dogecoin",
  "20000000000005": "zcash",
};
export const nonEvmSeeds: ChainMetadata[] = [
  {
    id: "tron",
    name: "Tron",
    family: "tron",
    symbol: "TRX",
    txTemplate: "https://tronscan.org/#/transaction/{hash}",
  },
  {
    id: "solana",
    name: "Solana",
    family: "solana",
    symbol: "SOL",
    txTemplate: "https://solscan.io/tx/{hash}",
  },
  {
    id: "bitcoin",
    name: "Bitcoin",
    family: "utxo",
    symbol: "BTC",
    txTemplate: "https://mempool.space/tx/{hash}",
  },
  {
    id: "litecoin",
    name: "Litecoin",
    family: "utxo",
    symbol: "LTC",
    txTemplate: "https://litecoinspace.org/tx/{hash}",
  },
  {
    id: "bitcoincash",
    name: "Bitcoin Cash",
    family: "utxo",
    symbol: "BCH",
    txTemplate: "https://blockchair.com/bitcoin-cash/transaction/{hash}",
  },
  {
    id: "dogecoin",
    name: "Dogecoin",
    family: "utxo",
    symbol: "DOGE",
    txTemplate: "https://dogechain.info/tx/{hash}",
  },
  { id: "zcash", name: "Zcash", family: "utxo", symbol: "ZEC" },
  {
    id: "thorchain",
    name: "THORChain",
    family: "cosmos",
    symbol: "RUNE",
    txTemplate: "https://thorchain.net/tx/{hash}",
  },
  {
    id: "cosmos",
    name: "Cosmos Hub",
    family: "cosmos",
    symbol: "ATOM",
    txTemplate: "https://www.mintscan.io/cosmos/tx/{hash}",
  },
  {
    id: "sui",
    name: "Sui",
    family: "sui",
    symbol: "SUI",
    txTemplate: "https://suivision.xyz/txblock/{hash}",
  },
  {
    id: "aptos",
    name: "Aptos",
    family: "aptos",
    symbol: "APT",
    txTemplate: "https://explorer.aptoslabs.com/txn/{hash}?network=mainnet",
  },
  {
    id: "stellar",
    name: "Stellar",
    family: "stellar",
    symbol: "XLM",
    txTemplate: "https://stellar.expert/explorer/public/tx/{hash}",
  },
  {
    id: "starknet",
    name: "Starknet",
    family: "starknet",
    symbol: "STRK",
    txTemplate: "https://voyager.online/tx/{hash}",
  },
  {
    id: "ton",
    name: "TON",
    family: "ton",
    symbol: "TON",
    txTemplate: "https://tonviewer.com/transaction/{hash}",
  },
  {
    id: "xrp",
    name: "XRP Ledger",
    family: "xrpl",
    symbol: "XRP",
    txTemplate: "https://livenet.xrpl.org/transactions/{hash}",
  },
  {
    id: "hypercore",
    name: "Hyperliquid (HyperCore)",
    family: "hypercore",
    symbol: "HYPE",
  },
  { id: "fogo", name: "Fogo", family: "solana", symbol: "FOGO" },
];
export function emptyCatalog(): ChainCatalog {
  return {
    fetchedAt: new Date().toISOString(),
    sources: Object.values(catalogSources),
    chains: Object.fromEntries(nonEvmSeeds.map((c) => [c.id, { ...c }])),
    aliases: {
      native: { ...nativeAliases },
      lifi: {},
      debridge: {},
      layerzero: {},
      wormhole: {},
    },
  };
}
function httpsBase(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const u = new URL(value);
    if (u.protocol === "https:" && !u.username && !u.password)
      return value.replace(/\/$/, "");
  } catch {
    /* Unknown explorer. */
  }
}
export function addMetadata(catalog: ChainCatalog, chain: ChainMetadata) {
  const old = catalog.chains[chain.id];
  catalog.chains[chain.id] = {
    ...old,
    ...Object.fromEntries(
      Object.entries(chain).filter(([, value]) => value !== undefined),
    ),
  } as ChainMetadata;
  // Chain-specific URL paths and non-EVM names take precedence over generic explorer metadata.
  const seed = nonEvmSeeds.find((c) => c.id === chain.id);
  if (seed) Object.assign(catalog.chains[chain.id], seed);
}
export function applyLifi(catalog: ChainCatalog, data: any) {
  if (!Array.isArray(data.chains) || !data.chains.length)
    throw new Error("LI.FI 체인 목록 형식 오류");
  for (const c of data.chains) {
    if (c.mainnet === false || c.id == null || typeof c.name !== "string")
      continue;
    const id =
      c.key === "hpl"
        ? "hypercore"
        : nativeAliases[String(c.id)] ||
          (c.chainType === "EVM" ? String(c.id) : `lifi-${c.key}`);
    catalog.aliases.lifi[String(c.id)] = id;
    const base = httpsBase(c.metamask?.blockExplorerUrls?.[0]);
    addMetadata(catalog, {
      id,
      name: c.name,
      family:
        id === "hypercore" ? "hypercore" : String(c.chainType).toLowerCase(),
      symbol: c.nativeToken?.symbol,
      txTemplate:
        c.chainType === "EVM" && id !== "hypercore" && base
          ? `${base}/tx/{hash}`
          : undefined,
    });
  }
}
export function applyDebridge(catalog: ChainCatalog, data: any) {
  if (!Array.isArray(data.chains) || !data.chains.length)
    throw new Error("deBridge 체인 목록 형식 오류");
  for (const c of data.chains) {
    if (
      c.chainId == null ||
      c.originalChainId == null ||
      typeof c.chainName !== "string"
    )
      continue;
    const id =
      nativeAliases[String(c.originalChainId)] || String(c.originalChainId);
    catalog.aliases.debridge[String(c.chainId)] = id;
    addMetadata(catalog, {
      id,
      name: c.chainName,
      family: /^\d+$/.test(id) ? "evm" : id,
    });
  }
}
export function applyLayerzero(catalog: ChainCatalog, data: any) {
  if (!data || typeof data !== "object" || Object.keys(data).length < 10)
    throw new Error("LayerZero 체인 목록 형식 오류");
  for (const [key, c] of Object.entries<any>(data)) {
    const deployments = (c.deployments || []).filter(
      (d: any) => d.stage === "mainnet" && /^\d+$/.test(String(d.eid)),
    );
    if (!deployments.length) continue;
    const details = c.chainDetails || {};
    const slug = details.chainKey || key.replace(/-mainnet$/, "");
    // Aptos and Solana native IDs can equal EVM chain IDs. Resolve by family first.
    const evm = details.chainType === "evm";
    const id =
      evm && details.nativeChainId != null
        ? String(details.nativeChainId)
        : slug === "iotal1"
          ? "iota"
          : slug;
    if (evm && !/^\d+$/.test(id)) continue;
    for (const d of deployments) catalog.aliases.layerzero[String(d.eid)] = id;
    const base = httpsBase(c.blockExplorers?.[0]?.url);
    addMetadata(catalog, {
      id,
      name:
        details.name ||
        details.shortName ||
        slug.replace(
          /(^|-)(\w)/g,
          (_: string, prefix: string, letter: string) =>
            `${prefix ? " " : ""}${letter.toUpperCase()}`,
        ),
      family: details.chainType || "unknown",
      symbol: details.nativeCurrency?.symbol,
      txTemplate: evm && base ? `${base}/tx/{hash}` : undefined,
    });
  }
}
let catalog = snapshot as ChainCatalog;
let lastAttempt = 0;
let refreshTask: Promise<void> | undefined;
let errors: string[] = [];
export function resolveChain(
  id: unknown,
  namespace: ChainNamespace = "native",
): string | undefined {
  if (id == null || id === "") return undefined;
  let key = String(id);
  if (namespace === "native" && /^0x[\da-f]+$/i.test(key))
    key = BigInt(key).toString();
  const mapped = catalog.aliases[namespace][key];
  if (mapped) return mapped;
  if (namespace === "wormhole" || namespace === "layerzero")
    return `${namespace}:${key}`;
  return (
    catalog.aliases.native[key] ||
    (catalog.chains[key.toLowerCase()] ? key.toLowerCase() : key)
  );
}
export const catalogMetadata = (id: string) => catalog.chains[id];
export const allCatalogChains = () => Object.values(catalog.chains);
export function catalogStatus() {
  return {
    fetchedAt: catalog.fetchedAt,
    count: Object.keys(catalog.chains).length,
    mappings: Object.fromEntries(
      Object.entries(catalog.aliases).map(([key, value]) => [
        key,
        Object.keys(value).length,
      ]),
    ),
    errors,
  };
}
export async function refreshChainCatalog(force = false) {
  if (refreshTask) return refreshTask;
  if (!force && Date.now() - lastAttempt < 6 * 3600_000) return;
  lastAttempt = Date.now();
  refreshTask = (async () => {
    const next = structuredClone(catalog);
    const sources = Object.entries(catalogSources);
    const results = await Promise.allSettled(
      sources.map(([, url]) => jsonFetch(url, {}, 12000)),
    );
    const nextErrors: string[] = [];
    results.forEach((result, index) => {
      const provider = sources[index][0] as keyof typeof catalogSources;
      try {
        if (result.status === "rejected") throw result.reason;
        ({
          lifi: applyLifi,
          debridge: applyDebridge,
          layerzero: applyLayerzero,
        })[provider](next, result.value);
      } catch {
        nextErrors.push(`${provider} 체인 목록 갱신 실패 · 저장된 매핑 사용`);
      }
    });
    next.fetchedAt = new Date().toISOString();
    catalog = next;
    errors = nextErrors;
  })().finally(() => {
    refreshTask = undefined;
  });
  return refreshTask;
}
