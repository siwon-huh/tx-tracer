import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { once } from "node:events";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Run with Node 22 after `vercel build --standalone`. Importing the actual
// emitted JavaScript catches ESM/JSON resolution failures that tsc cannot.
const output = resolve(process.argv[2] || ".vercel/output");
const routing = JSON.parse(await readFile(resolve(output, "config.json"), "utf8"));
const apiRewrite = routing.routes.find(route => route.dest?.split("?")[0] === "/api/index");
assert.ok(apiRewrite, "API requests must route to the emitted function");
for (const route of ["/api/config", "/api/trace", "/api/investigate", "/api/not-found"])
  assert.ok(new RegExp(apiRewrite.src).test(route), `Missing API route: ${route}`);
assert.equal(new RegExp(apiRewrite.src).test("/assets/app.js"), false);
const functionDir = resolve(output, "functions/api/index.func");
const manifest = JSON.parse(await readFile(resolve(functionDir, ".vc-config.json"), "utf8"));
assert.equal(manifest.runtime, "nodejs22.x");
assert.equal(manifest.maxDuration, 300);
assert.equal(manifest.supportsCancellation, true);
await access(resolve(output, "static/tx-tracer-logo.jpg"));
const html = await readFile(resolve(output, "static/index.html"), "utf8");
assert.ok(html.includes("https://x.com/c4lvin"));
const { default: app } = await import(pathToFileURL(resolve(functionDir, manifest.handler)).href);
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");
  const missing = await fetch(`${origin}/api/not-found`);
  assert.equal(missing.status, 404);
  assert.ok((await missing.json()).error);
  const invalid = await fetch(`${origin}/api/trace`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: "{}",
  });
  assert.equal(invalid.status, 400);
  assert.ok((await invalid.json()).error);
  console.log("Vercel bundle: Node 22 import, snapshots, API JSON responses, logo and contact comment passed.");
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
