import { parseUnits } from "ethers";
import { addressSearchLimits } from "../shared/investigation";
import type { AddressPath, BridgeRoute, Diagnostic, InvestigationRequest, TransferEvent } from "../shared/types";
import { sameAddress } from "./adapters/common";
import { assetKey, incomingTransfers, type TransferQuery, type TransferScan } from "./transfers";

type PairRequest = Extract<InvestigationRequest, { mode: "address-pair" }>;
export type TransferLookup = (query: TransferQuery) => Promise<TransferScan>;
const sameHash = (a: string, b: string) => /^0x/i.test(a) ? a.toLowerCase() === b.toLowerCase() : a === b;
const walletKey = (chain: string, address: string) => `${chain}:${address.startsWith("0x") ? address.toLowerCase() : address}`;

export function follows(previous: TransferEvent, next: TransferEvent) {
  if (previous.chainId !== next.chainId || !sameAddress(previous.to, next.from) || assetKey(previous.tokenAddress) !== assetKey(next.tokenAddress)) return false;
  const before = Date.parse(previous.timestamp), after = Date.parse(next.timestamp);
  if (!Number.isFinite(before) || !Number.isFinite(after) || before > after) return false;
  if (sameHash(previous.txHash, next.txHash) && previous.sequence >= next.sequence) return false;
  if (previous.blockNumber != null && next.blockNumber != null && previous.blockNumber > next.blockNumber) return false;
  return previous.decimals === next.decimals && BigInt(previous.rawAmount) >= BigInt(next.rawAmount);
}
export function followsBridge(route: BridgeRoute, transfer: TransferEvent) {
  const leg = route.destination;
  if (route.status !== "delivered" || leg.chainId !== transfer.chainId || !leg.address || !sameAddress(leg.address, transfer.from) || !leg.tokenAddress || assetKey(leg.tokenAddress) !== assetKey(transfer.tokenAddress)) return false;
  const arrival = Date.parse(leg.timestamp || "");
  if (!Number.isFinite(arrival) || Date.parse(transfer.timestamp) < arrival) return false;
  // Bridge adapters do not expose payout instruction order within the same transaction.
  if (leg.txHash && sameHash(leg.txHash, transfer.txHash)) return false;
  try {
    const available = leg.rawAmount ? BigInt(leg.rawAmount) : leg.amount ? parseUnits(leg.amount, transfer.decimals) : undefined;
    return available !== undefined && available >= BigInt(transfer.rawAmount);
  } catch { return false; }
}

