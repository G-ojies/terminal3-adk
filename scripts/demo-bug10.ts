/**
 * Reproduce BUG-10 live: the documented `await tenant.me()` does not exist.
 *
 *   npx tsx --env-file=.env scripts/demo-bug10.ts
 *
 * This is the failure reported as the top unanswered comment on the bounty
 * listing. It runs the Set Up Development Environment snippet exactly as
 * published, then shows where `me()` actually lives.
 */
import {
  T3nClient,
  TenantClient,
  setEnvironment,
  getEnvironment,
  loadWasmComponent,
  eth_get_address,
  metamask_sign,
  createEthAuthInput,
  fetchTrustedManifest,
  getNodeUrl,
} from "@terminal3/t3n-sdk";

setEnvironment("testnet");

const apiKey = process.env.T3N_API_KEY!;
const wasmComponent = await loadWasmComponent();
const address = eth_get_address(apiKey);

// NOTE: `trustAnchor` is not in the published snippet either — that is BUG-09.
// Supplied here so we get far enough to demonstrate BUG-10.
const t3n = new T3nClient({
  wasmComponent,
  trustAnchor: await fetchTrustedManifest(getEnvironment()),
  handlers: { EthSign: metamask_sign(address, undefined, apiKey) },
});

await t3n.handshake();
const did = await t3n.authenticate(createEthAuthInput(address));
const tenantDid = did.value;
console.log("Connected as:", tenantDid);

const tenant = new TenantClient({ t3n, baseUrl: getNodeUrl(), tenantDid });

console.log("\n--- the documented call, verbatim from the docs ---");
console.log("    await tenant.me();\n");
try {
  // @ts-expect-error - documented, but not a real method. That is the bug.
  await tenant.me();
  console.log("unexpectedly succeeded");
} catch (err) {
  console.log("  " + (err instanceof Error ? `${err.name}: ${err.message}` : String(err)));
}

console.log("\n--- where me() actually lives ---");
console.log("    TenantClient.prototype.me   :", typeof (TenantClient.prototype as any).me);
console.log("    tenant.tenant.me            :", typeof tenant.tenant.me);
console.log("\n    the working call is: await tenant.tenant.me()");
console.log("    ...which then fails with BUG-11 (SDK sends contract_id, node wants script_name)");
