import { searchDeadline, searchExpired } from "./search-context.js";
import { parseUnits } from "ethers";
import { addressSearchLimits } from "../shared/investigation.js";
import type { AddressPath, AddressPathStep, BridgeRoute, Diagnostic, InvestigationRequest, Leg, TransferEvent } from "../shared/types.js";
import { sameAddress } from "./adapters/common.js";
import { follows, followsBridge, type TransferLookup } from "./address-paths.js";
import { chainName } from "./chains.js";
import { assetKey, incomingTransfers, type TransferScan } from "./transfers.js";
import { inWindow, timeWindow } from "./time-window.js";

type Pair = Extract<InvestigationRequest, { mode: "address-pair" }>;
export type BridgeLookup = (address: string, chainId: string) => Promise<{
  routes: BridgeRoute[]; diagnostics: Diagnostic[]; warnings: string[]; truncated: boolean;
}>;
const walletKey = (chain: string, address: string) => `${chain}:${address.startsWith("0x") ? address.toLowerCase() : address}`;
const hashKey = (hash: string) => /^(0x)?[a-f\d]{64}$/i.test(hash) ? hash.replace(/^0x/i, "").toLowerCase() : hash;
const transferLeg = (t: TransferEvent): Leg => ({ ...t, address: t.to, receiptVerified: t.evidence.kind === "event" });

// Compare decimal quantities without converting to floating point or assuming token decimals.
function enough(previous: Leg, next: Leg) {
  if (!previous.amount || !next.amount || !/^\d+(\.\d+)?$/.test(previous.amount) || !/^\d+(\.\d+)?$/.test(next.amount)) return false;
  const decimals = Math.max(previous.amount.split(".")[1]?.length || 0, next.amount.split(".")[1]?.length || 0);
  try { return parseUnits(previous.amount, decimals) >= parseUnits(next.amount, decimals) && parseUnits(next.amount, decimals) > 0n; } catch { return false; }
}
export function canEnterBridge(previous: Leg, route: BridgeRoute) {
  const next = route.source;
  if (!next.address || !previous.address || previous.chainId !== next.chainId || !sameAddress(previous.address, next.address) ||
    !previous.tokenAddress || !next.tokenAddress || assetKey(previous.tokenAddress) !== assetKey(next.tokenAddress)) return false;
  const before = Date.parse(previous.timestamp || ""), after = Date.parse(next.timestamp || "");
  // Bridge adapters do not expose instruction order, so a shared tx is not enough to link funds.
  return Number.isFinite(before) && Number.isFinite(after) && before <= after &&
    !(previous.txHash && next.txHash && hashKey(previous.txHash) === hashKey(next.txHash)) && enough(previous, next);
}
function arrivalKnown(route: BridgeRoute, start: number, end: number) {
  const { source, destination: d } = route;
  return route.status === "delivered" && !!source.txHash && !!d.txHash && !!d.chainId && !!d.address &&
    inWindow(source.timestamp, start, end) && inWindow(d.timestamp, start, end) && Date.parse(d.timestamp!) >= Date.parse(source.timestamp!);
}
type State = {
  root?: BridgeRoute; source: Leg; leg: Leg; last?: AddressPathStep; steps: AddressPathStep[];
  hops: number; bridges: number; visited: Set<string>;
};

