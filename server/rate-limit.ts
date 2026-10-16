import { createHash } from "node:crypto";

export type RateDecision = { allowed: boolean; retryAfter: number };
export type RateLimiter = (ip: string) => Promise<RateDecision>;
const windowMs = 60_000;
const limit = 15;
const script = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('PTTL', KEYS[1])}
`;

// Redis is optional. Without it this is an instance-local guard, not a
// deployment-wide limit. Redis keys contain a hash instead of the raw IP.
export function createRateLimiter(env: NodeJS.ProcessEnv = process.env): RateLimiter {
  const entries = new Map<string, { count: number; until: number }>();
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  return async ip => {
    const key = createHash("sha256").update(ip).digest("hex");
    if (url || token) {
      if (!url || !token || new URL(url).protocol !== "https:") throw new Error("Incomplete rate limit configuration");
      const response = await fetch(url, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(3000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(["EVAL", script, "1", `tx-tracer:${env.VERCEL_ENV || "local"}:rate:${key}`, String(windowMs)]),
      });
      if (!response.ok) throw new Error("Rate limit store unavailable");
      const data = await response.json() as { result?: [number, number]; error?: string };
      if (data.error || !Array.isArray(data.result) || data.result.length !== 2 || !data.result.every(Number.isFinite))
        throw new Error("Invalid rate limit response");
      return { allowed: data.result[0] <= limit, retryAfter: Math.max(1, Math.ceil(data.result[1] / 1000)) };
    }
    const now = Date.now();
    if (entries.size > 1000) for (const [k, v] of entries) if (v.until <= now) entries.delete(k);
    let entry = entries.get(key);
    if (!entry || entry.until <= now) {
      if (entries.size >= 10_000) return { allowed: false, retryAfter: 60 };
      entry = { count: 0, until: now + windowMs };
      entries.set(key, entry);
    }
    return { allowed: ++entry.count <= limit, retryAfter: Math.max(1, Math.ceil((entry.until - now) / 1000)) };
  };
}
