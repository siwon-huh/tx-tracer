import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export const SEARCH_TIMEOUT_MS = 240_000;
export const SEARCH_TIMEOUT_MESSAGE = "조회 시간이 초과되었습니다. 확인한 결과만 표시합니다. 기간을 좁혀 다시 조회하세요.";
export class SearchTimeoutError extends Error {
  constructor() { super(SEARCH_TIMEOUT_MESSAGE); this.name = "SearchTimeoutError"; }
}
type Context = { id: string; deadline: number; signal: AbortSignal };
const context = new AsyncLocalStorage<Context>();

export async function withSearchBudget<T>(task: () => Promise<T>, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? SEARCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new SearchTimeoutError()), timeoutMs);
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  try {
    return await context.run({ id: randomUUID(), deadline: Date.now() + timeoutMs, signal }, task);
  } finally { clearTimeout(timer); }
}
export const searchSignal = () => context.getStore()?.signal;
export const searchDeadline = () => context.getStore()?.deadline ?? Infinity;
export const searchExpired = () => !!searchSignal()?.aborted || Date.now() >= searchDeadline();
export function checkSearchBudget() {
  if (searchExpired()) throw searchSignal()?.reason ?? new SearchTimeoutError();
}
// Sharing a pending request across searches would couple their abort signals.
// Completed caches can still be reused across all invocations in this instance.
export const inflightKey = (key: string) => context.getStore() ? `${context.getStore()!.id}:${key}` : key;
export function waitForSearch<T>(task: Promise<T>): Promise<T> {
  const signal = searchSignal();
  if (!signal) return task;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new SearchTimeoutError());
    signal.addEventListener("abort", abort, { once: true });
    // Always handle the task, even if already aborted, to avoid an unhandled rejection.
    task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}
export async function searchDelay(ms: number) {
  checkSearchBudget();
  await delay(ms, undefined, { signal: searchSignal() });
  checkSearchBudget();
}
