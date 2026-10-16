import { setTimeout as delay } from "node:timers/promises";
import { errorText, jsonFetch, TTLCache } from "./http";

const genesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const endpoints = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"];
const verified = new Set<string>();
const cooldown = new Map<string, number>();
const cache = new TTLCache<{ result: any; endpoint: string; fetchedAt: string }>(300);
const inflight = new Map<string, Promise<{ result: any; endpoint: string; fetchedAt: string }>>();
let queue: Promise<unknown> = Promise.resolve();
let nextAt = 0;

async function send(url: string, method: string, params: unknown[]) {
  const data = await jsonFetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }, 6000);
  if (data.error) throw new Error(`Solana RPC ${data.error.code}: ${String(data.error.message).slice(0, 120)}`);
  if (!Object.hasOwn(data, "result")) throw new Error("잘못된 Solana RPC 응답");
  return data.result;
}

export function solanaRpc(method: string, params: unknown[]) {
  const key = JSON.stringify([method, params]);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;
  const task = queue.then(async () => {
    const errors: string[] = [];
    for (const endpoint of endpoints) {
      if ((cooldown.get(endpoint) || 0) > Date.now()) continue;
      try {
        await delay(Math.max(0, nextAt - Date.now()));
        if (!verified.has(endpoint)) {
          if (await send(endpoint, "getGenesisHash", []) !== genesis) throw new Error("Solana mainnet 체인 불일치");
          verified.add(endpoint);
        }
        const result = await send(endpoint, method, params);
        nextAt = Date.now() + 250;
        if (result == null) { errors.push(`${new URL(endpoint).host}: 거래 미제공`); continue; }
        const value = { result, endpoint, fetchedAt: new Date().toISOString() };
        cache.set(key, value, method === "getTransaction" ? 300_000 : 30_000);
        return value;
      } catch (error) {
        cooldown.set(endpoint, Date.now() + 30_000);
        errors.push(`${new URL(endpoint).host}: ${errorText(error)}`);
      }
    }
    throw new Error(errors.join(" / ") || "Solana 공개 RPC가 모두 cooldown 중입니다.");
  }).finally(() => inflight.delete(key));
  queue = task.catch(() => undefined);
  inflight.set(key, task);
  return task;
}
