/**
 * Register a contract, create its KV maps, and seed its policy and secret.
 *
 *   npx tsx --env-file=.env scripts/deploy.ts eligibility
 *
 * Goes straight at the node's control plane rather than through the SDK's
 * TenantClient helpers, which this testnet's node rejects (BUGS.md BUG-09..12).
 */
import { readFile } from "node:fs/promises";
import { controlClient, describeError } from "./control.js";

type Target = {
  tail: string;
  version: string;
  wasm: string;
  maps: string[];
  secrets: Array<[string, string]>;
};

const TARGETS: Record<string, Target> = {
  eligibility: {
    tail: "eligibility",
    version: process.env.CONTRACT_VERSION ?? "0.1.0",
    wasm: "z-tenant-eligibility/target/wasm32-wasip2/release/z_tenant_eligibility.wasm",
    maps: ["secrets", "policies", "attestations"],
    secrets: [["verifier_api_key", "VERIFIER_API_KEY"]],
  },
  flight: {
    tail: "travel-contracts",
    version: process.env.CONTRACT_VERSION ?? "0.1.0",
    wasm: "z-tenant-flight/target/wasm32-wasip2/release/z_tenant_flight.wasm",
    maps: ["secrets"],
    secrets: [["duffel_api_key", "DUFFEL_API_KEY"]],
  },
};

const name = process.argv[2] ?? "eligibility";
const target = TARGETS[name];
if (!target) {
  throw new Error(`unknown target '${name}' — expected one of ${Object.keys(TARGETS).join(", ")}`);
}

const c = await controlClient();
console.log(`tenant: ${c.did}`);

// ---- 0. Confirm the tenant is admitted and see the quotas -----------------
const me = await c.exec<any>("tenant-me", {});
console.log(`status: ${me.status}  label: ${me.label}`);
console.log(
  `quotas: max_contracts=${me.quotas?.max_contracts} max_maps=${me.quotas?.max_maps} max_wasm_bytes=${me.quotas?.max_wasm_bytes}`,
);

// ---- 1. Register the component (multipart blob, not a JSON field) ---------
const wasm = await readFile(new URL(`../${target.wasm}`, import.meta.url));
if (me.quotas?.max_wasm_bytes && wasm.length > me.quotas.max_wasm_bytes) {
  throw new Error(`wasm is ${wasm.length} bytes, over the ${me.quotas.max_wasm_bytes} cap`);
}

const contractName = c.canonical(target.tail);
console.log(`\nregistering ${contractName} (${(wasm.length / 1024).toFixed(0)} KiB)`);

const registered = await c.execWithBlob(
  "contract-register",
  { name: contractName, version: target.version },
  new Blob([wasm], { type: "application/wasm" }),
);
const parsed = typeof registered === "string" ? JSON.parse(registered) : registered;
const contractId: number = parsed.contract_id ?? parsed?.result?.contract_id;
console.log(`registered as contract id ${contractId}`);

// ---- 2. Create the KV maps, then re-point their ACLs ----------------------
// readers must be set explicitly — the kv-governor defaults to deny, so
// omitting it makes the contract's own read fail with AccessDenied.
//
// Every `contract-register` mints a NEW contract_id, even for the same name
// and a bumped version. Map ACLs are keyed by contract_id, so a redeploy
// silently orphans every map the previous id could read:
//
//   access denied: TenantContract(did:t3n:f39cbc…/714) cannot read map
//   "z:f39cbc…:attestations"
//
// So `map-update` has to run on every deploy, not just the first. See
// BUGS.md BUG-15.
console.log();
for (const tail of target.maps) {
  const map_name = c.canonical(tail);
  const acl = {
    writers: { only: [contractId] },
    readers: { only: [contractId] },
  };

  await c.idempotent(map_name, () =>
    c.exec("map-create", { map_name, visibility: "private", ...acl }),
  );
  // Idempotent create is a no-op on redeploy, so the ACL is stale by default.
  await c.exec("map-update", { map_name, ...acl });
  console.log(`  map ${map_name} -> readers/writers = [${contractId}]`);
}

// ---- 3. Seed secrets ------------------------------------------------------
// map-entry-set is a control-plane write, so it bypasses the writers ACL.
console.log();
for (const [key, envVar] of target.secrets) {
  const value = process.env[envVar];
  if (!value) {
    console.log(`  skipping secret '${key}' — ${envVar} not set`);
    continue;
  }
  await c.exec("map-entry-set", { map_name: c.canonical("secrets"), key, value });
  console.log(`  sealed '${key}' into ${c.canonical("secrets")}`);
}

// ---- 4. Seed the demo policy ---------------------------------------------
if (name === "eligibility") {
  const policy = {
    min_age: 18,
    allowed_countries: ["NG", "GB", "US", "DE"],
    ttl_secs: 2_592_000, // 30 days
    verifier_url: process.env.VERIFIER_URL ?? "https://verifier.example.com/v1/eligibility",
  };
  await c.exec("map-entry-set", {
    map_name: c.canonical("policies"),
    key: "adult-eu",
    value: JSON.stringify(policy),
  });
  console.log(`  seeded policy 'adult-eu' (verifier: ${policy.verifier_url})`);
}

console.log(`\ndone. script_name = ${contractName} @ ${target.version}, contract_id = ${contractId}`);
