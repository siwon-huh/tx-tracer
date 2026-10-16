import type { AddressPath, AddressPathStep, BridgeRoute, Leg, TraceResult } from "../shared/types";

export type MapSearch = { key: string; result: TraceResult };
export type MapEntry = {
  id: string; searchKeys: string[]; route?: BridgeRoute; path?: AddressPath;
  source: Leg; destination: Leg; steps: AddressPathStep[]; label: string;
};
export type MapConnection = {
  fromEntryId: string; fromStage: number; toEntryId: string;
  kind: "shared-transaction" | "address-continuation";
  chainId: string; address?: string;
};
const hashKey = (value: string) => /^(0x)?[a-f\d]{64}$/i.test(value) ? value.replace(/^0x/i, "").toLowerCase() : value;
const addressKey = (value: string) => /^0x[a-f\d]{40}$/i.test(value) ? value.toLowerCase() : value;
const assetKey = (value: string) => /^(0x0{40}|0x[eE]{40}|11111111111111111111111111111111|native)$/i.test(value) ? "native" : addressKey(value);
const stepKey = (step: AddressPathStep) => step.type === "bridge" ? `bridge:${step.route.id}`
  : JSON.stringify(["transfer", step.transfer.chainId, hashKey(step.transfer.txHash), step.transfer.sequence, addressKey(step.transfer.tokenAddress), addressKey(step.transfer.from), addressKey(step.transfer.to)]);
const arrival = (step: AddressPathStep): Leg => step.type === "bridge" ? step.route.destination
  : { ...step.transfer, address: step.transfer.to, receiptVerified: step.transfer.evidence.kind === "event" };

export function appendMapSearch(searches: MapSearch[], next: MapSearch) {
  const index = searches.findIndex(search => search.key === next.key);
  return index < 0 ? [...searches, next] : searches.map((search, i) => i === index ? next : search);
}

// Decimal comparison without floating-point rounding or a token-decimal guess.
function sufficient(previous?: string, next?: string) {
  if (!previous || !next || !/^\d+(\.\d+)?$/.test(previous) || !/^\d+(\.\d+)?$/.test(next)) return false;
  const precision = Math.max(previous.split(".")[1]?.length || 0, next.split(".")[1]?.length || 0);
  const units = (value: string) => { const [whole, fraction = ""] = value.split("."); return BigInt(whole + fraction.padEnd(precision, "0")); };
  return units(next) > 0n && units(previous) >= units(next);
}

export function continuationKind(previous: Leg, next: Leg): MapConnection["kind"] | undefined {
  if (!previous.chainId || previous.chainId !== next.chainId || !previous.txHash || !next.txHash || previous.receiptVerified === false || next.receiptVerified === false) return;
  // A shared transaction is an observed junction, not proof of token attribution.
  if (hashKey(previous.txHash) === hashKey(next.txHash)) return "shared-transaction";
  if (!previous.address || !next.address || addressKey(previous.address) !== addressKey(next.address) ||
    !previous.tokenAddress || !next.tokenAddress || assetKey(previous.tokenAddress) !== assetKey(next.tokenAddress)) return;
  const before = Date.parse(previous.timestamp || ""), after = Date.parse(next.timestamp || "");
  if (!Number.isFinite(before) || !Number.isFinite(after) || before >= after || !sufficient(previous.amount, next.amount)) return;
  return "address-continuation";
}

export function connectMapEntries(entries: MapEntry[]): MapConnection[] {
  const connections: MapConnection[] = [];
  for (const from of entries) {
    let stage = 0;
    for (const step of from.steps) {
      stage += step.type === "bridge" ? 2 : 1;
      if (step.type === "bridge" && step.route.status !== "delivered") continue;
      const leg = arrival(step);
      for (const to of entries) {
        if (from.id === to.id || to.steps.some(other => stepKey(other) === stepKey(step))) continue;
        const first = to.steps[0];
        if (first?.type === "bridge" && ["failed", "refunded", "unknown", "observed"].includes(first.route.status)) continue;
        if (step.type === "transfer" && first?.type === "transfer" && hashKey(step.transfer.txHash) === hashKey(first.transfer.txHash)) {
          if (step.transfer.sequence >= first.transfer.sequence || addressKey(step.transfer.to) !== addressKey(first.transfer.from) ||
            assetKey(step.transfer.tokenAddress) !== assetKey(first.transfer.tokenAddress) || !sufficient(step.transfer.amount, first.transfer.amount)) continue;
        }
        const kind = continuationKind(leg, to.source);
        if (kind) connections.push({ fromEntryId: from.id, fromStage: stage, toEntryId: to.id, kind, chainId: leg.chainId!, address: leg.address });
      }
    }
  }
  return connections;
}

