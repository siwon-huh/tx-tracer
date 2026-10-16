import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { displayChains, refreshChains, registryStatus } from "./chains";
import { refreshChainCatalog, catalogStatus } from "./chain-catalog";
import { rpc } from "./rpc";
import { trace } from "./trace";
import { investigate } from "./investigate";
import { capabilities } from "./capabilities";
import { jsonFetch } from "./http";
import {
  refreshOfficialRegistry,
  officialRegistryStatus,
} from "./official-registry";

const app = express();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
app.disable("x-powered-by");
app.use(express.json({ limit: "4kb" }));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
let bridgeTools: any[] = [];
let toolsError: string | undefined;
let lastTools = 0;
async function refreshTools() {
  if (Date.now() - lastTools < 3600_000) return;
  lastTools = Date.now();
  try {
    const d = await jsonFetch("https://li.quest/v1/tools", {}, 8000);
    bridgeTools = (d.bridges || []).map((b: any) => ({
      key: b.key,
      name: b.name,
    }));
    toolsError = undefined;
  } catch (e) {
    toolsError = e instanceof Error ? e.message : "LI.FI tools unavailable";
  }
}
app.get("/api/config", (_req, res) => {
  void refreshChains().then(refreshOfficialRegistry);
  void refreshTools();
  void refreshChainCatalog();
  res.json({
    chains: displayChains(),
    chainCatalog: catalogStatus(),
    registry: registryStatus(),
    officialRegistry: officialRegistryStatus(),
    capabilities,
    bridgeTools,
    toolsError,
    credentials: {
      lifi: !!process.env.LIFI_API_KEY,
      etherscan: !!process.env.ETHERSCAN_API_KEY,
      rhino: !!process.env.RHINO_API_KEY,
    },
    autoChainCount: 12,
  });
});
app.get("/api/health", (_req, res) =>
  res.json({
    status: "ok",
    registry: registryStatus(),
    rpc: rpc.stats(),
    uptimeSeconds: Math.floor(process.uptime()),
  }),
);
let active = 0;
const rate = new Map<string, { count: number; until: number }>();
app.post(["/api/trace", "/api/investigate"], async (req, res) => {
  // Local default, with bounded work if explicitly hosted behind a private reverse proxy.
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) {
    res.status(403).json({ error: "동일 출처에서만 조회할 수 있습니다." });
    return;
  }
  const ip = req.ip || "local";
  const now = Date.now();
  let entry = rate.get(ip);
  if (!entry || entry.until < now) {
    entry = { count: 0, until: now + 60_000 };
    rate.set(ip, entry);
  }
  if (rate.size > 1000)
    for (const [k, v] of rate) if (v.until < now) rate.delete(k);
  if (entry.count++ >= 15 || active >= 3) {
    res
      .status(429)
      .json({ error: "조회 요청이 많습니다. 잠시 후 다시 시도하세요." });
    return;
  }
  active++;
  try {
    res.json(await (req.path === "/api/investigate" ? investigate(req.body) : trace(req.body)));
  } catch (e) {
    res.status(e instanceof ZodError ? 400 : 400).json({
      error:
        e instanceof ZodError
          ? "검색 옵션 형식이 올바르지 않습니다."
          : e instanceof Error
            ? e.message
            : "조회 실패",
    });
  } finally {
    active--;
  }
});
app.get("/api/example", (_req, res) =>
  res.json({
    query: "0x3fe11542154f53dcf3134eacb30ea5ca586c9e134c223e56bbe1893862469bc5",
    chainId: "1",
    label: "실제 deBridge · Ethereum → Arbitrum",
  }),
);
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.join(root, "dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 4317);
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => {
  console.log(`Tx Tracer · http://${host}:${port}`);
  void refreshChains().then(refreshOfficialRegistry);
  void refreshTools();
  void refreshChainCatalog();
});
