import test from "node:test";
import assert from "node:assert/strict";
import { requestJson } from "../src/api";

test("connection failure gives public-facing recovery guidance", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(requestJson("/api/trace"), /서비스에 연결할 수 없습니다.*인터넷 연결/);
});

test("cancelling a search stays a cancellation", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new DOMException("Cancelled", "AbortError");
  });
  await assert.rejects(requestJson("/api/trace"), { name: "AbortError" });
});

test("server validation errors and malformed responses remain distinct", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ error: "검색 옵션 형식이 올바르지 않습니다." }), { status: 400 }),
  );
  await assert.rejects(requestJson("/api/trace"), /검색 옵션 형식/);
  fetchMock.mock.mockImplementation(async () => new Response("Unavailable", { status: 503 }));
  await assert.rejects(requestJson("/api/trace"), /올바른 응답.*HTTP 503/);
});
