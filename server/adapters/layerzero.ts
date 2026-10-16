import { jsonFetch, UpstreamError } from "../http";
import {
  evidence,
  leg,
  timestamp,
  type AdapterInput,
  type AdapterResult,
} from "./common";
import type { BridgeRoute } from "../../shared/types";
export function normalizeLayerzero(row: any, url: string): BridgeRoute {
  const path = row.pathway || {};
  const name = path.sender?.name || path.sender?.id || "LayerZero application";
  const bridge = /stargate/i.test(name) ? "Stargate" : name;
  const status = row.status?.name;
  return {
    id: `layerzero:${row.guid}`,
    messageId: row.guid,
    bridge,
    protocol: "layerzero",
    source: leg(
      path.srcEid,
      {
        chain: path.sender?.chain || undefined,
        txHash: row.source?.tx?.txHash,
        timestamp: timestamp(row.source?.tx?.blockTimestamp),
      },
      "layerzero",
    ),
    destination: leg(
      path.dstEid,
      {
        chain: path.receiver?.chain || undefined,
        txHash: row.destination?.tx?.txHash,
        timestamp: timestamp(row.destination?.tx?.blockTimestamp),
      },
      "layerzero",
    ),
    status:
      status === "DELIVERED"
        ? "delivered"
        : [
              "FAILED",
              "BLOCKED",
              "PAYLOAD_STORED",
              "APPLICATION_BURNED",
              "APPLICATION_SKIPPED",
            ].includes(status)
          ? "failed"
          : ["INFLIGHT", "CONFIRMING"].includes(status)
            ? "pending"
            : "unknown",
    confidence: "indexed",
    evidence: [
      evidence("LayerZero Scan", url, `메시지 상태: ${status}`, {
        srcEid: path.srcEid,
        dstEid: path.dstEid,
        senderContract: path.sender?.address,
        receiverContract: path.receiver?.address,
        compose: row.destination?.lzCompose,
      }),
    ],
    notes: [
      "메시지 전달 경로입니다. 프로토콜 컨트랙트·릴레이어를 최종 송수신 지갑으로 표시하지 않습니다.",
      "토큰 금액과 최종 수취인은 이 API만으로 확인되지 않습니다. lzCompose의 후속 실행은 별도 확인이 필요합니다.",
    ],
  };
}
export async function layerzero(input: AdapterInput): Promise<AdapterResult> {
  const url = `https://scan.layerzero-api.com/v1/messages/${input.kind === "transaction" ? "tx" : "wallet"}/${encodeURIComponent(input.query)}${input.kind === "address" ? `?limit=${input.limit}` : ""}`;
  try {
    const data = await jsonFetch(url);
    return {
      routes: (data.data || []).map((r: any) => normalizeLayerzero(r, url)),
      detail:
        input.kind === "address"
          ? "첫 페이지 · 출발 initiator 주소만 조회 (수취인 검색 제외)"
          : "출발 또는 도착 메시지 해시 조회",
      warnings: data.nextToken
        ? ["LayerZero 결과는 첫 페이지이며 추가 이력이 있습니다."]
        : [],
    };
  } catch (e) {
    if (e instanceof UpstreamError && e.status === 404)
      return { routes: [], detail: "LayerZero 인덱스에서 미발견" };
    throw e;
  }
}
