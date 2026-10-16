import { jsonFetch } from "../http";
import {
  evidence,
  leg,
  sameAddress,
  timestamp,
  type AdapterInput,
  type AdapterResult,
} from "./common";
import type { BridgeRoute } from "../../shared/types";
function chainId(n: any) {
  const family = n?.chainFamily?.toLowerCase();
  if (!family || family === "evm") return n?.chainId;
  if (
    ["solana", "aptos", "sui", "tron", "stellar", "ton", "starknet"].includes(
      family,
    )
  )
    return family;
  return `ccip:${family}:${n?.chainId ?? "unknown"}`;
}
export function normalizeCcip(row: any, url: string): BridgeRoute {
  return {
    id: `ccip:${row.messageId}`,
    messageId: row.messageId,
    bridge: "Chainlink CCIP",
    protocol: "ccip",
    source: leg(chainId(row.sourceNetworkInfo), {
      chain: row.sourceNetworkInfo?.displayName,
      txHash: row.sendTransactionHash,
      address: row.sender,
      timestamp: timestamp(row.sendTimestamp),
      tokenAddress: row.sourceTokenAmount?.tokenAddress,
      rawAmount: row.sourceTokenAmount?.tokenAmount,
    }),
    destination: leg(chainId(row.destNetworkInfo), {
      chain: row.destNetworkInfo?.displayName,
      txHash: row.receiptTransactionHash || undefined,
      address: row.tokenReceiver || row.receiver,
      timestamp: timestamp(row.receiptTimestamp),
    }),
    status:
      row.status === "SUCCESS"
        ? "delivered"
        : row.status === "FAILED"
          ? "failed"
          : /PROGRESS|PENDING|WAIT|SENT|COMMIT|BLESS|EXECUT/i.test(row.status)
            ? "pending"
            : "unknown",
    confidence: "indexed",
    evidence: [
      evidence("CCIP API", url, `메시지 실행 상태: ${row.status}`, {
        status: row.status,
        sourceTokenAmount: row.sourceTokenAmount,
        receiverContract: row.receiver,
        tokenReceiver: row.tokenReceiver,
        hasData: row.hasData,
        readyForManualExecution: row.readyForManualExecution,
      }),
    ],
    notes: [
      !row.sourceTokenAmount
        ? "데이터 메시지일 수 있습니다. 토큰 전송이 있었다고 단정하지 않습니다."
        : "토큰 원시 수량은 증거에 보존했습니다. 소수점 메타데이터가 없어 표시 금액을 계산하지 않습니다.",
      ...(!row.tokenReceiver
        ? [
            "수취 주소는 CCIP 메시지 receiver 컨트랙트이며 최종 토큰 소유자가 아닐 수 있습니다.",
          ]
        : []),
    ],
  };
}
export async function ccip(input: AdapterInput): Promise<AdapterResult> {
  const url = `https://api.ccip.chain.link/v2/messages?${new URLSearchParams({ q: input.query, limit: String(input.limit) })}`;
  const data = await jsonFetch(url);
  // q also searches token/router addresses. Keep only transaction/message or participant matches.
  const rows = (data.data || []).filter((r: any) =>
    input.kind === "transaction"
      ? [r.sendTransactionHash, r.receiptTransactionHash, r.messageId].some(
          (v) => sameAddress(v, input.query),
        )
      : [r.sender, r.receiver, r.tokenReceiver].some((v) =>
          sameAddress(v, input.query),
        ),
  );
  return {
    routes: rows.map((r: any) => normalizeCcip(r, url)),
    detail: "CCIP 첫 페이지 · 메시지 송수신 역할 확인",
    warnings: data.pagination?.hasNextPage
      ? ["CCIP 결과는 첫 페이지이며 추가 이력이 있습니다."]
      : [],
  };
}
