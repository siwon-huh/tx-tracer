import { chainName, txUrl } from "./chains.js";
import { jsonFetch, mapLimit } from "./http.js";
import type { Candidate, Diagnostic } from "../shared/types.js";
const explorers: Record<string, string> = {
  1: "https://eth.blockscout.com",
  10: "https://optimism.blockscout.com",
  8453: "https://base.blockscout.com",
  42161: "https://arbitrum.blockscout.com",
  100: "https://gnosis.blockscout.com",
  534352: "https://scroll.blockscout.com",
  42220: "https://celo.blockscout.com",
};
export async function addressHistory(
  address: string,
  chainId: string | undefined,
  page: number,
  limit: number,
): Promise<{ candidates: Candidate[]; diagnostics: Diagnostic[] }> {
  if (!/^0x[\da-f]{40}$/i.test(address))
    return { candidates: [], diagnostics: [] };
  const ids = chainId ? [chainId] : ["1", "8453", "42161", "10"];
  const diagnostics: Diagnostic[] = [];
  const rows = await mapLimit(ids, 3, async (id) => {
    const start = Date.now();
    const provider = `주소 이력 · ${chainName(id)}`;
    try {
      let candidates: Candidate[] = [];
      let detail = "";
      if (process.env.ETHERSCAN_API_KEY) {
        const params = new URLSearchParams({
          chainid: id,
          module: "account",
          action: "txlist",
          address,
          startblock: "0",
          endblock: "999999999",
          page: String(page),
          offset: String(limit),
          sort: "desc",
          apikey: process.env.ETHERSCAN_API_KEY,
        });
        const data = await jsonFetch(
          `https://api.etherscan.io/v2/api?${params}`,
        );
        if (!Array.isArray(data.result))
          throw new Error(`Etherscan: ${String(data.result).slice(0, 120)}`);
        candidates = data.result.map((r: any) => ({
          hash: r.hash,
          chainId: id,
          chain: chainName(id),
          from: r.from,
          to: r.to,
          method: r.functionName?.split("(")[0],
          timestamp: new Date(Number(r.timeStamp) * 1000).toISOString(),
          explorerUrl: txUrl(id, r.hash),
        }));
        detail = `Etherscan 일반 거래 ${page}페이지 · 내부 거래/토큰 수취 전체 이력 제외`;
      } else if (explorers[id]) {
        const base = explorers[id];
        // Walk the explorer's actual cursor. Never invent block-number offsets.
        const kinds = ["transactions", "token-transfers"];
        const streams = await Promise.allSettled(
          kinds.map(async (kind) => {
            let cursor: Record<string, string> = {};
            let data: any;
            for (let i = 0; i < page; i++) {
              data = await jsonFetch(
                `${base}/api/v2/addresses/${address}/${kind}?${new URLSearchParams(cursor)}`,
                {},
                8000,
              );
              if (i < page - 1 && !data.next_page_params) return [];
              cursor = data.next_page_params || {};
            }
            return (data.items || []).map((r: any) => ({
              hash: r.hash || r.transaction_hash,
              chainId: id,
              chain: chainName(id),
              from: r.from?.hash,
              to: r.to?.hash,
              method: r.method || r.to?.name || kind,
              timestamp: r.timestamp,
              explorerUrl: txUrl(id, r.hash || r.transaction_hash),
            }));
          }),
        );
        streams.forEach((stream, index) => {
          if (stream.status === "rejected")
            diagnostics.push({
              provider: `${provider} · ${kinds[index]}`,
              state: "error",
              durationMs: Date.now() - start,
              count: 0,
              detail:
                stream.reason instanceof Error
                  ? stream.reason.message
                  : "조회 실패",
            });
        });
        candidates = [
          ...new Map<string, Candidate>(
            streams
              .flatMap((stream) =>
                stream.status === "fulfilled" ? stream.value : [],
              )
              .filter((r) => r.hash)
              .map((r) => [r.hash, r]),
          ).values(),
        ];
        detail = `Blockscout ${page}페이지 · 일반 거래 + 토큰 입출금 (각 최대 50건). 내부 ETH 수취 제외. ${streams.filter((stream) => stream.status === "fulfilled").length}/2 목록 응답`;
      } else {
        diagnostics.push({
          provider,
          state: "skipped",
          durationMs: 0,
          count: 0,
          detail:
            "이 체인의 주소 이력을 조회할 수 없습니다. 트랜잭션 해시로 검색해 주세요.",
        });
        return [];
      }
      diagnostics.push({
        provider,
        state: candidates.length ? "ok" : "empty",
        durationMs: Date.now() - start,
        count: candidates.length,
        detail,
      });
      return candidates;
    } catch (e) {
      diagnostics.push({
        provider,
        state: "error",
        durationMs: Date.now() - start,
        count: 0,
        detail: e instanceof Error ? e.message : "조회 실패",
      });
      return [];
    }
  });
  return {
    candidates: rows
      .flat()
      .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || "")),
    diagnostics,
  };
}
