import { z } from "zod";
import { addressSearchLimits } from "../shared/investigation";
import type {
  BridgeRoute, ConnectedTransaction, InvestigationInputResult,
  InvestigationRequest, RouteConnection, TraceResult,
} from "../shared/types";
import { sameAddress } from "./adapters/common";
import { canonicalChain, hasChain } from "./chains";
import { errorText, mapLimit } from "./http";
import { classify, mergeRoutes, trace } from "./trace";
import { type TransferLookup } from "./address-paths";
import { findFundPaths } from "./fund-paths";
import { inWindow, timeWindow } from "./time-window";

const chain = z.string().regex(/^[a-zA-Z0-9:_-]{1,80}$/).optional();
export const investigationSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("batch"),
    queries: z.array(z.string().trim().min(1).max(130)).min(1).max(10),
    chainId: chain,
  }),
  z.object({
    mode: z.literal("address-pair"),
    sourceAddress: z.string().trim().min(24).max(130),
    destinationAddress: z.string().trim().min(24).max(130),
    sourceChainId: chain,
    destinationChainId: chain,
    days: z.number().int().min(1).max(365).default(30),
    pages: z.number().int().min(1).max(addressSearchLimits.pages).default(addressSearchLimits.pages),
    maxHops: z.number().int().min(1).max(addressSearchLimits.maxHops).default(addressSearchLimits.maxHops),
    maxBridges: z.number().int().min(0).max(addressSearchLimits.maxBridges).default(addressSearchLimits.maxBridges),
    startTime: z.string().datetime({ offset: true }).optional(),
    endTime: z.string().datetime({ offset: true }).optional(),
  }),
]);

// Hex hashes are case insensitive, including APIs that omit the 0x prefix.
// Base58 identifiers must retain their original case.
export function hashKey(hash: string) {
  return /^(0x)?[a-f\d]{64}$/i.test(hash)
    ? hash.replace(/^0x/i, "").toLowerCase()
    : hash;
}
function transactionKey(chainId: string, hash: string) {
  return JSON.stringify([chainId, hashKey(hash)]);
}
export function connectedTransactions(routes: BridgeRoute[]): ConnectedTransaction[] {
  const transactions = new Map<string, ConnectedTransaction>();
  for (const route of routes) {
    for (const role of ["source", "destination"] as const) {
      const leg = route[role];
      if (!leg.chainId || !leg.txHash) continue;
      const key = transactionKey(leg.chainId, leg.txHash);
      const entry = transactions.get(key) || {
        chainId: leg.chainId, chain: leg.chain, txHash: leg.txHash,
        explorerUrl: leg.explorerUrl, routeIds: [], roles: [],
      };
      if (!entry.routeIds.includes(route.id)) entry.routeIds.push(route.id);
      if (!entry.roles.includes(role)) entry.roles.push(role);
      transactions.set(key, entry);
    }
  }
  return [...transactions.values()];
}

export function connectRoutes(routes: BridgeRoute[]): RouteConnection[] {
  const sourceIndex = new Map<string, BridgeRoute[]>();
  for (const route of routes) {
    if (!route.source.chainId || !route.source.txHash) continue;
    const key = transactionKey(route.source.chainId, route.source.txHash);
    sourceIndex.set(key, [...(sourceIndex.get(key) || []), route]);
  }
  const connections: RouteConnection[] = [];
  for (const route of routes) {
    // Refunds and failed executions must not become successful onward hops.
    if (route.status !== "delivered" || !route.destination.chainId || !route.destination.txHash) continue;
    const { chainId, txHash } = route.destination;
    for (const next of sourceIndex.get(transactionKey(chainId, txHash)) || []) {
      if (next.id === route.id) continue;
      connections.push({ fromRouteId: route.id, toRouteId: next.id, chainId, txHash, kind: "shared-transaction" });
    }
  }
  return connections;
}

function combineObservations(routes: BridgeRoute[]) {
  const observations = new Map<string, BridgeRoute>();
  for (const route of routes) {
    const previous = observations.get(route.id);
    if (!previous) { observations.set(route.id, structuredClone(route)); continue; }
    previous.evidence = [...new Map([...previous.evidence, ...route.evidence].map(e =>
      [JSON.stringify([e.provider, e.kind, e.url, e.description, e.details]), e],
    )).values()];
    previous.notes = [...new Set([...previous.notes, ...route.notes])];
    if (previous.status !== route.status) {
      previous.notes.push(`조회 간 상태 불일치: ${previous.status} / ${route.status}`);
      previous.status = "unknown";
    }
    for (const side of ["source", "destination"] as const)
      for (const [key, value] of Object.entries(route[side]))
        if ((previous[side] as any)[key] == null && value != null)
          (previous[side] as any)[key] = value;
  }
  return mergeRoutes([...observations.values()]);
}

