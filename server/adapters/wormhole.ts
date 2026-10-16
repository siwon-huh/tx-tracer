import { jsonFetch, UpstreamError } from "../http.js";
import { evidence, leg, type AdapterInput, type AdapterResult } from "./common.js";
import type { BridgeRoute } from "../../shared/types.js";
export function normalizeWormhole(row: any, url: string): BridgeRoute {
  const s = row.content?.standarizedProperties || {};
  const payload = row.content?.payload;
  const sourceId = row.sourceChain?.chainId ?? s.fromChain;
  const targetId = row.targetChain?.chainId ?? s.toChain;
  const direct = payload?.payloadType === 1;
  return {
    id: `wormhole:${row.id}`,
    messageId: row.id,
    bridge: s.appIds?.includes("PORTAL_TOKEN_BRIDGE")
      ? "Portal / Wormhole"
      : "Wormhole",
    protocol: "wormhole",
    source: leg(
      sourceId,
      {
        txHash: row.sourceChain?.transaction?.txHash,
        address: row.sourceChain?.from,
        amount: row.data?.tokenAmount,
        symbol: row.data?.symbol,
        tokenAddress: s.tokenAddress,
        timestamp: row.sourceChain?.timestamp,
      },
      "wormhole",
    ),
    destination: leg(
      targetId,
      {
        txHash: row.targetChain?.transaction?.txHash,
        address: direct ? s.toAddress : undefined,
        timestamp: row.targetChain?.timestamp,
      },
      "wormhole",
    ),
    status:
      row.targetChain?.status === "completed"
        ? "delivered"
        : row.targetChain?.status === "failed"
          ? "failed"
          : "pending",
    confidence: "indexed",
    evidence: [
      evidence(
        "Wormholescan",
        url,
        `VAA ${row.emitterChain}/${row.sequence} · 도착 상태 ${row.targetChain?.status || "미확인"}`,
        {
          apps: s.appIds,
          payloadType: payload?.payloadType,
          messageRecipient: s.toAddress,
          sourceStatus: row.sourceChain?.status,
          sourceWormholeChainId: sourceId,
          destinationWormholeChainId: targetId,
        },
      ),
    ],
    notes: direct
      ? ["도착 주소는 Token Bridge 메시지의 수취 주소입니다."]
      : [
          "메시지 수취 컨트랙트와 최종 지갑을 구분하기 위해 최종 수취 주소는 비워 두었습니다. Payload 실행 후 토큰 이동을 추가 확인해야 합니다.",
        ],
  };
}
export async function wormhole(input: AdapterInput): Promise<AdapterResult> {
  const params = new URLSearchParams({
    [input.kind === "transaction" ? "txHash" : "address"]: input.query,
    pageSize: String(input.limit),
    page: String(input.page - 1),
  });
  if (input.kind === "address" && input.startTime && input.endTime) { params.set("from", input.startTime); params.set("to", input.endTime); }
  const url = `https://api.wormholescan.io/api/v1/operations?${params}`;
  try {
    const data = await jsonFetch(url);
    const rows = data.operations || [];
    return {
      routes: rows.map((r: any) => normalizeWormhole(r, url)),
      detail: `Wormholescan ${input.page}페이지 · 최대 ${input.limit}건 · Portal 통합`,
      hasMore: rows.length >= input.limit,
      warnings:
        rows.length === input.limit
          ? ["Wormholescan에 추가 결과가 있을 수 있습니다."]
          : [],
    };
  } catch (e) {
    if (e instanceof UpstreamError && e.status === 404)
      return { routes: [], detail: "Wormholescan 인덱스에서 미발견", hasMore: false };
    throw e;
  }
}
