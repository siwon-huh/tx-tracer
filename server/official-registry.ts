import snapshot from "./official-snapshot.json" with { type: "json" };
import { getChain } from "./chains.js";
import { jsonFetch } from "./http.js";
type Deployment = {
  bridge: string;
  portal: string;
  name: string;
  nativeSymbol?: string;
  customGasToken?: boolean;
};
export const opDeployments: Record<string, Deployment> = {
  ...snapshot.deployments,
};
let fetchedAt = snapshot.fetchedAt;
let lastAttempt = 0;
let error: string | undefined;
const source =
  "https://raw.githubusercontent.com/ethereum-optimism/superchain-registry/main/";
export async function refreshOfficialRegistry() {
  if (Date.now() - lastAttempt < 6 * 3600_000) return;
  lastAttempt = Date.now();
  try {
    const [list, addresses] = await Promise.all([
      jsonFetch(`${source}chainList.json`, {}, 8000),
      jsonFetch(`${source}superchain/extra/addresses/addresses.json`, {}, 8000),
    ]);
    if (!Array.isArray(list) || typeof addresses !== "object")
      throw new Error("Invalid Superchain registry");
    const next: Record<string, Deployment> = { "8453": opDeployments["8453"] };
    for (const c of list) {
      if (
        !c.identifier?.startsWith("mainnet/") ||
        c.parent?.chain !== "mainnet"
      )
        continue;
      // Custom gas currencies may change ETH bridge semantics; separate adapters are required.
      if (c.gasPayingToken && !/^0x0{40}$/.test(c.gasPayingToken)) continue;
      if (
        (getChain(c.chainId)?.symbol ||
          (snapshot.deployments as Record<string, Deployment>)[
            String(c.chainId)
          ]?.nativeSymbol) !== "ETH"
      )
        continue;
      const d = addresses[String(c.chainId)];
      if (
        !/^0x[\da-f]{40}$/i.test(d?.L1StandardBridgeProxy) ||
        !/^0x[\da-f]{40}$/i.test(d?.OptimismPortalProxy)
      )
        continue;
      next[String(c.chainId)] = {
        bridge: d.L1StandardBridgeProxy,
        portal: d.OptimismPortalProxy,
        name: c.name,
        nativeSymbol: "ETH",
        customGasToken: false,
      };
    }
    if (Object.keys(next).length < 2)
      throw new Error("No valid Superchain registry entries");
    for (const k of Object.keys(opDeployments)) delete opDeployments[k];
    Object.assign(opDeployments, next);
    fetchedAt = new Date().toISOString();
    error = undefined;
  } catch (e) {
    error = e instanceof Error ? e.message : "Superchain registry unavailable";
  }
}
export function officialRegistryStatus() {
  return {
    fetchedAt,
    error,
    source,
    chains: Object.entries(opDeployments).map(([id, d]) => ({
      id,
      name: d.name,
    })),
  };
}
