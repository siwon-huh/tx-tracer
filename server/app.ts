import express, { type Request, type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { displayChains, refreshChains, registryStatus } from "./chains.js";
import { refreshChainCatalog, catalogStatus } from "./chain-catalog.js";
import { rpc } from "./rpc.js";
import { trace } from "./trace.js";
import { investigate } from "./investigate.js";
import { capabilities } from "./capabilities.js";
import { jsonFetch } from "./http.js";
import { refreshOfficialRegistry, officialRegistryStatus } from "./official-registry.js";
import { createRateLimiter, type RateLimiter } from "./rate-limit.js";
import { SEARCH_TIMEOUT_MS, SearchTimeoutError, withSearchBudget } from "./search-context.js";

let bridgeTools: { key: string; name: string }[] = [];
let toolsError: string | undefined;
let lastTools = 0;
async function refreshTools() {
  if (Date.now() - lastTools < 3600_000) return;
  lastTools = Date.now();
  try {
    const data = await jsonFetch("https://li.quest/v1/tools", {}, 8000);
    bridgeTools = (data.bridges || []).map((b: any) => ({ key: b.key, name: b.name }));
    toolsError = undefined;
  } catch { toolsError = "LI.FI tools unavailable"; }
}
export async function refreshMetadata() {
  await Promise.allSettled([refreshChains().then(refreshOfficialRegistry), refreshTools(), refreshChainCatalog()]);
}

type AppOptions = {
  backgroundTask?: (task: Promise<unknown>) => void;
  clientIp?: (request: Request) => string | undefined;
  rateLimit?: RateLimiter;
  refresh?: typeof refreshMetadata;
  trace?: typeof trace;
  investigate?: typeof investigate;
  searchTimeoutMs?: number;
};
export function createApp(options: AppOptions = {}) {
  const app = express();
  const rateLimit = options.rateLimit ?? createRateLimiter();
  let active = 0;
  app.disable("x-powered-by");
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use(express.json({ limit: "4kb" }));
  app.get("/api/config", (_req, res) => {
    const task = (options.refresh ?? refreshMetadata)().catch(() => undefined);
    options.backgroundTask?.(task);
    res.json({
      chains: displayChains(), chainCatalog: catalogStatus(), registry: registryStatus(),
      officialRegistry: officialRegistryStatus(), capabilities, bridgeTools, toolsError,
      credentials: { lifi: !!process.env.LIFI_API_KEY, etherscan: !!process.env.ETHERSCAN_API_KEY, rhino: !!process.env.RHINO_API_KEY },
      autoChainCount: 12,
    });
  });
  app.get("/api/health", (_req, res) => res.json({
    status: "ok", registry: registryStatus(), rpc: rpc.stats(), uptimeSeconds: Math.floor(process.uptime()),
  }));
  app.post(["/api/trace", "/api/investigate"], async (req, res) => {
    const origin = req.headers.origin;
    let sameOrigin = !origin;
    try { if (origin) sameOrigin = new URL(origin).host === req.headers.host; } catch { sameOrigin = false; }
    if (!sameOrigin) {
      res.status(403).json({ error: "동일 출처에서만 조회할 수 있습니다." });
      return;
    }
    if (active >= 3) {
      res.setHeader("Retry-After", "5");
      res.status(429).json({ error: "조회 요청이 많습니다. 잠시 후 다시 시도하세요." });
      return;
    }
    // Reserve the instance slot before awaiting a shared limiter.
    active++;
    const controller = new AbortController();
    const disconnect = () => { if (!res.writableEnded) controller.abort(new Error("조회가 취소되었습니다.")); };
    res.once("close", disconnect);
    try {
      let decision;
      try { decision = await rateLimit(options.clientIp?.(req) || req.ip || "unknown"); }
      catch {
        res.setHeader("Retry-After", "5");
        res.status(503).json({ error: "지금은 조회할 수 없습니다. 잠시 후 다시 시도하세요." });
        return;
      }
      if (!decision.allowed) {
        res.setHeader("Retry-After", String(decision.retryAfter));
        res.status(429).json({ error: "조회 요청이 많습니다. 잠시 후 다시 시도하세요." });
        return;
      }
      if (controller.signal.aborted) return;
      const result = await withSearchBudget(
        () => req.path === "/api/investigate" ? (options.investigate ?? investigate)(req.body) : (options.trace ?? trace)(req.body),
        { timeoutMs: options.searchTimeoutMs ?? SEARCH_TIMEOUT_MS, signal: controller.signal },
      );
      if (!controller.signal.aborted) res.json(result);
    } catch (error) {
      if (!controller.signal.aborted) res.status(error instanceof SearchTimeoutError ? 504 : 400).json({
        error: error instanceof ZodError ? "검색 옵션 형식이 올바르지 않습니다." : error instanceof Error ? error.message : "조회 실패",
      });
    } finally {
      active--;
      res.off("close", disconnect);
    }
  });
  app.get("/api/example", (_req, res) => res.json({
    query: "0x3fe11542154f53dcf3134eacb30ea5ca586c9e134c223e56bbe1893862469bc5",
    chainId: "1", label: "실제 deBridge / Ethereum → Arbitrum",
  }));
  // Unknown API routes must not fall through to the SPA or an HTML error page.
  app.use("/api", (_req, res) => res.status(404).json({ error: "요청한 경로를 찾을 수 없습니다." }));
  app.use(((error, _req, res, _next) => {
    const oversized = error?.type === "entity.too.large";
    res.status(oversized ? 413 : 400).json({ error: oversized ? "입력 내용이 너무 큽니다." : "검색 옵션 형식이 올바르지 않습니다." });
  }) as ErrorRequestHandler);
  return app;
}
