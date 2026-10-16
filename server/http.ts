import { checkSearchBudget, searchSignal, waitForSearch } from "./search-context.js";

export class UpstreamError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function jsonFetch<T = any>(
  url: string,
  options: RequestInit = {},
  timeout = 10_000,
): Promise<T> {
  checkSearchBudget();
  const signals = [AbortSignal.timeout(timeout), options.signal, searchSignal()].filter((s): s is AbortSignal => !!s);
  const response = await waitForSearch(fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.any(signals),
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; TxTracer/0.1)",
      ...options.headers,
    },
  }));
  if (!response.ok)
    throw new UpstreamError(
      response.status,
      `HTTP ${response.status} · ${new URL(url).hostname}`,
    );
  const type = response.headers.get("content-type") || "";
  if (!type.includes("json"))
    throw new Error(`JSON 응답이 아님 · ${new URL(url).hostname}`);
  return waitForSearch(response.json()) as Promise<T>;
}
export async function mapLimit<T, R>(
  values: T[],
  limit: number,
  fn: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (cursor < values.length) {
        const i = cursor++;
        results[i] = await fn(values[i], i);
      }
    }),
  );
  return results;
}
export class TTLCache<T> {
  private entries = new Map<string, { value: T; until: number }>();
  constructor(private limit = 200) {}
  get(key: string): T | undefined {
    const item = this.entries.get(key);
    if (!item || item.until < Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return item.value;
  }
  set(key: string, value: T, ttl: number) {
    if (this.entries.size >= this.limit)
      this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, until: Date.now() + ttl });
  }
}
export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "알 수 없는 오류";
