import { setTimeout as delay } from "node:timers/promises";
import { jsonFetch, mapLimit, TTLCache, UpstreamError } from "../http";
import {
  amount,
  evidence,
  leg,
  sameAddress,
  timestamp,
  type AdapterInput,
  type AdapterResult,
} from "./common";
import type { BridgeRoute } from "../../shared/types";
import { timeWindow } from "../time-window";
const base = "https://dln-api.debridge.finance";
// Both endpoint addresses often lead to the same orders. Share detail requests
// and pace the public API across all searches, not just within one adapter call.
const orderCache = new TTLCache<{ row: any; fetchedAt: string }>(500);
const orderInflight = new Map<string, Promise<{ row: any; fetchedAt: string }>>();
let requestQueue: Promise<unknown> = Promise.resolve();
let nextRequestAt = 0;
let cooldownUntil = 0;
function dlnFetch(url: string, options: RequestInit = {}) {
  const request = requestQueue.then(async () => {
    if (Date.now() < cooldownUntil) throw new UpstreamError(429, "deBridge 요청 제한 · 잠시 후 다시 조회하세요.");
    await delay(Math.max(0, nextRequestAt - Date.now()));
    try {
      return await jsonFetch(url, options);
    } catch (error) {
      if (error instanceof UpstreamError && error.status === 429) cooldownUntil = Date.now() + 5000;
      throw error;
    } finally {
      nextRequestAt = Date.now() + 250;
    }
  });
  requestQueue = request.catch(() => undefined);
  return request;
}
function orderDetails(id: string) {
  const cached = orderCache.get(id);
  if (cached) return Promise.resolve(cached);
  const existing = orderInflight.get(id);
  if (existing) return existing;
  const request = dlnFetch(`${base}/api/Orders/${encodeURIComponent(id)}`).then(row => {
    const value = { row, fetchedAt: new Date().toISOString() };
    orderCache.set(id, value, ["Fulfilled", "SentUnlock", "ClaimedUnlock"].includes(row.state) ? 300_000 : 15_000);
    return value;
  }).finally(() => orderInflight.delete(id));
  orderInflight.set(id, request);
  return request;
}
const val = (v: any) =>
  v?.stringValue ?? (typeof v === "string" ? v : undefined);
export function normalizeDebridge(row: any, url: string): BridgeRoute {
  const make = (offer: any, event: any, address: string) =>
    leg(
      val(offer?.chainId),
      {
        txHash: val(event?.transactionHash),
        address,
        amount: amount(val(offer?.finalAmount), offer?.metadata?.decimals),
        symbol: offer?.metadata?.symbol,
        tokenAddress: val(offer?.tokenAddress),
        timestamp: timestamp(event?.blockTimeStamp),
      },
      "debridge",
    );
  const state = row.state;
  return {
    id: `debridge:${val(row.orderId)}`,
    bridge: "deBridge DLN",
    protocol: "debridge",
    messageId: val(row.orderId),
    source: make(
      row.giveOfferWithMetadata,
      row.createdSrcEventMetadata,
      val(row.makerSrc),
    ),
    destination: make(
      row.takeOfferWithMetadata,
      row.fulfilledDstEventMetadata,
      val(row.receiverDst),
    ),
    status: ["Fulfilled", "SentUnlock", "ClaimedUnlock"].includes(state)
      ? "delivered"
      : /cancel/i.test(state)
        ? "refunded"
        : /fail/i.test(state)
          ? "failed"
          : "pending",
    confidence: "indexed",
    evidence: [
      evidence("deBridge DLN", url, `주문 상태: ${state}`, {
        state,
        externalCallState: row.externalCallState,
        sourceProtocolChainId: val(row.giveOfferWithMetadata?.chainId),
        destinationProtocolChainId: val(row.takeOfferWithMetadata?.chainId),
      }),
    ],
    notes: row.externalCallState
      ? [
          `후속 외부 호출 상태: ${row.externalCallState}. 자산 전달 상태와 별개입니다.`,
        ]
      : [],
  };
}
export async function debridge(input: AdapterInput): Promise<AdapterResult> {
  const url =
    input.kind === "transaction"
      ? `${base}/api/Transaction/${encodeURIComponent(input.query)}/liteModels`
      : `${base}/api/Orders/filteredList`;
  let data: any;
  try {
    data = await dlnFetch(
      url,
      input.kind === "address"
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filter: input.query,
              skip: (input.page - 1) * input.limit,
              take: input.limit,
            }),
          }
        : {},
    );
  } catch (e) {
    if (e instanceof UpstreamError && e.status === 404)
      return { routes: [], detail: "DLN 인덱스에서 미발견", hasMore: false };
    throw e;
  }
  const list = Array.isArray(data) ? data : data.orders || [];
  const window = timeWindow(input);
  const times = list.map((r: any) => Date.parse(timestamp(r.creationTimestamp) || ""));
  // Lite rows carry creation time: do not fetch details for orders outside the window.
  const relevant = input.kind === "address" ? list.filter((_: any, i: number) => !Number.isFinite(times[i]) || (times[i] >= window.start && times[i] <= window.end)) : list;
  const descending = times.length > 0 && times.every((t: number, i: number) => Number.isFinite(t) && (i === 0 || times[i - 1] >= t));
  const crossedStart = input.kind === "address" && descending && times.at(-1)! < window.start;
  const failures: string[] = [];
  const details = await mapLimit(
    relevant.slice(0, input.limit),
    3,
    async (r: any) => {
      const id = val(r.orderId);
      if (!id) return null;
      const detailUrl = `${base}/api/Orders/${id}`;
      let full: { row: any; fetchedAt: string };
      try {
        full = await orderDetails(id);
      } catch (e) {
        failures.push(e instanceof Error ? e.message : "주문 상세 조회 실패");
        return null;
      }
      const route = normalizeDebridge(full.row, detailUrl);
      route.evidence[0].fetchedAt = full.fetchedAt;
      if (
        input.kind === "address" &&
        !sameAddress(route.source.address, input.query) &&
        !sameAddress(route.destination.address, input.query)
      )
        return null;
      return route;
    },
  );
  if (failures.length === relevant.length && failures.length)
    throw new Error(`deBridge 주문 상세 조회 실패: ${failures[0]}`);
  return {
    routes: details.filter((r): r is BridgeRoute => r !== null),
    detail: `DLN 주문 ${input.page}페이지 · 최대 ${input.limit}건 · 송수신 주소 재검증${failures.length ? ` · 상세 ${failures.length}건 조회 실패` : ""}`,
    partial: failures.length > 0,
    hasMore: !crossedStart && list.length >= input.limit && (data.totalCount == null || data.totalCount > input.page * input.limit),
    warnings: [
      ...(!crossedStart && data.totalCount > input.page * input.limit
        ? [
            "deBridge에 추가 페이지가 있습니다. 다음 페이지로 더 조회할 수 있습니다.",
          ]
        : []),
      ...(failures.length
        ? [
            `deBridge 주문 ${failures.length}건 상세 조회 실패. 나머지 결과만 표시합니다.`,
          ]
        : []),
    ],
  };
}
