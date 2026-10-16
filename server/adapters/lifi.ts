import { jsonFetch, UpstreamError } from "../http.js";
import {
  amount,
  evidence,
  leg,
  timestamp,
  type AdapterInput,
  type AdapterResult,
} from "./common.js";
import type { BridgeRoute } from "../../shared/types.js";

export function normalizeLifi(row: any, url: string): BridgeRoute | null {
  if (!row.sending?.txHash || row.status === "NOT_FOUND") return null;
  const side = (v: any, address?: string) =>
    leg(
      v?.chainId,
      {
        txHash: v?.txHash,
        address,
        amount: amount(v?.amount, v?.token?.decimals),
        symbol: v?.token?.symbol,
        tokenAddress: v?.token?.address,
        timestamp: timestamp(v?.timestamp),
      },
      "lifi",
    );
  const refunded = row.substatus === "REFUNDED";
  return {
    id: `lifi:${row.transactionId || row.sending.txHash}:${row.receiving?.txHash || ""}`,
    bridge: row.tool || "LI.FI route",
    protocol: "lifi",
    aggregator: "LI.FI",
    status: refunded
      ? "refunded"
      : row.status === "DONE"
        ? "delivered"
        : row.status === "FAILED"
          ? "failed"
          : row.status === "PENDING"
            ? "pending"
            : "unknown",
    source: side(row.sending, row.fromAddress),
    destination: side(row.receiving, row.toAddress),
    confidence: "indexed",
    evidence: [
      evidence(
        "LI.FI",
        url,
        `인덱서 상태: ${row.status} / ${row.substatus || "미제공"}`,
        {
          tool: row.tool,
          substatus: row.substatus,
          sendingSteps: row.sending?.includedSteps,
          receivingSteps: row.receiving?.includedSteps,
        },
      ),
    ],
    notes: [
      ...(row.substatus === "PARTIAL"
        ? ["요청 토큰과 다른 토큰으로 도착한 PARTIAL 결과입니다."]
        : []),
      ...(refunded
        ? [
            "브릿지가 환불 상태를 보고했습니다. 도착 정보를 최종 수취 성공으로 해석하지 마세요.",
          ]
        : []),
    ],
  };
}
export async function lifi(input: AdapterInput): Promise<AdapterResult> {
  const params = new URLSearchParams(
    input.kind === "transaction"
      ? { txHash: input.query }
      : {
          wallet: input.query,
          status: "ALL",
          fromTimestamp: String(
            Math.floor((input.startTime ? Date.parse(input.startTime) : Date.now() - 86400_000 * input.days) / 1000),
          ),
          toTimestamp: String(Math.floor((input.endTime ? Date.parse(input.endTime) : Date.now()) / 1000)),
        },
  );
  const url = `https://li.quest/v1/${input.kind === "transaction" ? "status" : "analytics/transfers"}?${params}`;
  try {
    const data = await jsonFetch(url, {
      headers: process.env.LIFI_API_KEY
        ? { "x-lifi-api-key": process.env.LIFI_API_KEY }
        : {},
    });
    const rows = input.kind === "transaction" ? [data] : data.transfers || [];
    return {
      routes: rows.map((r: any) => normalizeLifi(r, url)).filter(Boolean),
      detail:
        input.kind === "transaction"
          ? "LI.FI 인덱싱 경로 조회"
          : `${input.startTime && input.endTime ? `${input.startTime} ~ ${input.endTime}` : `최근 ${input.days}일`} · LI.FI 인덱싱 이력 · 최대 1,000건`,
      partial: rows.length >= 1000,
      warnings:
        rows.length >= 1000 ? ["LI.FI의 1,000건 상한에 도달했습니다."] : [],
    };
  } catch (e) {
    if (e instanceof UpstreamError && e.status === 404)
      return { routes: [], detail: "LI.FI 인덱스에서 미발견" };
    throw e;
  }
}
