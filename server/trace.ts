import { z } from "zod";
import {
  AUTO_CHAIN_IDS,
  canonicalChain,
  chainName,
  getChain,
  hasChain,
  txUrl,
} from "./chains";
import { errorText, mapLimit, TTLCache } from "./http";
import { timeWindow, inWindow } from "./time-window";
import { lifi } from "./adapters/lifi";
import { debridge } from "./adapters/debridge";
import { layerzero } from "./adapters/layerzero";
import { wormhole } from "./adapters/wormhole";
import { thorchain } from "./adapters/thorchain";
import { ccip } from "./adapters/ccip";
import { rhino } from "./adapters/rhino";
import { addressHistory } from "./history";
import { decodeOfficial, getReceipt, verifyRoutes } from "./onchain";
import type { AdapterInput, AdapterResult } from "./adapters/common";
import type { BridgeRoute, TraceResult, Diagnostic } from "../shared/types";

export const querySchema = z.object({
  query: z.string().trim().min(24).max(130),
  kind: z.enum(["auto", "transaction", "address"]).default("auto"),
  chainId: z
    .string()
    .regex(/^[a-zA-Z0-9:_-]{1,80}$/)
    .optional(),
  days: z.number().int().min(1).max(365).default(30),
  limit: z.number().int().min(1).max(25).default(20),
  page: z.number().int().min(1).max(5).default(1),
  startTime: z.string().datetime({ offset: true }).optional(),
  endTime: z.string().datetime({ offset: true }).optional(),
});
export function classify(
  query: string,
  kind = "auto",
): "transaction" | "address" {
  const tx =
    /^(0x)?[a-fA-F0-9]{64}$/.test(query) ||
    /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(query);
  const addr =
    /^0x[\da-fA-F]{40}$/.test(query) ||
    /^[1-9A-HJ-NP-Za-km-z]{26,50}$/.test(query) ||
    /^(bc1|tb1|thor1|ltc1|cosmos1)[a-z0-9]{20,100}$/.test(query);
  if ((kind === "transaction" && tx) || (kind === "auto" && tx))
    return "transaction";
  if ((kind === "address" && addr) || (kind === "auto" && addr))
    return "address";
  throw new Error(
    "올바른 트랜잭션 해시 또는 주소를 입력하세요. EVM, Solana, BTC·LTC·THOR 주소를 지원합니다.",
  );
}
const providers: [string, (i: AdapterInput) => Promise<AdapterResult>][] = [
  ["LI.FI", lifi],
  ["deBridge DLN", debridge],
  ["LayerZero / Stargate", layerzero],
  ["Wormhole / Portal", wormhole],
  ["THORChain", thorchain],
  ["Chainlink CCIP", ccip],
];
export function mergeRoutes(routes: BridgeRoute[]): BridgeRoute[] {
  const normalizeHash = (hash: string) =>
    /^(0x)?[a-f\d]{64}$/i.test(hash) ? hash.toLowerCase() : hash;
  const groups = new Map<string, BridgeRoute[]>();
  for (const route of new Map(routes.map((r) => [r.id, r])).values()) {
    // Solana signatures are case sensitive. A source tx can contain multiple messages.
    const pair =
      route.source.txHash && route.destination.txHash
        ? `${route.source.chainId}:${normalizeHash(route.source.txHash)}:${route.destination.chainId}:${normalizeHash(route.destination.txHash)}`
        : route.id;
    groups.set(pair, [...(groups.get(pair) || []), route]);
  }
  const output: BridgeRoute[] = [];
  for (const group of groups.values()) {
    // Only unambiguous one-to-one provider observations may be consolidated.
    const protocols = new Set(group.map((r) => r.protocol));
    const amounts = new Set(group.map((r) => r.source.amount).filter(Boolean));
    if (protocols.size !== group.length || amounts.size > 1) {
      output.push(...group);
      continue;
    }
    const first = structuredClone(group[0]);
    for (const route of group.slice(1)) {
      first.evidence.push(...route.evidence);
      first.notes = [...new Set([...first.notes, ...route.notes])];
      if (first.status !== route.status) {
        first.notes.push(
          `인덱서 상태 불일치: ${first.status} / ${route.status}. 출처별 근거를 확인하세요.`,
        );
        first.status = "unknown";
      }
      if (route.aggregator) first.aggregator = route.aggregator;
      for (const side of ["source", "destination"] as const)
        for (const [k, v] of Object.entries(route[side]))
          if ((first[side] as any)[k] == null && v != null)
            (first[side] as any)[k] = v;
    }
    output.push(first);
  }
  return output;
}
const cache = new TTLCache<TraceResult>(100);
const inflight = new Map<string, Promise<TraceResult>>();
export function rpcChainsForQuery(
  query: string,
  selected: string | undefined,
  routes: BridgeRoute[],
) {
  if (selected) return getChain(selected)?.rpcs.length ? [selected] : [];
  const normalized = (value: string) =>
    /^(0x)?[\da-f]{64}$/i.test(value)
      ? value.replace(/^0x/i, "").toLowerCase()
      : value;
  const matched = routes
    .flatMap((r) => [r.source, r.destination])
    .filter(
      (side) =>
        side.txHash &&
        normalized(side.txHash) === normalized(query) &&
        side.chainId,
    )
    .map((side) => side.chainId!);
  return matched.length
    ? [...new Set(matched.filter((id) => getChain(id)?.rpcs.length))]
    : AUTO_CHAIN_IDS.map(String);
}
interface TraceOptions {
  bridgesOnly?: boolean;
  paginatedOnly?: boolean;
  skipProviders?: string[];
}
export async function trace(raw: unknown, options: TraceOptions = {}): Promise<TraceResult> {
  const parsed = querySchema.parse(raw);
  const kind = classify(parsed.query, parsed.kind);
  if (kind === "address") timeWindow(parsed);
  if (parsed.chainId && !hasChain(parsed.chainId))
    throw new Error("등록되지 않은 체인입니다. 체인 선택을 확인하세요.");
  const input: AdapterInput = {
    ...parsed,
    chainId: canonicalChain(parsed.chainId),
    kind,
  };
  const key = JSON.stringify({ input, options });
  const cached = cache.get(key);
  if (cached) return cached;
  if (inflight.has(key)) return inflight.get(key)!;
  const task = runTrace(input, options)
    .then((r) => {
      cache.set(key, r, 30_000);
      return r;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}
async function runTrace(input: AdapterInput, options: TraceOptions): Promise<TraceResult> {
  const started = Date.now();
  const diagnostics: Diagnostic[] = [];
  const warnings: string[] = [];
  const routes: BridgeRoute[] = [];
  const searchedChains: string[] = [];
  const completeProviders: string[] = [];
  const running = providers.filter(([name]) =>
    !options.skipProviders?.includes(name) && (!options.paginatedOnly || !["LI.FI", "LayerZero / Stargate", "Chainlink CCIP"].includes(name)),
  );
  if (process.env.RHINO_API_KEY && input.kind === "transaction")
    running.push(["rhino.fi", rhino]);
  else
    diagnostics.push({
      provider: "rhino.fi",
      state: "skipped",
      durationMs: 0,
      count: 0,
      detail:
        input.kind === "address"
          ? "범용 주소 이력 미지원"
          : "이 데이터 소스는 현재 조회할 수 없습니다.",
    });
  const historyTask =
    input.kind === "address" && !options.bridgesOnly
      ? addressHistory(input.query, input.chainId, input.page, input.limit)
      : Promise.resolve({ candidates: [], diagnostics: [] });
  await Promise.all(
    running.map(async ([provider, adapter]) => {
      const start = Date.now();
      try {
        const data = await adapter(input);
        if (data.hasMore === false || ["LI.FI", "LayerZero / Stargate", "Chainlink CCIP"].includes(provider)) completeProviders.push(provider);
        routes.push(...data.routes);
        warnings.push(...(data.warnings || []));
        diagnostics.push({
          provider,
          state: data.partial ? "partial" : data.routes.length ? "ok" : "empty",
          durationMs: Date.now() - start,
          count: data.routes.length,
          detail: data.detail,
        });
      } catch (e) {
        diagnostics.push({
          provider,
          state: "error",
          durationMs: Date.now() - start,
          count: 0,
          detail: errorText(e),
        });
      }
    }),
  );
  const history = await historyTask;
  diagnostics.push(...history.diagnostics);
  if (input.kind === "transaction" && /^0x[\da-f]{64}$/i.test(input.query)) {
    const ids = rpcChainsForQuery(input.query, input.chainId, routes);
    await mapLimit(ids, 4, async (id) => {
      const start = Date.now();
      searchedChains.push(id);
      try {
        const { result, endpoint, checked } = await getReceipt(id, input.query);
        diagnostics.push({
          provider: `RPC 탐색 · ${chainName(id)}`,
          state: result ? "ok" : "empty",
          durationMs: Date.now() - start,
          count: result ? 1 : 0,
          detail: result
            ? `${endpoint} · block ${Number(result.blockNumber)} · ${result.status === "0x1" ? "성공" : "실패"}`
            : `${checked.join(", ")} · 미발견`,
        });
        if (result) {
          routes.push(...decodeOfficial(id, result));
          history.candidates.push({
            hash: input.query,
            chainId: id,
            chain: chainName(id),
            from: result.from,
            to: result.to,
            method: "RPC transaction receipt",
            explorerUrl: txUrl(id, input.query),
          });
        }
      } catch (e) {
        diagnostics.push({
          provider: `RPC 탐색 · ${chainName(id)}`,
          state: "error",
          durationMs: Date.now() - start,
          count: 0,
          detail: errorText(e),
        });
      }
    });
    if (!input.chainId && ids.join(",") === AUTO_CHAIN_IDS.join(","))
      warnings.push(
        `체인 자동 탐색은 ${AUTO_CHAIN_IDS.length}개 주요 EVM 체인으로 제한됩니다. 다른 체인은 직접 선택하세요.`,
      );
  }
  let merged = mergeRoutes(routes);
  if (input.chainId)
    merged = merged.filter(
      (r) =>
        r.source.chainId === input.chainId ||
        r.destination.chainId === input.chainId,
    );
  if (input.kind === "address") {
    const { start, end } = timeWindow(input);
    merged = merged.filter(
      (r) =>
        !r.source.timestamp || inWindow(r.source.timestamp, start, end),
    );
    warnings.push(
      "주소 검색은 인덱서의 기간·페이지 범위에 한정됩니다. 일반 RPC에는 주소 전체 이력 API가 없습니다. 일반 거래 후보는 브릿지 거래로 확정된 항목이 아닙니다.",
    );
    warnings.push(
      "LayerZero·CCIP는 첫 페이지를 조회합니다. LI.FI는 기간을 적용하며, deBridge·Wormhole·Midgard·탐색기는 선택한 페이지를 조회합니다.",
    );
  } else diagnostics.push(...(await verifyRoutes(merged)));
  if (diagnostics.some((d) => d.state === "error" || d.state === "partial"))
    warnings.push(
      "일부 데이터 소스 조회가 실패했습니다. 아래 조회 로그에서 범위를 확인하고 다시 조회하세요.",
    );
  if (merged.length > 8 && input.kind === "transaction")
    warnings.push(
      "RPC 교차 확인은 처음 8개 경로까지 수행했습니다. 나머지는 인덱서 근거입니다.",
    );
  warnings.push(
    "RPC 영수증 확인은 해당 노드의 현재 블록 포함 상태이며 최종성 보증이 아닙니다. 주소·시간 유사성만으로 동일 자금의 이동을 확정하지 않습니다.",
  );
  merged.sort((a, b) =>
    (b.source.timestamp || "").localeCompare(a.source.timestamp || ""),
  );
  return {
    query: input.query,
    kind: input.kind,
    chainId: input.chainId,
    routes: merged,
    candidates: history.candidates,
    diagnostics,
    warnings: [...new Set(warnings)],
    fetchedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    searchedChains,
    pagination: { completeProviders },
  };
}
