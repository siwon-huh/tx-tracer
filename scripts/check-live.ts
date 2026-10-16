// Opt-in public-network integration checks. Does not create or sign transactions.
import assert from "node:assert/strict";
import { lifi } from "../server/adapters/lifi";
import { debridge } from "../server/adapters/debridge";
import { layerzero } from "../server/adapters/layerzero";
import { wormhole } from "../server/adapters/wormhole";
import { thorchain } from "../server/adapters/thorchain";
import { ccip } from "../server/adapters/ccip";
import type { AdapterInput, AdapterResult } from "../server/adapters/common";
const cases: [
  string,
  (i: AdapterInput) => Promise<AdapterResult>,
  string,
  string,
][] = [
  [
    "LI.FI",
    lifi,
    "0xab28fe3857427db9b5f74a6465d309d3be885003015c6f6d483b162845936f15",
    "0xb568d4796d81f6f03f6e8b143175390c891a20d7372b79959c5e5c0f4ae54f3a",
  ],
  [
    "deBridge",
    debridge,
    "0x3fe11542154f53dcf3134eacb30ea5ca586c9e134c223e56bbe1893862469bc5",
    "0xd41f5e230738d977455154c12351b01c90726cdfebbf681841b044d27df8bf93",
  ],
  [
    "Stargate",
    layerzero,
    "0x9906e0299e7a15bd2293eba36c1313c4a604e14581b2d15ccad6290ef3952346",
    "0x60b675704afb0383bec390f5a6ab287b7c7a0f527f377542f63f93ca637c7f1b",
  ],
  [
    "Wormhole",
    wormhole,
    "0x4ca36773368ce5fc1843edf32e3f753b1daa1dfebe296a0d0916daf32a14619c",
    "5VqK66MGLHpuYbJnhTt5SFQSXdca12SjsbRRdBwG7w2jijMAEzFR2Vs8rKwwGTBDTQuQqURcgPafFAHM6ERKPtaQ",
  ],
  [
    "THORChain",
    thorchain,
    "DFC901019F768208D3059904FD079919E0FBDACA85EC45E33FD453763668C4F6",
    "F50986C5E2FB32422B324C5F37518B6E4BCC69713D0075E37BFB665BFA11E354",
  ],
  [
    "CCIP",
    ccip,
    "0x1632de8f35598f95a28178db9a182cb4c1a3e83df86cd9fc04852770dda0a9b4",
    "0xb1ec0fc886e1695f2cd022b8a548ab41b597b042ba67d668638f9ae1afa6e11d",
  ],
];
let failed = 0;
for (const [name, adapter, query, destination] of cases) {
  const start = Date.now();
  try {
    const result = await adapter({
      query,
      kind: "transaction",
      days: 30,
      limit: 20,
      page: 1,
    });
    const route = result.routes.find(
      (r) => r.destination.txHash === destination,
    );
    assert.ok(route, `${name}: expected destination was not returned`);
    assert.equal(route.status, "delivered");
    console.log(
      `PASS ${name}: ${route.source.chain} → ${route.destination.chain} (${Date.now() - start}ms)`,
    );
  } catch (e) {
    failed++;
    console.error(`FAIL ${name}: ${e instanceof Error ? e.message : e}`);
  }
}
if (failed) process.exitCode = 1;
