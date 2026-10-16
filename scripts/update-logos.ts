import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalChain } from "../server/chains";

type Logo = { name: string; path: string; source: string; sourcePage: string; aliases: string[] };
const root = resolve(import.meta.dirname, "..");
const chains: Record<string, Logo> = {}, bridges: Record<string, Logo> = {};
const assets = new Map<string, Promise<string>>();
async function get(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return response;
}
async function asset(url: string) {
  if (!assets.has(url)) assets.set(url, (async () => {
    const response = await get(url);
    const mime = response.headers.get("content-type")?.split(";")[0];
    const extension = ({ "image/svg+xml": "svg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[mime || ""];
    if (!extension) throw new Error(`Unsupported logo format: ${mime} ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 1_000_000) throw new Error(`Oversized logo: ${url}`);
    if (extension === "svg" && (!bytes.toString().includes("<svg") || /<script|<foreignObject|\bon\w+\s*=|(?:href|src)\s*=\s*["']https?:/i.test(bytes.toString())))
      throw new Error(`Logo is not a standalone SVG: ${url}`);
    const path = `/logos/${createHash("sha256").update(bytes).digest("hex").slice(0, 20)}.${extension}`;
    await writeFile(resolve(root, `public${path}`), bytes);
    return path;
  })());
  return assets.get(url)!;
}
async function add(target: Record<string, Logo>, key: string, name: string, url: string, sourcePage: string, aliases: string[] = []) {
  target[key] = { name, path: await asset(url), source: url, sourcePage, aliases };
}
await mkdir(resolve(root, "public/logos"), { recursive: true });
const chainSource = "https://li.quest/v1/chains?chainTypes=EVM,SVM,UTXO,MVM,TVM,STL";
const toolSource = "https://li.quest/v1/tools";
const bridgeDirectory = "https://api.github.com/repos/lifinance/types/contents/src/assets/icons/bridges";
const [chainData, toolData, bridgeFiles] = await Promise.all([chainSource, toolSource, bridgeDirectory].map(async url => (await get(url)).json()));
const jobs: (() => Promise<void>)[] = [];
for (const chain of chainData.chains) {
  if (!chain.logoURI || !chain.mainnet) continue;
  const id = canonicalChain(chain.id, "lifi");
  if (id) jobs.push(() => add(chains, id, chain.name, chain.logoURI, chainSource));
}
// These networks remain useful for historical transfers even when absent from /chains.
for (const [id, name, file] of [
  ["bitcoincash", "Bitcoin Cash", "bitcoincash"], ["litecoin", "Litecoin", "litecoin"], ["dogecoin", "Dogecoin", "dogecoin"],
  ["288", "Boba Network", "boba"], ["60808", "BOB", "bob"], ["81457", "Blast", "blast"],
  ["250", "Fantom", "fantom"], ["1313161554", "Aurora", "aurora"],
]) jobs.push(() => add(chains, id, name, `https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/${file}.svg`, "https://github.com/lifinance/types/tree/main/src/assets/icons/chains"));
for (const file of bridgeFiles) {
  if (!file.name.endsWith(".svg")) continue;
  const key = file.name.replace(/\.svg$/, "");
  jobs.push(() => add(bridges, key, key, file.download_url, "https://github.com/lifinance/types/tree/main/src/assets/icons/bridges"));
}
// Bound download concurrency; this command runs manually, never during user searches.
let next = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < jobs.length) await jobs[next++]();
}));
for (const bridge of toolData.bridges) {
  if (!bridge.logoURI) continue;
  await add(bridges, bridge.key, bridge.name, bridge.logoURI, toolSource, [bridge.name]);
}
const extras = [
  // Official black mark on yellow tile stays legible on the app's light surfaces.
  ["debridge", "deBridge", "https://debridge.com/assets/img/logo/avatar-yellow.svg", "https://debridge.com/brand/", ["deBridge DLN", "DLN"]],
  ["wormhole", "Wormhole", "https://static.wormhole.com/logomark-black.svg", "https://wormhole.com/brand-and-press", ["Wormhole · Portal"]],
  ["portal", "Portal", "https://static.wormhole.com/portal_logomark_black.svg", "https://wormhole.com/brand-and-press", ["Portal / Wormhole", "Portal Bridge"]],
  ["ccip", "Chainlink CCIP", "https://cdn.prod.website-files.com/5f6b7190899f41fb70882d08/6aa7fef7f56d1f1d953c589d_Chainlink-Symbol-Blue.svg", "https://chain.link/brand-assets", ["Chainlink", "CCIP"]],
  ["thorchain", "THORChain", "https://cdn.sanity.io/images/355nlzcp/production/c973725813bf6fcd1c3a0a37adf3252677529ace-512x512.png", "https://thorchain.org/brand-assets", []],
  ["rhino", "rhino.fi", "https://framerusercontent.com/images/DeMxiKOVdNxCUXD2bNcefpsGw8o.png", "https://rhino.fi", ["rhino.fi"]],
  ["layerzero", "LayerZero", "https://layerzero.network/images/logo-layerzero.png", "https://layerzero.network", ["LayerZero application"]],
] as const;
for (const [key, name, url, source, aliases] of extras) await add(bridges, key, name, url, source, [...aliases]);
chains.thorchain = bridges.thorchain;
bridges.lifi.aliases.push("LI.FI", "LI.FI route", "LI.FI 생태계");
bridges.stargate.aliases.push("Stargate · LayerZero");
bridges.arbitrum.aliases.push("Arbitrum Official");
bridges.optimism.aliases.push("L2 Official · OP Stack");
const sorted = (items: Record<string, Logo>) => Object.fromEntries(Object.entries(items).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(resolve(root, "shared/logo-catalog.json"), JSON.stringify({ updatedAt: new Date().toISOString(), chains: sorted(chains), bridges: sorted(bridges) }, null, 2) + "\n");
const display = (items: Record<string, Logo>) => Object.fromEntries(Object.entries(sorted(items)).map(([key, { name, path, aliases }]) => [key, { name, path, aliases }]));
await writeFile(resolve(root, "src/logo-data.json"), JSON.stringify({ chains: display(chains), bridges: display(bridges) }, null, 2) + "\n");
console.log(`Saved ${Object.keys(chains).length} chain logos and ${Object.keys(bridges).length} bridge entries (${assets.size} source assets).`);
