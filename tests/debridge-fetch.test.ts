import test from "node:test";
import assert from "node:assert/strict";
import { debridge } from "../server/adapters/debridge";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const input = { kind: "transaction" as const, query: `0x${"a".repeat(64)}`, days: 30, limit: 25, page: 1 };

test("deBridge shares concurrent order details and retains the original evidence timestamp", async t => {
  let details = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith("/liteModels")) return response([{ orderId: "shared-order" }]);
    details++;
    return response({ orderId: "shared-order", state: "Fulfilled" });
  });
  const [a, b] = await Promise.all([
    debridge(input), debridge({ ...input, query: `0x${"b".repeat(64)}` }),
  ]);
  assert.equal(details, 1);
  assert.equal(a.routes.length, 1);
  assert.equal(b.routes.length, 1);
  assert.equal(a.routes[0].evidence[0].fetchedAt, b.routes[0].evidence[0].fetchedAt);
  const cached = await debridge(input);
  assert.equal(details, 1);
  assert.equal(cached.routes[0].evidence[0].fetchedAt, a.routes[0].evidence[0].fetchedAt);
});

test("deBridge marks partial detail failures rather than reporting complete success", async t => {
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith("/liteModels")) return response([{ orderId: "good-order" }, { orderId: "bad-order" }]);
    if (url.endsWith("/bad-order")) return response({}, 503);
    return response({ orderId: "good-order", state: "Fulfilled" });
  });
  const data = await debridge(input);
  assert.equal(data.routes.length, 1);
  assert.equal(data.partial, true);
  assert.match(data.detail, /상세 1건 조회 실패/);
});

test("address time window skips out-of-range order details and stops old pages", async t => {
  const urls: string[] = [];
  const startTime = "2026-10-16T12:30:00.000Z", endTime = "2026-10-16T12:35:00.000Z";
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    return response({ orders: [
      { orderId: "too-new", creationTimestamp: Date.parse(endTime) / 1000 + 1 },
      { orderId: "too-old", creationTimestamp: Date.parse(startTime) / 1000 - 1 },
    ], totalCount: 1000 });
  });
  const out = await debridge({ ...input, kind: "address", query: `0x${"a".repeat(40)}`, limit: 2, startTime, endTime });
  assert.equal(urls.length, 1);
  assert.equal(out.routes.length, 0);
  assert.equal(out.hasMore, false);
});