export async function findFundPaths(routes: BridgeRoute[], request: Pair, load: TransferLookup = incomingTransfers, loadBridges?: BridgeLookup) {
  const window = timeWindow(request);
  const maxHops = request.maxHops ?? addressSearchLimits.maxHops, maxBridges = request.maxBridges ?? addressSearchLimits.maxBridges;
  const paths: AddressPath[] = [], diagnostics: Diagnostic[] = [], warnings: string[] = [];
  const budget = { remaining: 80, deadline: Math.min(Date.now() + 90_000, searchDeadline()) };
  const scans = new Map<string, TransferScan>();
  const wallets = new Set<string>();
  const bridgeScans = new Map<string, Awaited<ReturnType<BridgeLookup>>>();
  const matched = new Set<string>();
  let truncated = false, expanded = 0;
  const queue: State[] = [];
  const reached = (leg: Leg) => !!leg.address && sameAddress(leg.address, request.destinationAddress) &&
    (!request.destinationChainId || leg.chainId === request.destinationChainId);
  const record = (state: State) => {
    if (paths.length >= 50) { truncated = true; return; }
    const steps = state.steps;
    const id = `${state.root?.id || "transfer"}:${steps.map(s => s.type === "bridge" ? s.route.id : s.transfer.id).join("/") || "direct"}`;
    paths.push({ id, bridgeRouteId: state.root?.id, source: state.source, status: "connected", steps,
      transfers: steps.flatMap(s => s.type === "transfer" ? [s.transfer] : []) });
    if (state.root) matched.add(state.root.id);
  };
  const enqueue = (state: State) => {
    if (reached(state.leg)) { record(state); return; }
    if (queue.length >= 60) { truncated = true; return; }
    queue.push(state);
  };
  if (maxBridges > 0) for (const route of routes.slice(0, 20)) {
    if (!arrivalKnown(route, window.start, window.end)) continue;
    const leg = route.destination;
    enqueue({ root: route, source: route.source, leg, last: { type: "bridge", route }, steps: [], hops: 0, bridges: 1,
      visited: new Set([walletKey(route.source.chainId!, request.sourceAddress), walletKey(leg.chainId!, leg.address!)]) });
  }
  if (routes.length > 20) truncated = true;
  // EVM addresses do not identify a chain. Never fan out to every configured RPC.
  const sourceChains = request.sourceChainId ? [request.sourceChainId] : [...new Set(routes.map(r => r.source.chainId).filter((c): c is string => !!c))];
  if (!sourceChains.length && /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(request.sourceAddress)) sourceChains.push("tron");
  if (!sourceChains.length && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(request.sourceAddress)) sourceChains.push("solana");
  if (!sourceChains.length) warnings.push("일반 송금으로 시작하는 경로를 조회하려면 출발 체인을 선택하세요. EVM 주소만으로는 체인을 식별할 수 없습니다.");
  for (const chainId of sourceChains.slice(0, 3)) {
    const leg = { chainId, chain: chainName(chainId), address: request.sourceAddress };
    queue.push({ source: leg, leg, steps: [], hops: 0, bridges: 0, visited: new Set([walletKey(chainId, request.sourceAddress)]) });
  }
  if (sourceChains.length > 3) truncated = true;
  while (queue.length && paths.length < 50) {
    if (searchExpired() || Date.now() > budget.deadline || budget.remaining <= 0 || expanded++ >= 100) { truncated = true; break; }
    const state = queue.shift()!;
    const { leg } = state;
    const chainId = leg.chainId!, address = leg.address!;
    const key = walletKey(chainId, address);
    if (state.last && (!leg.tokenAddress || !leg.amount || !Number.isFinite(Date.parse(leg.timestamp || "")))) continue;
    if (!wallets.has(key) && wallets.size >= 12) { truncated = true; continue; }
    wallets.add(key);
    if (state.hops < maxHops) {
      const tokens = leg.tokenAddress ? [assetKey(leg.tokenAddress)] : [];
      const scanKey = `${key}:${tokens.join(",")}`;
      let scan = scans.get(scanKey) || scans.get(`${key}:`);
      if (!scan) {
        try {
          scan = await load({ chainId, address, tokens, direction: "out", since: window.start, until: window.end, pages: request.pages, budget });
        } catch (error) {
          scan = { transfers: [], truncated: true, warnings: [String(error)], diagnostics: [{ provider: `일반 송금 · ${chainId}`, state: "error", count: 0, durationMs: 0, detail: String(error) }] };
        }
        scans.set(scanKey, scan); diagnostics.push(...scan.diagnostics); warnings.push(...scan.warnings); truncated ||= scan.truncated;
      }
      for (const transfer of scan.transfers) {
        if (transfer.chainId !== chainId || !sameAddress(transfer.from, address) || !inWindow(transfer.timestamp, window.start, window.end)) continue;
        if (state.last?.type === "transfer" && !follows(state.last.transfer, transfer)) continue;
        if (state.last?.type === "bridge" && !followsBridge(state.last.route, transfer)) continue;
        const nextKey = walletKey(chainId, transfer.to);
        if (state.visited.has(nextKey)) continue;
        const step: AddressPathStep = { type: "transfer", transfer };
        const source = state.last ? state.source : { ...transferLeg(transfer), address: transfer.from };
        enqueue({ ...state, source, leg: transferLeg(transfer), last: step, steps: [...state.steps, step], hops: state.hops + 1, visited: new Set([...state.visited, nextKey]) });
      }
    }
    // Initial A bridge orders were already loaded. Every other wallet can start another bridge.
    if (!state.last || state.bridges >= maxBridges || !loadBridges) continue;
    if (searchExpired() || Date.now() > budget.deadline) { truncated = true; break; }
    let bridgeScan = bridgeScans.get(key);
    if (!bridgeScan) {
      if (bridgeScans.size >= 8) { truncated = true; continue; }
      try { bridgeScan = await loadBridges(address, chainId); }
      catch (error) { bridgeScan = { routes: [], truncated: true, warnings: [String(error)], diagnostics: [{ provider: `중간 브릿지 · ${chainId}`, state: "error", count: 0, durationMs: 0, detail: String(error) }] }; }
      bridgeScans.set(key, bridgeScan); diagnostics.push(...bridgeScan.diagnostics); warnings.push(...bridgeScan.warnings); truncated ||= bridgeScan.truncated;
    }
    for (const route of bridgeScan.routes) {
      if (!arrivalKnown(route, window.start, window.end) || !canEnterBridge(leg, route)) continue;
      const nextKey = walletKey(route.destination.chainId!, route.destination.address!);
      if (state.visited.has(nextKey)) continue;
      const step: AddressPathStep = { type: "bridge", route };
      enqueue({ ...state, leg: route.destination, last: step, steps: [...state.steps, step], bridges: state.bridges + 1, visited: new Set([...state.visited, nextKey]) });
    }
  }
  if (queue.length) truncated = true;
  for (const route of routes) if (!matched.has(route.id)) paths.push({ id: `${route.id}:unresolved`, bridgeRouteId: route.id, source: route.source, status: "unresolved", transfers: [], steps: [],
    reason: !arrivalKnown(route, window.start, window.end) ? "선택 기간 내 브릿지 출발·도착 거래, 수취 주소 또는 시각을 확인하지 못했습니다." : `조회 범위에서 B까지 연결하지 못했습니다. 일반 송금 ${maxHops}단계·브릿지 ${maxBridges}개 한도이며, 자산·수량·시각이 불명확한 구간은 연결하지 않습니다.` });
  const connected = paths.filter(p => p.status === "connected");
  for (const path of connected) if (path.transfers.some(t => connected.some(other => other.id !== path.id && other.transfers.some(o => o.id === t.id))))
    path.reason = "같은 송금이 여러 후보 경로에 포함됩니다. 지갑 잔액이 섞일 수 있어 특정 입금의 자금으로 귀속하지 않습니다.";
  warnings.push(`선택 기간 내 일반 송금 최대 ${maxHops}단계·브릿지 ${maxBridges}개, 주소 12개·중간 브릿지 조회 8개·거래/이벤트 80개·90초 탐색 예산입니다. 요청 중인 조회 시간만큼 초과할 수 있으며 모든 경로 수집을 보장하지 않습니다.`);
  warnings.push("일반 송금 구간은 동일 자산·송수신 주소·시간 순서·수량을 대조하고, 브릿지 구간은 인덱서의 주문 연결을 사용합니다. 스왑, 분할·합산과 잔액 혼합에 따른 동일 자금 귀속은 판정하지 않습니다.");
  return { paths: [...new Map(paths.map(p => [p.id, p])).values()], diagnostics, warnings: [...new Set(warnings)],
    scope: { maxHops, maxBridges, walletsScanned: wallets.size, bridgeLookups: bridgeScans.size, transactionLimit: 80, truncated, startTime: window.startTime, endTime: window.endTime } };
}
