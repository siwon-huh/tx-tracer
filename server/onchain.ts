import { Interface, formatUnits } from "ethers";
import { getL2TransactionHashes } from "viem/op-stack";
import { rpc } from "./rpc";
import { chainName, getChain, txUrl } from "./chains";
import { leg } from "./adapters/common";
import { TTLCache, errorText, mapLimit } from "./http";
import type { BridgeRoute, Diagnostic, Leg } from "../shared/types";
import { opDeployments } from "./official-registry";
export { opDeployments } from "./official-registry";

// Deployment addresses are verified against the official Superchain Registry and Arbitrum docs.
// Event signatures alone are never sufficient to identify a bridge.
const L2_BRIDGE = "0x4200000000000000000000000000000000000010";
const opAbi = new Interface([
  "event ETHBridgeInitiated(address indexed from,address indexed to,uint256 amount,bytes extraData)",
  "event ETHBridgeFinalized(address indexed from,address indexed to,uint256 amount,bytes extraData)",
  "event ERC20BridgeInitiated(address indexed localToken,address indexed remoteToken,address indexed from,address to,uint256 amount,bytes extraData)",
  "event ERC20BridgeFinalized(address indexed localToken,address indexed remoteToken,address indexed from,address to,uint256 amount,bytes extraData)",
]);
const arbAbi = new Interface([
  "event DepositInitiated(address l1Token,address indexed _from,address indexed _to,uint256 indexed _sequenceNumber,uint256 _amount)",
  "event WithdrawalFinalized(address l1Token,address indexed _from,address indexed _to,uint256 indexed _exitNum,uint256 _amount)",
  "event DepositFinalized(address indexed l1Token,address indexed _from,address indexed _to,uint256 _amount)",
  "event WithdrawalInitiated(address l1Token,address indexed _from,address indexed _to,uint256 indexed _l2ToL1Id,uint256 _exitNum,uint256 _amount)",
]);
const arbGateways: Record<string, string[]> = {
  "1": ["0xa3A7B6F88361F48403514059F1F16C8E78d60EeC"],
  "42161": ["0x09e9222E96E7B4AE2a407B98d48e330053351EEe"],
};
const tokens = new Interface([
  "function decimals() view returns(uint8)",
  "function symbol() view returns(string)",
]);
const tokenCache = new TTLCache<{ decimals: number; symbol?: string }>(500);
const receipts = new TTLCache<any>(500);
export async function getReceipt(chainId: string, hash: string) {
  const key = `${chainId}:${hash.toLowerCase()}`;
  const cached = receipts.get(key);
  if (cached) return cached;
  const data = await rpc.call(chainId, "eth_getTransactionReceipt", [hash], {
    nullQuorum: 2,
  });
  if (data.result) {
    if (
      String(data.result.transactionHash).toLowerCase() !== hash.toLowerCase()
    )
      throw new Error("RPC receipt 해시 불일치");
    receipts.set(key, data, 45_000);
  }
  return data;
}
export function decodeOfficial(chainId: string, receipt: any): BridgeRoute[] {
  if (receipt.status !== "0x1") return [];
  const routes: BridgeRoute[] = [];
  for (const log of receipt.logs || []) {
    const addr = String(log.address).toLowerCase();
    const opEntry =
      chainId === "1"
        ? Object.entries(opDeployments).find(
            ([, d]) => d.bridge.toLowerCase() === addr,
          )
        : opDeployments[chainId] && addr === L2_BRIDGE
          ? ([chainId, opDeployments[chainId]] as const)
          : undefined;
    if (opEntry) {
      let parsed;
      try {
        parsed = opAbi.parseLog(log);
      } catch {
        continue;
      }
      if (!parsed) continue;
      const [l2, deployment] = opEntry;
      const a = parsed.args;
      const initiated = parsed.name.endsWith("Initiated");
      const eth = parsed.name.startsWith("ETH");
      const other = chainId === "1" ? l2 : "1";
      const current = leg(chainId, {
        txHash: receipt.transactionHash,
        address: initiated ? a.from : a.to,
        tokenAddress: eth ? undefined : a.localToken,
        amount: eth ? formatUnits(a.amount, 18) : undefined,
        rawAmount: a.amount.toString(),
        symbol: eth ? "ETH" : undefined,
        blockNumber: Number(receipt.blockNumber),
        receiptVerified: true,
      });
      const remote = leg(other, {
        address: initiated ? a.to : a.from,
        tokenAddress: eth ? undefined : a.remoteToken,
        rawAmount: a.amount.toString(),
        amount: eth ? formatUnits(a.amount, 18) : undefined,
        symbol: eth ? "ETH" : undefined,
      });
      const route: BridgeRoute = {
        id: `official:${chainId}:${receipt.transactionHash}:${log.logIndex}`,
        bridge: `${chainName(l2)} Official`,
        protocol: "official",
        source: initiated ? current : remote,
        destination: initiated ? remote : current,
        status: "observed",
        confidence: "source-only",
        evidence: [
          {
            provider: "Official bridge RPC",
            kind: "event",
            description: `${parsed.name} · 검증된 브릿지 컨트랙트`,
            url: txUrl(chainId, receipt.transactionHash),
            fetchedAt: new Date().toISOString(),
            details: {
              contract: log.address,
              event: parsed.name,
              logIndex: log.logIndex,
              blockNumber: receipt.blockNumber,
            },
          },
        ],
        notes: [
          "현재 체인의 브릿지 이벤트를 확인했습니다. 반대편 거래가 연결되기 전에는 완료로 표시하지 않습니다.",
        ],
      };
      if (chainId === "1" && initiated) {
        const portalLogs = receipt.logs
          .filter(
            (v: any) =>
              v.address.toLowerCase() === deployment.portal.toLowerCase(),
          )
          .map((v: any) => ({
            ...v,
            logIndex: Number(v.logIndex),
            blockNumber: BigInt(v.blockNumber),
          }));
        try {
          const hashes = getL2TransactionHashes({ logs: portalLogs });
          // Multiple deposit messages require decoding message payload associations first.
          const bridgeEvents = receipt.logs.filter((v: any) => {
            if (v.address.toLowerCase() !== addr) return false;
            try {
              return opAbi.parseLog(v)?.name.endsWith("Initiated");
            } catch {
              return false;
            }
          });
          if (hashes.length === 1 && bridgeEvents.length === 1) {
            route.destination.txHash = hashes[0];
            route.destination.explorerUrl = txUrl(l2, hashes[0]);
            route.status = "pending";
            route.evidence.push({
              provider: "OP deposit derivation",
              kind: "event",
              description:
                "공식 Portal TransactionDeposited 이벤트로 L2 트랜잭션 해시를 결정적으로 계산",
              fetchedAt: new Date().toISOString(),
              url: "https://specs.optimism.io/protocol/deposits.html",
              details: { portal: deployment.portal, l2Hash: hashes[0] },
            });
          }
        } catch (e) {
          route.notes.push(`L2 해시 계산 실패: ${errorText(e)}`);
        }
      }
      routes.push(route);
      continue;
    }
    if (arbGateways[chainId]?.some((a) => a.toLowerCase() === addr)) {
      let parsed;
      try {
        parsed = arbAbi.parseLog(log);
      } catch {
        continue;
      }
      if (!parsed) continue;
      const initiated = parsed.name.endsWith("Initiated");
      const a = parsed.args;
      const other = chainId === "1" ? "42161" : "1";
      const current = leg(chainId, {
        txHash: receipt.transactionHash,
        address: initiated ? a._from : a._to,
        tokenAddress: chainId === "1" ? a.l1Token : undefined,
        rawAmount: a._amount.toString(),
        blockNumber: Number(receipt.blockNumber),
        receiptVerified: true,
      });
      const remote = leg(other, {
        address: initiated ? a._to : a._from,
        tokenAddress: other === "1" ? a.l1Token : undefined,
        rawAmount: a._amount.toString(),
      });
      routes.push({
        id: `arbitrum:${receipt.transactionHash}:${log.logIndex}`,
        bridge: "Arbitrum Official",
        protocol: "arbitrum",
        source: initiated ? current : remote,
        destination: initiated ? remote : current,
        status: "observed",
        confidence: "source-only",
        notes: [
          "표준 ERC20 Gateway의 한쪽 이벤트입니다. 반대편 거래 연결은 아직 지원하지 않습니다.",
        ],
        evidence: [
          {
            provider: "Arbitrum Gateway RPC",
            kind: "event",
            description: parsed.name,
            url: txUrl(chainId, receipt.transactionHash),
            fetchedAt: new Date().toISOString(),
            details: {
              contract: log.address,
              event: parsed.name,
              rawAmount: a._amount.toString(),
            },
          },
        ],
      });
    }
  }
  return routes;
}
async function enrichToken(side: Leg) {
  if (
    side.amount ||
    !side.rawAmount ||
    !side.chainId ||
    !getChain(side.chainId) ||
    !/^0x[\da-f]{40}$/i.test(side.tokenAddress || "")
  )
    return;
  const key = `${side.chainId}:${side.tokenAddress}`;
  let meta = tokenCache.get(key);
  if (!meta) {
    const d = await rpc.call(side.chainId, "eth_call", [
      { to: side.tokenAddress, data: tokens.encodeFunctionData("decimals") },
      "latest",
    ]);
    const decimals = Number(
      tokens.decodeFunctionResult("decimals", d.result)[0],
    );
    let symbol: string | undefined;
    try {
      const s = await rpc.call(side.chainId, "eth_call", [
        { to: side.tokenAddress, data: tokens.encodeFunctionData("symbol") },
        "latest",
      ]);
      symbol = tokens.decodeFunctionResult("symbol", s.result)[0];
    } catch {
      /* Amount remains useful without a symbol. */
    }
    meta = { decimals, symbol };
    tokenCache.set(key, meta, 86400_000);
  }
  side.amount = formatUnits(side.rawAmount, meta.decimals);
  side.symbol = meta.symbol;
}
export async function verifyRoutes(
  routes: BridgeRoute[],
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  await mapLimit(routes.slice(0, 8), 3, async (route) => {
    await Promise.all(
      (["source", "destination"] as const).map(async (key) => {
        const side = route[key];
        if (
          !side.chainId ||
          !getChain(side.chainId) ||
          !/^0x[\da-f]{64}$/i.test(side.txHash || "")
        )
          return;
        const start = Date.now();
        const provider = `RPC · ${side.chain}`;
        try {
          const { result, endpoint, checked } = await getReceipt(
            side.chainId,
            side.txHash!,
          );
          if (!result) {
            route.notes.push(
              `${side.chain} receipt를 2개 RPC에서 찾지 못했습니다. 인덱서 결과와 별개로 확인이 필요합니다.`,
            );
            diagnostics.push({
              provider,
              state: "empty",
              durationMs: Date.now() - start,
              count: 0,
              detail: `미발견 · ${checked.join(", ")}`,
            });
            return;
          }
          side.blockNumber = Number(result.blockNumber);
          side.receiptVerified = result.status === "0x1";
          route.evidence.push({
            provider,
            kind: "receipt",
            description: `${key === "source" ? "출발" : "도착"} receipt ${result.status === "0x1" ? "성공" : "실패"} · block ${side.blockNumber}`,
            url: side.explorerUrl,
            fetchedAt: new Date().toISOString(),
            details: {
              endpoint,
              status: result.status,
              blockHash: result.blockHash,
              blockNumber: side.blockNumber,
              transactionHash: result.transactionHash,
            },
          });
          if (result.status === "0x0") {
            route.status = "failed";
            route.notes.push(
              "RPC에서 실패한 거래 영수증이 확인되었습니다. 인덱서 상태와 다르면 증거를 대조하세요.",
            );
          }
          if (
            key === "destination" &&
            route.protocol === "official" &&
            route.status === "pending" &&
            result.status === "0x1"
          ) {
            // OP messenger can catch an inner revert while its transaction receipt succeeds.
            // Require the matching StandardBridge finalization event, not receipt status alone.
            const final = decodeOfficial(side.chainId, result).find(
              (r) =>
                r.destination.txHash &&
                r.source.address?.toLowerCase() ===
                  route.source.address?.toLowerCase() &&
                r.destination.address?.toLowerCase() ===
                  route.destination.address?.toLowerCase() &&
                r.destination.rawAmount === route.source.rawAmount &&
                r.destination.tokenAddress?.toLowerCase() ===
                  route.destination.tokenAddress?.toLowerCase(),
            );
            if (final) {
              route.status = "delivered";
              route.evidence.push(...final.evidence);
              route.notes = [
                "Portal 이벤트에서 계산한 L2 해시와 송수신 주소·수량이 일치하는 StandardBridge Finalized 이벤트를 확인했습니다.",
              ];
            } else {
              route.status = "unknown";
              route.notes.push(
                "L2 영수증은 성공이지만 대응하는 StandardBridge Finalized 이벤트가 없습니다. 내부 메시지 실행 실패 또는 다른 실행 결과를 확인해야 합니다.",
              );
            }
          }
          try {
            await enrichToken(side);
          } catch {
            /* Metadata lookup is optional, raw amounts are preserved. */
          }
          diagnostics.push({
            provider,
            state: "ok",
            durationMs: Date.now() - start,
            count: 1,
            detail: `${endpoint} · block ${side.blockNumber}`,
          });
        } catch (e) {
          diagnostics.push({
            provider,
            state: "error",
            durationMs: Date.now() - start,
            count: 0,
            detail: errorText(e),
          });
        }
      }),
    );
    if (route.source.receiptVerified && route.destination.receiptVerified)
      route.confidence = "onchain";
  });
  return diagnostics;
}
