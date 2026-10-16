import { jsonFetch } from "../http";
import {
  amount,
  evidence,
  leg,
  timestamp,
  type AdapterInput,
  type AdapterResult,
} from "./common";
import type { BridgeRoute } from "../../shared/types";
const bases = [
  "https://gateway.liquify.com/chain/thorchain_midgard",
  "https://midgard.thorchain.network",
];
function assetChain(asset: string) {
  if (asset.includes("~") || asset.includes("/")) return "thorchain";
  return (
    (
      {
        ETH: "1",
        BTC: "bitcoin",
        THOR: "thorchain",
        AVAX: "43114",
        BSC: "56",
        BASE: "8453",
        LTC: "litecoin",
        BCH: "bitcoincash",
        DOGE: "dogecoin",
        GAIA: "cosmos",
        XRP: "xrp",
      } as Record<string, string>
    )[asset.split(".")[0]] || asset.split(".")[0].toLowerCase()
  );
}
export function normalizeThorchain(
  row: any,
  url: string,
  index = 0,
): BridgeRoute[] {
  if (!["swap", "refund"].includes(row.type)) return [];
  const outs = (row.out || []).filter((v: any) => !v.affiliate);
  // Preserve every principal input/output. A multi-input action is an action-level correlation,
  // not a claim that each input independently funded every output.
  return (row.in || []).flatMap((src: any, si: number) =>
    (outs.length ? outs : [{}]).map((dst: any, di: number) => {
      const from = src.coins?.[0];
      const to = dst.coins?.[0];
      const side = (tx: any, coin: any) =>
        leg(coin ? assetChain(coin.asset) : undefined, {
          txHash: tx.txID || undefined,
          address: tx.address,
          amount: amount(coin?.amount, 8),
          symbol: coin?.asset?.split(".")[1]?.split("-")[0] || coin?.asset,
          timestamp: timestamp(row.date),
        });
      return {
        id: `thor:${src.txID}:${dst.txID || index}:${si}:${di}`,
        bridge: "THORChain",
        protocol: "thorchain",
        source: side(src, from),
        destination: side(dst, to),
        status:
          row.type === "refund"
            ? "refunded"
            : row.status === "success" && dst.txID
              ? "delivered"
              : row.status === "pending"
                ? "pending"
                : "unknown",
        confidence: "indexed",
        evidence: [
          evidence("Midgard", url, `${row.type} / ${row.status}`, {
            type: row.type,
            status: row.status,
            in: row.in,
            out: row.out,
            metadata: row.metadata,
          }),
        ],
        notes: [
          ...(row.in?.length > 1 || outs.length > 1
            ? [
                "다중 입출력 action입니다. 그래프 연결은 동일 action에 속함을 나타내며 개별 자금 배분을 증명하지 않습니다.",
              ]
            : []),
          ...(from?.asset?.includes("~") ||
          from?.asset?.includes("/") ||
          to?.asset?.includes("~") ||
          to?.asset?.includes("/")
            ? ["Trade/synthetic 자산은 THORChain 내부 계정으로 표시합니다."]
            : []),
        ],
      } as BridgeRoute;
    }),
  );
}
export async function thorchain(input: AdapterInput): Promise<AdapterResult> {
  const params = new URLSearchParams({
    [input.kind === "transaction" ? "txid" : "address"]:
      input.kind === "transaction"
        ? input.query.replace(/^0x/, "")
        : input.query,
    limit: String(input.limit),
    offset: String((input.page - 1) * input.limit),
  });
  if (input.kind === "address" && input.startTime && input.endTime) {
    // Midgard uses seconds and strict inequalities; expand one second and filter exactly downstream.
    params.set("timestamp", String(Math.floor(Date.parse(input.endTime) / 1000) + 1));
    params.set("fromTimestamp", String(Math.max(0, Math.floor(Date.parse(input.startTime) / 1000) - 1)));
  }
  let last: unknown;
  for (const base of bases) {
    const url = `${base}/v2/actions?${params}`;
    try {
      const data = await jsonFetch(url, {}, 8500);
      const rows = data.actions || [];
      return {
        routes: rows.flatMap((r: any, i: number) =>
          normalizeThorchain(r, url, i),
        ),
        hasMore: rows.length >= input.limit,
        detail: `Midgard ${input.page}페이지 · swap/refund만 · 최대 ${input.limit} actions`,
        warnings:
          rows.length === input.limit
            ? ["Midgard에 추가 이력이 있을 수 있습니다."]
            : [],
      };
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
