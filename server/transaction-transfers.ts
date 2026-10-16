import { Interface, formatUnits } from "ethers";
import { chainName, getChain, txUrl } from "./chains.js";
import { rpc } from "./rpc.js";
import { mapLimit } from "./http.js";
import type { TransferEvent } from "../shared/types.js";

const tokenAbi = new Interface(["function decimals() view returns(uint8)", "function symbol() view returns(string)"]);
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const isAddress = (value: unknown): value is string => typeof value === "string" && /^0x[\da-f]{40}$/i.test(value);

// Read the receipt's exact block, and never infer a send from a contract call's
// recipient alone. ERC-721's four-topic Transfer events are deliberately excluded.
export async function evmTransactionTransfers(chainId: string, receipt: any) {
  const transfers: TransferEvent[] = [];
  if (receipt.status !== "0x1") return { transfers, partial: false };
  const hash = receipt.transactionHash;
  const [block, transaction] = await Promise.all([
    rpc.call(chainId, "eth_getBlockByHash", [receipt.blockHash, false]),
    rpc.call(chainId, "eth_getTransactionByHash", [hash]),
  ]);
  if (block.result?.hash?.toLowerCase() !== receipt.blockHash?.toLowerCase() ||
    transaction.result?.hash?.toLowerCase() !== hash?.toLowerCase() ||
    transaction.result?.blockHash?.toLowerCase() !== receipt.blockHash?.toLowerCase()) throw new Error("거래와 블록 정보가 일치하지 않습니다.");
  const seconds = Number(block.result.timestamp);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new Error("거래 시각을 확인하지 못했습니다.");
  const timestamp = new Date(seconds * 1000).toISOString(), url = txUrl(chainId, hash);
  const make = (from: string, to: string, tokenAddress: string, raw: bigint, decimals: number, sequence: number, symbol?: string): TransferEvent => ({
    id: `${chainId}:${hash}:${sequence === -1 ? "native" : sequence}`, chainId, chain: chainName(chainId), txHash: hash,
    from, to, tokenAddress, rawAmount: raw.toString(), amount: formatUnits(raw, decimals), decimals, symbol, timestamp,
    blockNumber: Number(receipt.blockNumber), sequence, explorerUrl: url,
    evidence: { provider: "RPC", kind: "event", description: sequence === -1 ? "성공 거래의 native value 전송" : "ERC-20 Transfer 이벤트", url, fetchedAt: new Date().toISOString() },
  });
  const tx = transaction.result;
  if (isAddress(tx.from) && isAddress(tx.to) && /^0x[\da-f]+$/i.test(tx.value || "") && BigInt(tx.value) > 0n)
    transfers.push(make(tx.from, tx.to, "native", BigInt(tx.value), 18, -1, getChain(chainId)?.symbol));
  const logs = (receipt.logs || []).filter((log: any) => !log.removed && isAddress(log.address) && log.topics?.length === 3 &&
    log.topics[0]?.toLowerCase() === transferTopic && /^0x[\da-f]{64}$/i.test(log.data) &&
    log.topics.slice(1).every((topic: string) => /^0x0{24}[\da-f]{40}$/i.test(topic)) && Number.isSafeInteger(Number(log.logIndex)) && Number(log.logIndex) >= 0);
  const tokens: string[] = [...new Set<string>(logs.map((log: any) => log.address.toLowerCase()))];
  let partial = logs.length > 80 || tokens.length > 12;
  const metadata = new Map<string, { decimals: number; symbol?: string }>();
  await mapLimit(tokens.slice(0, 12), 3, async address => {
    try {
      const d = await rpc.call(chainId, "eth_call", [{ to: address, data: tokenAbi.encodeFunctionData("decimals") }, receipt.blockNumber]);
      const decimals = Number(tokenAbi.decodeFunctionResult("decimals", d.result)[0]);
      let symbol: string | undefined;
      try {
        const s = await rpc.call(chainId, "eth_call", [{ to: address, data: tokenAbi.encodeFunctionData("symbol") }, receipt.blockNumber]);
        symbol = String(tokenAbi.decodeFunctionResult("symbol", s.result)[0]).slice(0, 32);
      } catch { /* The token address still identifies the asset. */ }
      metadata.set(address, { decimals, symbol });
    } catch { partial = true; }
  });
  for (const log of logs.slice(0, 80)) {
    const meta = metadata.get(log.address.toLowerCase()), raw = BigInt(log.data);
    if (!meta || raw <= 0n) continue;
    const from = `0x${log.topics[1].slice(-40)}`, to = `0x${log.topics[2].slice(-40)}`;
    // Mint and burn events are not wallet-to-wallet payments.
    if (/^0x0{40}$/i.test(from) || /^0x0{40}$/i.test(to)) continue;
    transfers.push(make(from, to, log.address, raw, meta.decimals, Number(log.logIndex), meta.symbol));
  }
  return { transfers, partial };
}
