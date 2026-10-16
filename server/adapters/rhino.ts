import { jsonFetch, UpstreamError } from "../http.js";
import { evidence, leg, type AdapterInput, type AdapterResult } from "./common.js";
import type { BridgeRoute } from "../../shared/types.js";
const chainIds: Record<string, string> = {
  ETHEREUM: "1",
  ARBITRUM: "42161",
  OPTIMISM: "10",
  BASE: "8453",
  POLYGON: "137",
  BSC: "56",
  AVALANCHE: "43114",
  ZKSYNC: "324",
  LINEA: "59144",
  SCROLL: "534352",
  MANTLE: "5000",
  STARKNET: "starknet",
  TRON: "tron",
  SOLANA: "solana",
  BITCOIN: "bitcoin",
  SUI: "sui",
  APTOS: "aptos",
  TON: "ton",
  STELLAR: "stellar",
};
export function normalizeRhino(r: any, url: string): BridgeRoute {
  const side = (
    chain: string,
    address: string,
    hash: string,
    qty: string,
    symbol: string,
    time: string,
  ) =>
    leg(
      chainIds[chain?.toUpperCase()] ||
        (/^\d+$/.test(chain) ? chain : undefined),
      { chain, txHash: hash, address, amount: qty, symbol, timestamp: time },
    );
  return {
    id: `rhino:${r._id}`,
    bridge: "rhino.fi",
    protocol: "rhino",
    source: side(
      r.chainIn,
      r.depositor,
      r.depositTxHash,
      r.amountIn,
      r.tokenIn || r.token,
      r.depositCommittedAt,
    ),
    destination: side(
      r.chainOut,
      r.recipient,
      r.withdrawTxHash,
      r.amountOut,
      r.tokenOut || r.token,
      r.withdrawCommittedAt,
    ),
    status:
      r.state === "EXECUTED"
        ? "delivered"
        : r.state === "SWAP_FAILED_REFUNDED"
          ? "refunded"
          : ["FAILED", "CANCELLED", "SWAP_FAILED"].includes(r.state)
            ? "failed"
            : "pending",
    confidence: "indexed",
    notes: [
      "연결한 API 자격 증명의 계정·프로젝트 권한 범위에서 조회되었습니다.",
    ],
    evidence: [
      evidence("rhino.fi", url, `브릿지 상태: ${r.state}`, {
        state: r.state,
        id: r._id,
      }),
    ],
  };
}
export async function rhino(input: AdapterInput): Promise<AdapterResult> {
  if (!process.env.RHINO_API_KEY || input.kind === "address")
    return { routes: [], detail: "인증된 거래 해시 조회만 지원" };
  const results: BridgeRoute[] = [];
  for (const path of ["by-deposit-hash", "by-withdraw-hash"]) {
    const url = `https://api.rhino.fi/bridge/history/bridge/${path}/${encodeURIComponent(input.query)}`;
    try {
      const data = await jsonFetch(url, {
        headers: { Authorization: `Bearer ${process.env.RHINO_API_KEY}` },
      });
      for (const r of Array.isArray(data) ? data : [data])
        results.push(normalizeRhino(r, url));
    } catch (e) {
      if (e instanceof UpstreamError && e.status === 404) continue;
      throw e;
    }
  }
  return {
    routes: [...new Map(results.map((r) => [r.id, r])).values()],
    detail: "인증된 통합 계정 권한 범위",
  };
}
