import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getChain } from "./chains";
import { errorText, jsonFetch, TTLCache } from "./http";

type Health = {
  failures: number;
  cooldownUntil: number;
  latencyMs?: number;
  lastError?: string;
  lastSuccess?: string;
  chainVerified?: boolean;
  chainId?: string;
};
type Transport = (
  url: string,
  method: string,
  params: unknown[],
) => Promise<any>;
const dnsCache = new TTLCache<boolean>(500);
function privateIp(ip: string) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  return ip === "::1" || ip === "::" || /^(fc|fd|fe[89ab]|::ffff:)/i.test(ip);
}
async function transport(url: string, method: string, params: unknown[]) {
  const host = new URL(url).hostname;
  if (!dnsCache.get(host)) {
    const records = await lookup(host, { all: true });
    if (!records.length || records.some((r) => privateIp(r.address)))
      throw new Error("비공개 네트워크 RPC는 허용되지 않음");
    dnsCache.set(host, true, 3600_000);
  }
  const data = await jsonFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    },
    4500,
  );
  if (data.error)
    throw new Error(
      `RPC ${data.error.code}: ${String(data.error.message).slice(0, 140)}`,
    );
  if (!Object.hasOwn(data, "result")) throw new Error("잘못된 RPC 응답");
  return data.result;
}
export class RpcPool {
  readonly health = new Map<string, Health>();
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private send: Transport = transport) {}
  private async limited<T>(fn: () => Promise<T>) {
    if (this.active >= 6) await new Promise<void>((r) => this.waiting.push(r));
    else this.active++;
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
  async call(
    chainId: string | number,
    method: string,
    params: unknown[],
    options: { nullQuorum?: number; endpoints?: string[] } = {},
  ): Promise<{ result: any; endpoint: string; checked: string[] }> {
    const urls = options.endpoints ?? getChain(chainId)?.rpcs ?? [];
    const sorted = [...urls]
      .sort((a, b) => {
        const x = this.health.get(a),
          y = this.health.get(b);
        return (
          Number((x?.cooldownUntil || 0) > Date.now()) -
            Number((y?.cooldownUntil || 0) > Date.now()) ||
          (x?.failures || 0) - (y?.failures || 0) ||
          (x?.latencyMs ?? 1000) - (y?.latencyMs ?? 1000)
        );
      })
      .filter((u) => (this.health.get(u)?.cooldownUntil || 0) <= Date.now())
      .slice(0, 4);
    let nulls = 0;
    const checked: string[] = [];
    const errors: string[] = [];
    for (const url of sorted) {
      const state = this.health.get(url) ?? { failures: 0, cooldownUntil: 0 };
      this.health.set(url, state);
      const started = Date.now();
      try {
        const result = await this.limited(async () => {
          if (!state.chainVerified || state.chainId !== String(chainId)) {
            const actual = await this.send(url, "eth_chainId", []);
            if (BigInt(actual) !== BigInt(chainId))
              throw new Error(`RPC 체인 불일치 (expected ${chainId})`);
            state.chainVerified = true;
            state.chainId = String(chainId);
          }
          return this.send(url, method, params);
        });
        state.failures = 0;
        state.cooldownUntil = 0;
        state.latencyMs = Date.now() - started;
        state.lastSuccess = new Date().toISOString();
        state.lastError = undefined;
        checked.push(new URL(url).hostname);
        if (result != null || ++nulls >= (options.nullQuorum ?? 1))
          return { result, endpoint: new URL(url).hostname, checked };
      } catch (e) {
        state.failures++;
        state.lastError = errorText(e);
        state.cooldownUntil =
          Date.now() + Math.min(300_000, 15_000 * 2 ** state.failures);
        errors.push(`${new URL(url).hostname}: ${errorText(e)}`);
      }
    }
    // One negative answer is insufficient when corroboration was requested.
    throw new Error(
      errors.length
        ? errors.join(" / ")
        : nulls
          ? "다른 RPC에서 미발견 응답을 교차 확인하지 못함"
          : "사용 가능한 RPC 없음 (cooldown 또는 미지원 체인)",
    );
  }
  stats() {
    return [...this.health].map(([url, h]) => ({
      host: new URL(url).hostname,
      ...h,
    }));
  }
}
export const rpc = new RpcPool();