export async function findAddressPaths(routes: BridgeRoute[], request: PairRequest, load: TransferLookup = incomingTransfers) {
  const maxHops = request.maxHops ?? addressSearchLimits.maxHops;
  const paths: AddressPath[] = [];
  const diagnostics: Diagnostic[] = [];
  const warnings: string[] = [];
  const budget = { remaining: 80, deadline: Date.now() + 90_000 };
  const cache = new Map<string, TransferScan>();
  const matched = new Set<string>();
  const reasons = new Map<string, string>();
  let truncated = false;
  const searchable: BridgeRoute[] = [];
  for (const route of routes) {
    const destination = route.destination;
    if (route.status !== "delivered" || !destination.txHash) { reasons.set(route.id, "브릿지 도착 거래가 확인되지 않아 후속 경로를 확정할 수 없습니다."); continue; }
    if (destination.address && sameAddress(destination.address, request.destinationAddress)) {
      paths.push({ id: `${route.id}:direct`, bridgeRouteId: route.id, status: "connected", transfers: [] });
      matched.add(route.id); continue;
    }
    if (!destination.chainId || !destination.address) { reasons.set(route.id, "브릿지의 최종 수취 체인·주소가 제공되지 않았습니다."); continue; }
    if (!destination.tokenAddress || (!destination.amount && !destination.rawAmount) || !Number.isFinite(Date.parse(destination.timestamp || ""))) {
      reasons.set(route.id, "브릿지 도착 자산·수량·시각이 부족하여 일반 송금과 안전하게 연결할 수 없습니다."); continue;
    }
    if (searchable.length >= 20) { truncated = true; reasons.set(route.id, "후속 송금 탐색 대상 브릿지 20개 한도에 도달했습니다."); continue; }
    searchable.push(route);
  }
  const chains = [...new Set(searchable.map(r => r.destination.chainId!))];
  const states = chains.map(chainId => ({ chainId, address: request.destinationAddress, suffix: [] as TransferEvent[], visited: new Set([walletKey(chainId, request.destinationAddress)]) }));
  let frontier = states;
  for (let depth = 0; depth < maxHops && frontier.length; depth++) {
    const next: typeof states = [];
    for (const state of frontier) {
      if (paths.length >= 50 || budget.remaining <= 0 || Date.now() > budget.deadline) { truncated = true; break; }
      const candidates = searchable.filter(r => r.destination.chainId === state.chainId);
      const key = walletKey(state.chainId, state.address);
      let scan = cache.get(key);
      if (!scan) {
        if (cache.size >= 12) { truncated = true; continue; }
        const tokens = [...new Set(candidates.map(r => assetKey(r.destination.tokenAddress!)))];
        const since = Math.min(...candidates.map(r => Date.parse(r.destination.timestamp!)));
        try {
          scan = await load({ chainId: state.chainId, address: state.address, tokens, since, until: Date.now(), pages: request.pages, budget });
        } catch (error) {
          scan = { transfers: [], truncated: true, warnings: [error instanceof Error ? error.message : "일반 송금 조회 실패"],
            diagnostics: [{ provider: `일반 송금 · ${state.chainId} · ${state.address}`, state: "error", count: 0, durationMs: 0, detail: "일반 송금 이력을 확인하지 못했습니다." }] };
        }
        cache.set(key, scan); diagnostics.push(...scan.diagnostics); warnings.push(...scan.warnings);
        truncated ||= scan.truncated;
      }
      for (const transfer of scan.transfers) {
        if (transfer.chainId !== state.chainId || !sameAddress(transfer.to, state.address) || sameAddress(transfer.from, transfer.to)) continue;
        if (state.suffix[0] && !follows(transfer, state.suffix[0])) continue;
        const fromKey = walletKey(state.chainId, transfer.from);
        if (state.visited.has(fromKey)) continue;
        const suffix = [transfer, ...state.suffix];
        for (const route of candidates) {
          if (!followsBridge(route, transfer)) continue;
          if (paths.length >= 50) { truncated = true; break; }
          paths.push({ id: `${route.id}:${suffix.map(t => t.id).join("/")}`, bridgeRouteId: route.id, status: "connected", transfers: suffix });
          matched.add(route.id);
        }
        if (depth + 1 < maxHops) {
          if (next.length >= 30) { truncated = true; continue; }
          next.push({ chainId: state.chainId, address: transfer.from, suffix, visited: new Set([...state.visited, fromKey]) });
        }
      }
    }
    frontier = next;
  }
  for (const route of routes) if (!matched.has(route.id)) paths.push({ id: `${route.id}:unresolved`, bridgeRouteId: route.id, status: "unresolved", transfers: [],
    reason: reasons.get(route.id) || `최대 ${maxHops}단계의 일반 송금 조회 범위에서 목표 주소까지 연결하지 못했습니다.${truncated ? " 일부 이력은 한도·실패로 조회되지 않았습니다." : ""}` });
  const origins = new Map<string, Set<string>>();
  for (const path of paths) for (const transfer of path.transfers) {
    const ids = origins.get(transfer.id) || new Set<string>();
    ids.add(path.bridgeRouteId!); origins.set(transfer.id, ids);
  }
  for (const path of paths) {
    const alternatives = Math.max(0, ...path.transfers.map(t => origins.get(t.id)!.size));
    if (alternatives > 1) path.reason = `같은 후속 송금에 연결 가능한 브릿지 입금이 ${alternatives}개입니다. 어느 입금의 자금인지 확정하지 않습니다.`;
  }
  warnings.push(`브릿지 도착 이후 일반 송금은 최대 ${maxHops}단계, 12개 주소, 80개 거래·이벤트, 90초 범위에서 조회합니다. 전체 이력·모든 경로 수집을 보장하지 않습니다.`);
  warnings.push("연결 경로는 같은 자산의 실제 송수신 주소·시각·수량을 대조한 결과입니다. 잔액 혼합, 분할·합산, 스왑, 다른 브릿지를 통한 재이동은 동일 자금으로 귀속하지 않습니다.");
  return { paths: [...new Map(paths.map(p => [p.id, p])).values()], diagnostics, warnings: [...new Set(warnings)],
    scope: { maxHops, walletsScanned: cache.size, transactionLimit: 80, truncated } };
}
