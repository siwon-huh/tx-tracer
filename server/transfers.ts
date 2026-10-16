import { amount, sameAddress } from "./adapters/common.js";
import { chainName, getChain, txUrl } from "./chains.js";
import { errorText, jsonFetch } from "./http.js";
import { solanaRpc } from "./solana-rpc.js";
import type { Diagnostic, TransferEvent } from "../shared/types.js";

export interface TransferScan {
  transfers: TransferEvent[];
  diagnostics: Diagnostic[];
  warnings: string[];
  truncated: boolean;
}
export interface TransferQuery {
  chainId: string;
  address: string;
  // Empty tokens means all supported assets (for the first ordinary transfer).
  tokens: string[];
  direction?: "in" | "out";
  since: number;
  until: number;
  pages: number;
  // Shared across every wallet in one path search.
  budget: { remaining: number; deadline: number };
}
const TOKEN_PROGRAMS = new Set(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const assetKey = (value: string) =>
  /^(0x0{40}|0x[eE]{40}|11111111111111111111111111111111|native)$/i.test(value) ? "native" : value.startsWith("0x") ? value.toLowerCase() : value;
const positiveInteger = (value: unknown): string | undefined => {
  if (typeof value === "number" && !Number.isSafeInteger(value)) return undefined;
  const text = String(value ?? "");
  return /^\d+$/.test(text) && BigInt(text) > 0n ? text : undefined;
};

export function parseSolanaTransfers(tx: any, hash: string, endpoint: string, fetchedAt: string): TransferEvent[] {
  if (!tx?.meta || tx.meta.err !== null || !Number.isFinite(tx.blockTime)) return [];
  const keys = (tx.transaction?.message?.accountKeys || []).map((k: any) => typeof k === "string" ? k : k.pubkey);
  const metadata = new Map<string, { owner?: string; mint: string; decimals: number }>();
  const ambiguous = new Set<string>();
  for (const balance of [...(tx.meta.preTokenBalances || []), ...(tx.meta.postTokenBalances || [])]) {
    const account = keys[balance.accountIndex];
    if (!account) continue;
    const old = metadata.get(account);
    if (old && (old.mint !== balance.mint || (old.owner && balance.owner && old.owner !== balance.owner))) ambiguous.add(account);
    metadata.set(account, { owner: balance.owner || old?.owner, mint: balance.mint, decimals: balance.uiTokenAmount?.decimals });
  }
  const instructions: { instruction: any; sequence: number }[] = [];
  (tx.transaction?.message?.instructions || []).forEach((instruction: any, index: number) => {
    instructions.push({ instruction, sequence: index * 1000 });
    for (const [innerIndex, inner] of (tx.meta.innerInstructions?.find((group: any) => group.index === index)?.instructions || []).entries())
      instructions.push({ instruction: inner, sequence: index * 1000 + innerIndex + 1 });
  });
  const events: TransferEvent[] = [];
  for (const { instruction: ix, sequence } of instructions) {
    const info = ix.parsed?.info;
    const type = ix.parsed?.type;
    if (!info) continue;
    let from: string | undefined, to: string | undefined, token: string | undefined, raw: string | undefined, decimals: number | undefined;
    if (ix.programId === SYSTEM_PROGRAM && ["transfer", "transferWithSeed"].includes(type)) {
      from = info.source; to = info.destination; token = "native"; raw = positiveInteger(info.lamports); decimals = 9;
    } else if (TOKEN_PROGRAMS.has(ix.programId) && ["transfer", "transferChecked"].includes(type)) {
      if (ambiguous.has(info.source) || ambiguous.has(info.destination)) continue;
      const source = metadata.get(info.source), destination = metadata.get(info.destination);
      token = info.mint || source?.mint || destination?.mint;
      if (!token || (source?.mint && source.mint !== token) || (destination?.mint && destination.mint !== token)) continue;
      // The transfer authority can be a delegate. It is never used as the wallet owner.
      from = source?.owner || info.source; to = destination?.owner || info.destination;
      raw = positiveInteger(info.tokenAmount?.amount ?? info.amount);
      decimals = info.tokenAmount?.decimals ?? source?.decimals ?? destination?.decimals;
    }
    const display = amount(raw, decimals);
    if (!from || !to || !token || !raw || display === undefined || decimals === undefined) continue;
    events.push({ id: `solana:${hash}:${sequence}`, chainId: "solana", chain: "Solana", txHash: hash,
      from, to, tokenAddress: token, symbol: token === "native" ? "SOL" : undefined,
      rawAmount: raw, decimals, amount: display, timestamp: new Date(tx.blockTime * 1000).toISOString(),
      blockNumber: tx.slot, sequence, explorerUrl: txUrl("solana", hash),
      evidence: { provider: "Solana RPC", kind: "event", description: `성공 거래의 ${ix.parsed.type} 명령 · ${sequence}`,
        url: txUrl("solana", hash), fetchedAt, details: { endpoint, slot: tx.slot, instruction: ix, sourceTokenAccount: info.source, destinationTokenAccount: info.destination } },
    });
  }
  return events;
}

async function solanaHistory(query: TransferQuery, scan: TransferScan) {
  const addresses = new Set([query.address]);
  const mints = query.tokens.filter(t => t !== "native");
  if (!query.tokens.length) for (const programId of TOKEN_PROGRAMS) {
    if (Date.now() > query.budget.deadline) { scan.truncated = true; break; }
    try {
      const { result } = await solanaRpc("getTokenAccountsByOwner", [query.address, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }]);
      if (result.value?.length > 8) scan.truncated = true;
      for (const account of (result.value || []).slice(0, 8)) addresses.add(account.pubkey);
    } catch (error) { scan.warnings.push(errorText(error)); scan.truncated = true; }
  }
  if (mints.length > 8) scan.truncated = true;
  for (const mint of mints.slice(0, 8)) {
    if (Date.now() > query.budget.deadline) { scan.truncated = true; break; }
    try {
      const { result } = await solanaRpc("getTokenAccountsByOwner", [query.address, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }]);
      if (result.value?.length > 4) scan.truncated = true;
      for (const account of (result.value || []).slice(0, 4)) addresses.add(account.pubkey);
    } catch (error) {
      scan.warnings.push(`Solana 토큰 계정 조회 실패: ${errorText(error)}`);
      scan.truncated = true;
    }
  }
  const signatures = new Map<string, any>();
  const limit = 20;
  for (const address of addresses) {
    let before: string | undefined;
    for (let page = 0; page < query.pages; page++) {
      if (Date.now() > query.budget.deadline) { scan.truncated = true; break; }
      try {
        const { result } = await solanaRpc("getSignaturesForAddress", [address, { limit, before, commitment: "confirmed" }]);
        if (result.some((r: any) => r.err === null && r.blockTime == null)) scan.truncated = true;
        for (const row of result) if (row.err === null && row.blockTime != null && row.blockTime * 1000 >= query.since && row.blockTime * 1000 <= query.until) signatures.set(row.signature, row);
        if (result.length < limit || result.some((r: any) => r.blockTime != null && r.blockTime * 1000 < query.since)) break;
        before = result.at(-1)?.signature;
        if (page === query.pages - 1) scan.truncated = true;
      } catch (error) { scan.warnings.push(`Solana 서명 이력 일부 실패: ${errorText(error)}`); scan.truncated = true; break; }
    }
  }
  const rows = [...signatures.values()].sort((a, b) => b.blockTime - a.blockTime);
  for (const row of rows) {
    if (query.budget.remaining <= 0 || Date.now() > query.budget.deadline) { scan.truncated = true; break; }
    query.budget.remaining--;
    try {
      const { result, endpoint, fetchedAt } = await solanaRpc("getTransaction", [row.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
      scan.transfers.push(...parseSolanaTransfers(result, row.signature, endpoint, fetchedAt));
    } catch (error) { scan.warnings.push(`Solana 거래 ${row.signature.slice(0, 10)}… 조회 실패: ${errorText(error)}`); scan.truncated = true; }
  }
  scan.warnings.push("Solana는 지갑과 현재 토큰 계정의 최근 서명을 조회합니다. 닫힌 토큰 계정, 미파싱 명령, 스왑·Token-2022 전송 수수료 등은 누락될 수 있습니다.");
}

const explorers: Record<string, string> = {
  "1": "https://eth.blockscout.com", "10": "https://optimism.blockscout.com", "8453": "https://base.blockscout.com",
  "42161": "https://arbitrum.blockscout.com", "100": "https://gnosis.blockscout.com", "534352": "https://scroll.blockscout.com", "42220": "https://celo.blockscout.com",
};
export function parseBlockscoutTransfer(row: any, chainId: string, url: string, native = false): TransferEvent | undefined {
  if (native && row.status !== "ok") return;
  if (!native && (row.token?.type !== "ERC-20" || !row.token.address_hash || !Number.isInteger(row.log_index))) return;
  const raw = positiveInteger(native ? row.value : row.total?.value);
  const decimals = native ? 18 : Number(row.total?.decimals ?? row.token?.decimals);
  const display = amount(raw, decimals);
  const hash = native ? row.hash : row.transaction_hash;
  const from = row.from?.hash, to = row.to?.hash;
  if (!raw || display === undefined || !hash || !from || !to || !Number.isFinite(Date.parse(row.timestamp))) return;
  return { id: `${chainId}:${hash}:${native ? "native" : row.log_index}`, chainId, chain: chainName(chainId), txHash: hash,
    from, to, tokenAddress: native ? "native" : row.token.address_hash, symbol: native ? getChain(chainId)?.symbol : row.token.symbol,
    rawAmount: raw, decimals, amount: display, timestamp: row.timestamp, blockNumber: row.block_number,
    sequence: native ? -1 : row.log_index, explorerUrl: txUrl(chainId, hash),
    evidence: { provider: "Blockscout", kind: "indexer", description: native ? "성공 거래의 native value 전송" : "ERC-20 Transfer 이벤트",
      url, fetchedAt: new Date().toISOString(), details: row } };
}
async function evmHistory(query: TransferQuery, scan: TransferScan) {
  const base = explorers[query.chainId];
  if (!base) throw new Error("이 체인의 일반 송금 이력 인덱서는 아직 연결되지 않았습니다.");
  const kinds = [...((!query.tokens.length || query.tokens.some(t => t !== "native")) ? ["token-transfers"] : []), ...((!query.tokens.length || query.tokens.includes("native")) ? ["transactions"] : [])];
  for (const kind of kinds) {
    let cursor: Record<string, string> = {};
    for (let page = 0; page < query.pages; page++) {
      if (query.budget.remaining <= 0 || Date.now() > query.budget.deadline) { scan.truncated = true; break; }
      const params = new URLSearchParams({ filter: query.direction === "out" ? "from" : "to", ...cursor, ...(kind === "token-transfers" ? { type: "ERC-20" } : {}) });
      const url = `${base}/api/v2/addresses/${encodeURIComponent(query.address)}/${kind}?${params}`;
      try {
        const data = await jsonFetch(url, {}, 8000);
        for (const row of data.items || []) {
          const at = Date.parse(row.timestamp);
          if (!Number.isFinite(at)) { scan.truncated = true; continue; }
          if (at < query.since || at > query.until) continue;
          if (query.budget.remaining <= 0) { scan.truncated = true; break; }
          query.budget.remaining--;
          const event = parseBlockscoutTransfer(row, query.chainId, url, kind === "transactions");
          if (event) scan.transfers.push(event);
        }
        if (!data.next_page_params || data.items?.some((r: any) => Date.parse(r.timestamp) < query.since)) break;
        cursor = data.next_page_params;
        if (page === query.pages - 1) scan.truncated = true;
      } catch (error) { scan.warnings.push(errorText(error)); scan.truncated = true; break; }
    }
  }
  scan.warnings.push("EVM 일반 송금은 연결된 Blockscout의 ERC-20 이벤트와 native value 전송을 사용합니다. 내부 native 송금·스왑 경로는 포함하지 않습니다.");
}

async function tronHistory(query: TransferQuery, scan: TransferScan) {
  let fingerprint: string | undefined;
  for (let page = 0; page < query.pages; page++) {
    if (query.budget.remaining <= 0 || Date.now() > query.budget.deadline) { scan.truncated = true; break; }
    const params = new URLSearchParams({ only_confirmed: "true", [query.direction === "out" ? "only_from" : "only_to"]: "true", limit: "50", min_timestamp: String(query.since), max_timestamp: String(query.until), ...(fingerprint ? { fingerprint } : {}) });
    const url = `https://api.trongrid.io/v1/accounts/${encodeURIComponent(query.address)}/transactions/trc20?${params}`;
    const data = await jsonFetch(url, {}, 8000);
    if (data.success !== true || !Array.isArray(data.data)) throw new Error("TronGrid 이력 응답을 확인할 수 없습니다.");
    for (const [index, row] of data.data.entries()) {
      if (query.budget.remaining <= 0) { scan.truncated = true; break; }
      query.budget.remaining--;
      const raw = positiveInteger(row.value), decimals = row.token_info?.decimals;
      const display = amount(raw, decimals);
      if (row.type !== "Transfer" || !raw || display === undefined || !row.token_info?.address || !Number.isFinite(row.block_timestamp)) continue;
      scan.transfers.push({ id: `tron:${row.transaction_id}:${row.from}:${row.to}:${row.token_info.address}:${raw}:${index}`, chainId: "tron", chain: "Tron",
        txHash: row.transaction_id, from: row.from, to: row.to, tokenAddress: row.token_info.address, symbol: row.token_info.symbol,
        amount: display, rawAmount: raw, decimals, timestamp: new Date(row.block_timestamp).toISOString(), sequence: 0,
        explorerUrl: txUrl("tron", row.transaction_id), evidence: { provider: "TronGrid", kind: "indexer", description: "확인된 TRC-20 Transfer 이력", url, fetchedAt: new Date().toISOString(), details: row } });
    }
    if (!data.meta?.fingerprint || data.data.length < 50) break;
    fingerprint = data.meta.fingerprint;
    if (page === query.pages - 1) scan.truncated = true;
  }
  scan.warnings.push("Tron 후속 송금은 공개 TronGrid의 확인된 TRC-20 전송을 조회합니다. TRX·TRC-10·스왑은 제외합니다.");
}

export async function incomingTransfers(query: TransferQuery): Promise<TransferScan> {
  const scan: TransferScan = { transfers: [], diagnostics: [], warnings: [], truncated: false };
  const start = Date.now();
  let failed = false;
  try {
    if (query.chainId === "solana") await solanaHistory(query, scan);
    else if (query.chainId === "tron") await tronHistory(query, scan);
    else await evmHistory(query, scan);
  } catch (error) { failed = true; scan.warnings.push(errorText(error)); scan.truncated = true; }
  scan.transfers = [...new Map(scan.transfers.filter(t => sameAddress(query.direction === "out" ? t.from : t.to, query.address) &&
    (!query.tokens.length || query.tokens.some(token => assetKey(token) === assetKey(t.tokenAddress))) &&
    Date.parse(t.timestamp) >= query.since && Date.parse(t.timestamp) <= query.until).map(t => [t.id, t])).values()];
  scan.diagnostics.push({ provider: `일반 송금 · ${chainName(query.chainId)} · ${query.address.slice(0, 10)}…`, state: failed ? "error" : scan.truncated ? "partial" : scan.transfers.length ? "ok" : "empty",
    count: scan.transfers.length, durationMs: Date.now() - start,
    detail: `${query.direction === "out" ? "송신" : "수취"} 이력 · 최대 ${query.pages}페이지${scan.truncated ? " · 한도 또는 일부 미조회" : ""}${failed ? ` · ${scan.warnings.at(-1)}` : ""}` });
  return scan;
}