export function matchesAddressPair(route: BridgeRoute, request: Extract<InvestigationRequest, { mode: "address-pair" }>) {
  return sameAddress(route.source.address, request.sourceAddress) &&
    sameAddress(route.destination.address, request.destinationAddress) &&
    (!request.sourceChainId || route.source.chainId === request.sourceChainId) &&
    (!request.destinationChainId || route.destination.chainId === request.destinationChainId);
}

type TraceFunction = typeof trace;
export async function investigate(raw: unknown, lookup: TraceFunction = trace, transferLookup?: TransferLookup): Promise<TraceResult> {
  const started = Date.now();
  const request: InvestigationRequest = investigationSchema.parse(raw);
  const validateChain = (value?: string) => {
    if (value && !hasChain(value)) throw new Error("등록되지 않은 체인입니다. 체인 선택을 확인하세요.");
    return canonicalChain(value);
  };
  if (request.mode === "batch") {
    request.chainId = validateChain(request.chainId);
    request.queries = [...new Map(request.queries.map(q => [hashKey(q), q])).values()];
  } else {
    classify(request.sourceAddress, "address");
    classify(request.destinationAddress, "address");
    request.sourceChainId = validateChain(request.sourceChainId);
    request.destinationChainId = validateChain(request.destinationChainId);
    const window = timeWindow(request, started);
    request.startTime = window.startTime; request.endTime = window.endTime;
  }
  const runJob = async (job: { query: string; chainId?: string; page: number }, skipProviders: string[] = []) => {
    const report: InvestigationInputResult = { query: job.query, page: request.mode === "address-pair" ? job.page : undefined, state: "empty", count: 0, detail: "조회 범위에서 미발견" };
    try {
      const kind = request.mode === "batch" ? "transaction" : "address";
      classify(job.query, kind);
      const result = await lookup({ ...job, kind, days: request.mode === "address-pair" ? request.days : 30, limit: 25,
        ...(request.mode === "address-pair" ? { startTime: request.startTime, endTime: request.endTime } : {}),
      }, request.mode === "address-pair" ? { bridgesOnly: true, paginatedOnly: job.page > 1, skipProviders } : {});
      const queried = result.diagnostics.filter(d => d.state !== "skipped");
      const errors = queried.filter(d => d.state === "error" || d.state === "partial").length;
      report.state = errors ? (queried.every(d => d.state === "error") && !result.routes.length ? "error" : "partial") : result.routes.length ? "ok" : "empty";
      report.count = result.routes.length; report.detail = `${result.routes.length}개 관측 경로 · ${errors}개 소스 실패`;
      return { result, report };
    } catch (e) { report.state = "error"; report.detail = errorText(e); return { result: undefined, report }; }
  };
  const providers = ["LI.FI", "deBridge DLN", "LayerZero / Stargate", "Wormhole / Portal", "THORChain", "Chainlink CCIP"];
  const scanBridges = async (address: string, chainId?: string) => {
    const rows: Awaited<ReturnType<typeof runJob>>[] = [];
    const complete = new Set<string>();
    const deadline = Date.now() + 30_000;
    for (let page = 1; page <= (request.mode === "address-pair" ? request.pages : 1); page++) {
      if (page > 1 && (providers.every(p => complete.has(p)) || Date.now() > deadline)) break;
      const row = await runJob({ query: address, chainId, page }, [...complete]);
      rows.push(row);
      for (const provider of row.result?.pagination?.completeProviders || []) complete.add(provider);
    }
    return { rows, truncated: !providers.every(p => complete.has(p)) || rows.some(r => r.report.state === "partial" || r.report.state === "error") };
  };
  const initial = request.mode === "address-pair" && request.maxBridges !== 0
    ? await scanBridges(request.sourceAddress, request.sourceChainId) : undefined;
  const results = request.mode === "batch" ? await mapLimit(request.queries, 2, query => runJob({ query, chainId: request.chainId, page: 1 })) : initial?.rows || [];
  const successes = results.flatMap(r => r.result ? [r.result] : []);
  const observed = combineObservations(successes.flatMap(r => r.routes));
  let routes = observed;
  let missingTime = 0;
  if (request.mode === "address-pair") {
    const window = timeWindow(request, started);
    routes = observed.filter(route => {
      if (!sameAddress(route.source.address, request.sourceAddress) ||
        (request.sourceChainId && route.source.chainId !== request.sourceChainId)) return false;
      const time = Date.parse(route.source.timestamp || "");
      if (!Number.isFinite(time)) { missingTime++; return false; }
      return inWindow(route.source.timestamp, window.start, window.end);
    });
  }
  routes.sort((a, b) => (b.source.timestamp || "").localeCompare(a.source.timestamp || ""));
  const addressSearch = request.mode === "address-pair" ? await findFundPaths(routes, request, transferLookup, async (address, chainId) => {
    const scan = await scanBridges(address, chainId);
    const found = scan.rows.flatMap(row => row.result ? [row.result] : []);
    return { routes: combineObservations(found.flatMap(r => r.routes)), diagnostics: found.flatMap(r => r.diagnostics.map(d => ({ ...d, provider: `${address.slice(0, 10)}… · ${d.provider}` }))), warnings: found.flatMap(r => r.warnings), truncated: scan.truncated };
  }) : undefined;
  if (addressSearch && initial?.truncated) addressSearch.scope.truncated = true;
  const warnings = [...new Set(successes.flatMap(r => r.warnings))];
  warnings.push("연결 거래 목록에는 관측한 브릿지 출발·도착 거래와 주소 경로에서 확인한 일반 송금이 포함됩니다. 동일 체인·동일 거래 접점도 동일 자금의 재사용을 증명하지는 않습니다.");
  if (request.mode === "address-pair") {
    warnings.push(`${request.startTime} ~ ${request.endTime} · 주소별 최대 ${request.pages}페이지. A에서 출발하여 일반 송금과 중간 브릿지를 따라 B까지 탐색합니다. 기간 밖 거래의 상세 조회를 생략하며, 지원하는 API에는 기간 필터를 전달합니다.`);
    warnings.push("수취인을 제공하지 않는 LayerZero 등은 후속 경로를 확인할 수 없습니다. LI.FI는 기간 조회, LayerZero·CCIP는 첫 페이지만 조회합니다. 다른 소스도 인덱싱 범위와 페이지 상한으로 누락될 수 있습니다.");
    if (missingTime) warnings.push(`기간을 검증할 출발 시간이 없는 주소 일치 경로 ${missingTime}개를 제외했습니다.`);
  }
  warnings.push(...(addressSearch?.warnings || []));
  const allBridges = [...routes, ...(addressSearch?.paths || []).flatMap(p => p.steps?.flatMap(s => s.type === "bridge" ? [s.route] : []) || [])];
  const transactions = connectedTransactions(allBridges);
  for (const path of addressSearch?.paths || []) for (const transfer of path.transfers) {
    const existing = transactions.find(t => t.chainId === transfer.chainId && hashKey(t.txHash) === hashKey(transfer.txHash));
    if (existing) {
      if (!existing.roles.includes("transfer")) existing.roles.push("transfer");
      if (!existing.routeIds.includes((path.bridgeRouteId || path.id))) existing.routeIds.push((path.bridgeRouteId || path.id));
    } else transactions.push({ chainId: transfer.chainId, chain: transfer.chain, txHash: transfer.txHash, explorerUrl: transfer.explorerUrl, roles: ["transfer"], routeIds: [path.bridgeRouteId || path.id] });
  }
  if (results.some(r => r.report.state === "error" || r.report.state === "partial"))
    warnings.push("일부 입력 또는 데이터 소스가 실패했습니다. 성공한 조회 결과만 모았으며 미발견·전체 수집 완료로 해석하지 않습니다.");
  return {
    query: request.mode === "batch" ? request.queries.join("\n") : `${request.sourceAddress} → ${request.destinationAddress}`,
    kind: request.mode === "batch" ? "transaction" : "address",
    chainId: request.mode === "batch" ? request.chainId : undefined,
    routes, candidates: [],
    diagnostics: results.flatMap(({ result, report }) => result?.diagnostics.map(d => ({
      ...d, provider: `${report.query.slice(0, 10)}…${report.page ? ` · ${report.page}페이지` : ""} · ${d.provider}`,
    })) || []).concat(addressSearch?.diagnostics || []),
    warnings, fetchedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
    searchedChains: [...new Set(successes.flatMap(r => r.searchedChains))],
    investigation: {
      request, inputs: results.map(r => r.report), observedRouteCount: observed.length,
      excludedRouteCount: observed.length - routes.length,
      connections: connectRoutes(allBridges), transactions,
      addressPaths: addressSearch?.paths, pathSearch: addressSearch?.scope,
    },
  };
}
