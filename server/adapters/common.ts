import { formatUnits } from "ethers";
import type { ChainNamespace } from "../chain-catalog.js";
import { canonicalChain, chainName, txUrl } from "../chains.js";
import type { BridgeRoute, Evidence, Leg, QueryKind } from "../../shared/types.js";

export interface AdapterInput {
  query: string;
  kind: QueryKind;
  chainId?: string;
  days: number;
  limit: number;
  page: number;
  startTime?: string;
  endTime?: string;
}
export interface AdapterResult {
  routes: BridgeRoute[];
  detail: string;
  warnings?: string[];
  partial?: boolean;
  hasMore?: boolean;
}
export const evidence = (
  provider: string,
  url: string,
  description: string,
  details?: unknown,
): Evidence => ({
  provider,
  kind: "indexer",
  url,
  description,
  fetchedAt: new Date().toISOString(),
  details,
});
export function leg(
  id?: unknown,
  values: Partial<Leg> = {},
  namespace: ChainNamespace = "native",
): Leg {
  const chainId = canonicalChain(id, namespace);
  const defined = Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== undefined),
  );
  return {
    chainId,
    ...defined,
    chain:
      chainName(chainId).startsWith("Chain ") || !chainId
        ? values.chain || chainName(chainId)
        : chainName(chainId),
    explorerUrl: values.explorerUrl ?? txUrl(chainId, values.txHash),
  };
}
export function amount(raw: unknown, decimals: unknown): string | undefined {
  if (
    raw == null ||
    decimals == null ||
    decimals === "" ||
    !/^\d+$/.test(String(raw)) ||
    !Number.isInteger(Number(decimals)) ||
    Number(decimals) < 0 ||
    Number(decimals) > 255
  )
    return undefined;
  try {
    return formatUnits(String(raw), Number(decimals));
  } catch {
    return undefined;
  }
}
export function timestamp(value: unknown): string | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  const date = Number.isFinite(n)
    ? new Date(n > 1e14 ? n / 1e6 : n > 1e11 ? n : n * 1000)
    : new Date(String(value));
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}
export function sameAddress(a: string | undefined, b: string) {
  return a?.startsWith("0x") ? a.toLowerCase() === b.toLowerCase() : a === b;
}
