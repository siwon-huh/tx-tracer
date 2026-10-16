import { useI18n } from "./i18n";
import { useState, type CSSProperties } from "react";
import catalog from "./logo-data.json";

type Logo = { name: string; path: string; aliases: string[] };
const chainLogos: Record<string, Logo> = catalog.chains;
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const bridgeLogos = new Map<string, Logo>();
for (const [key, logo] of Object.entries(catalog.bridges)) {
  for (const alias of [key, logo.name, ...logo.aliases]) bridgeLogos.set(normalize(alias), logo);
}
type SizeProps = { size?: number; className?: string };
function BrandLogo({ logo, name, size = 28, className = "" }: SizeProps & { logo?: Logo; name: string }) {
  const { t: tr } = useI18n();
  const [failedPath, setFailedPath] = useState("");
  const path = logo?.path;
  const available = path && path !== failedPath;
  return <span className={`brand-logo ${available ? "" : "is-fallback"} ${className}`}
    style={{ "--logo-size": `${size}px` } as CSSProperties} title={tr(available ? `${name} 로고` : `${name}  /  로고 미등록`)}>
    {available ? <img src={path} alt={tr(`${name} 로고`)} width={size} height={size} decoding="async" draggable={false} onError={() => setFailedPath(path)} />
      : <span role="img" aria-label={tr(`${name} 로고 미등록`)}>{tr(name).replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || "?"}</span>}
  </span>;
}
export function ChainLogo({ chainId, name, ...props }: SizeProps & { chainId?: string; name: string }) {
  return <BrandLogo logo={chainId ? chainLogos[chainId] : undefined} name={name} {...props} />;
}
export function BridgeLogo({ name, protocol, sourceChainId, destinationChainId, ...props }: SizeProps & {
  name: string; protocol?: string; sourceChainId?: string; destinationChainId?: string;
}) {
  // Official bridges use the L2's identity for both deposits and withdrawals.
  const l2 = protocol === "official" && [sourceChainId, destinationChainId].find(id => id && id !== "1");
  const logo = l2 ? chainLogos[l2] : bridgeLogos.get(normalize(name));
  return <BrandLogo logo={logo} name={name} {...props} />;
}
