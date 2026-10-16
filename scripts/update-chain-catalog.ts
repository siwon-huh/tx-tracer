import fs from "node:fs/promises";
import ts from "typescript";
import {
  emptyCatalog,
  addMetadata,
  applyLifi,
  applyDebridge,
  applyLayerzero,
  catalogSources,
} from "../server/chain-catalog";
import { normalizeChainlist } from "../server/chains";

// Parse literal data from the official SDK. Never execute downloaded TypeScript.
function literal(node: ts.Expression): any {
  if (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node)
  )
    return literal(node.expression);
  if (ts.isArrayLiteralExpression(node))
    return node.elements.map((n) => literal(n as ts.Expression));
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  if (ts.isBigIntLiteral(node)) return node.text.slice(0, -1);
  if (ts.isObjectLiteralExpression(node))
    return Object.fromEntries(
      node.properties.map((p) => {
        if (!ts.isPropertyAssignment(p))
          throw new Error("Non-literal SDK object");
        return [
          p.name.getText().replace(/^["']|["']$/g, ""),
          literal(p.initializer),
        ];
      }),
    );
  throw new Error(`Non-literal SDK value: ${node.kind}`);
}
function readConstant(source: string, name: string): any {
  const ast = ts.createSourceFile(
    "constants.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  for (const statement of ast.statements)
    if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations)
        if (d.name.getText() === name && d.initializer)
          return literal(d.initializer);
    }
  throw new Error(`SDK constant missing: ${name}`);
}
const root =
  "https://raw.githubusercontent.com/wormhole-foundation/wormhole-sdk-ts/main/core/base/src/constants/";
const sources = {
  ...catalogSources,
  wormholeChains: `${root}chains.ts`,
  wormholeNative: `${root}nativeChainIds.ts`,
  wormholePlatforms: `${root}platforms.ts`,
  wormholeExplorers: `${root}explorer.ts`,
};
const raw = Object.fromEntries(
  await Promise.all(
    Object.entries(sources).map(async ([name, url]) => {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
      return [name, await r.text()];
    }),
  ),
);
const catalog = emptyCatalog();
applyLifi(catalog, JSON.parse(raw.lifi));
applyDebridge(catalog, JSON.parse(raw.debridge));
applyLayerzero(catalog, JSON.parse(raw.layerzero));
const wormholeChains = readConstant(
  raw.wormholeChains,
  "chainIdAndChainEntries",
) as [string, string][];
const native = new Map<string, string>(
  readConstant(raw.wormholeNative, "chainNetworkNativeChainIdEntries").find(
    ([network]: string[]) => network === "Mainnet",
  )[1],
);
const platforms = new Map<string, string>();
for (const [platform, chains] of readConstant(
  raw.wormholePlatforms,
  "platformAndChainsEntries",
))
  for (const chain of chains) platforms.set(chain, platform);
const explorers = new Map<string, any>(
  readConstant(raw.wormholeExplorers, "explorerConfig").find(
    ([network]: string[]) => network === "Mainnet",
  )[1],
);
for (const [wid, name] of wormholeChains) {
  if (/Sepolia|Holesky|Testnet/.test(name)) continue;
  const platform = platforms.get(name);
  const special: Record<string, string> = {
    Btc: "bitcoin",
    Xrpl: "xrp",
    Cosmoshub: "cosmos",
    HyperCore: "hypercore",
  };
  const id =
    special[name] ||
    (platform === "Evm" ? native.get(name) : name.toLowerCase());
  if (!id) continue;
  catalog.aliases.wormhole[wid] = id;
  const explorer = explorers.get(name);
  addMetadata(catalog, {
    id,
    name: name.replace(/([a-z])([A-Z])/g, "$1 $2"),
    family: platform?.toLowerCase() || "unknown",
    txTemplate:
      explorer?.baseUrl && explorer?.endpoints?.tx
        ? `${explorer.baseUrl.replace(/\/$/, "")}/${explorer.endpoints.tx}{hash}`
        : undefined,
  });
}
// Historical chains remain useful when tracing old transfers; official legacy SDK IDs.
const legacy: Record<string, [string, string]> = {
  terra: ["terra-classic", "Terra Classic"],
  terra2: ["terra", "Terra"],
  oasis: ["42262", "Oasis Emerald"],
  aurora: ["1313161554", "Aurora"],
  fantom: ["250", "Fantom"],
  karura: ["686", "Karura"],
  acala: ["787", "Acala"],
  neon: ["245022934", "Neon"],
  gnosis: ["100", "Gnosis"],
  xpla: ["xpla", "XPLA"],
  rootstock: ["30", "Rootstock"],
  mantle: ["5000", "Mantle"],
  snaxchain: ["2192", "SnaxChain"],
  blast: ["81457", "Blast"],
  scroll: ["534352", "Scroll"],
  xlayer: ["196", "X Layer"],
};
// Historical entries are verified against the official legacy SDK before being included.
const legacyUrl =
  "https://raw.githubusercontent.com/wormhole-foundation/wormhole/main/sdk/js/src/utils/consts.ts";
const legacyResponse = await fetch(legacyUrl, {
  signal: AbortSignal.timeout(20000),
});
if (legacyResponse.ok) {
  const legacyChains = readConstant(await legacyResponse.text(), "CHAINS");
  for (const [key, [id, name]] of Object.entries(legacy)) {
    const wid = legacyChains[key];
    if (!wid || catalog.aliases.wormhole[wid]) continue;
    catalog.aliases.wormhole[wid] = id;
    addMetadata(catalog, {
      id,
      name,
      family: /^\d+$/.test(id) ? "evm" : "unknown",
    });
  }
}
catalog.sources = [...Object.values(sources), legacyUrl];
await fs.writeFile(
  new URL("../server/protocol-chain-snapshot.json", import.meta.url),
  JSON.stringify(catalog, null, 2) + "\n",
);
const chainlistResponse = await fetch("https://chainlist.org/rpcs.json", {
  signal: AbortSignal.timeout(20000),
});
if (!chainlistResponse.ok)
  throw new Error(`Chainlist: HTTP ${chainlistResponse.status}`);
const chains = normalizeChainlist((await chainlistResponse.json()) as any[]);
if (chains.length < 100) throw new Error("Incomplete Chainlist snapshot");
await fs.writeFile(
  new URL("../server/chainlist-snapshot.json", import.meta.url),
  JSON.stringify(
    {
      fetchedAt: new Date().toISOString(),
      source: "https://chainlist.org/rpcs.json",
      chains,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Chainlist metadata: ${chains.length} chains (${chains.filter((c) => c.rpcs.length).length} with public RPCs)`,
);
console.log(
  JSON.stringify(
    {
      chains: Object.keys(catalog.chains).length,
      mappings: Object.fromEntries(
        Object.entries(catalog.aliases).map(([key, value]) => [
          key,
          Object.keys(value).length,
        ]),
      ),
    },
    null,
    2,
  ),
);