export function buildTraceMap(searches: MapSearch[]) {
  const routes = new Map<string, BridgeRoute>();
  for (const { result } of searches) {
    for (const route of result.routes) routes.set(route.id, route);
    for (const path of result.investigation?.addressPaths || []) for (const step of path.steps || [])
      if (step.type === "bridge") routes.set(step.route.id, step.route);
  }
  const entries = new Map<string, MapEntry>();
  const add = (entry: MapEntry) => {
    const signature = JSON.stringify(entry.steps.map(stepKey));
    const old = entries.get(signature);
    entries.set(signature, old ? { ...entry, id: old.id, path: entry.path || old.path, searchKeys: [...new Set([...old.searchKeys, ...entry.searchKeys])] } : entry);
  };
  for (const { key, result } of searches) {
    const paths = result.investigation?.addressPaths;
    if (paths) {
      for (const path of paths.filter(p => p.status === "connected")) {
        const route = path.bridgeRouteId ? routes.get(path.bridgeRouteId) : undefined;
        const steps: AddressPathStep[] = [...(route ? [{ type: "bridge" as const, route }] : []),
          ...(path.steps || path.transfers.map(transfer => ({ type: "transfer" as const, transfer })))].map(step => step.type === "bridge" ? { ...step, route: routes.get(step.route.id) || step.route } : step);
        const source = route?.source || path.source;
        if (!source || !steps.length) continue;
        const count = steps.filter(s => s.type === "bridge").length;
        add({ id: path.id, searchKeys: [key], route, path, source, destination: arrival(steps.at(-1)!), steps, label: route?.bridge || (count ? `송금  /  브릿지 ${count}개` : "일반 송금") });
      }
    } else {
      for (const observed of result.routes) {
        const route = routes.get(observed.id)!;
        add({ id: route.id, searchKeys: [key], route, source: route.source, destination: route.destination, steps: [{ type: "bridge", route }], label: route.bridge });
      }
      for (const transfer of result.transfers || []) {
        const step: AddressPathStep = { type: "transfer", transfer };
        add({ id: `transfer:${transfer.id}`, searchKeys: [key], source: { ...transfer, address: transfer.from }, destination: arrival(step), steps: [step], label: "일반 송금" });
      }
    }
  }
  const all = [...entries.values()];
  // Re-querying a transaction already inside a longer path enriches that path.
  // It must not create a second copy of the same one-step route.
  const retained = all.filter(entry => entry.steps.length !== 1 || !all.some(other => other !== entry && other.steps.length > 1 && other.steps.some(step => stepKey(step) === stepKey(entry.steps[0]))));
  for (const removed of all.filter(entry => !retained.includes(entry))) for (const entry of retained)
    if (entry.steps.some(step => stepKey(step) === stepKey(removed.steps[0]))) entry.searchKeys = [...new Set([...entry.searchKeys, ...removed.searchKeys])];
  const connections = connectMapEntries(retained);
  // Keep connected entries adjacent, even when searches were added out of order.
  const ordered: MapEntry[] = [], visited = new Set<string>();
  const visit = (entry: MapEntry) => {
    if (visited.has(entry.id)) return;
    visited.add(entry.id); ordered.push(entry);
    for (const link of connections.filter(c => c.fromEntryId === entry.id)) {
      const next = retained.find(e => e.id === link.toEntryId); if (next) visit(next);
    }
  };
  for (const entry of retained.filter(e => !connections.some(c => c.toEntryId === e.id))) visit(entry);
  for (const entry of retained) visit(entry);
  return { entries: ordered, connections, routes: [...routes.values()] };
}
