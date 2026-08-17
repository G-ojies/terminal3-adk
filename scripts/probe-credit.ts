/**
 * What still works now the tenant's credit balance is zero?
 *
 * Distinguishes calls that only need auth (handshake, version lookup) from
 * those that execute a contract and are therefore metered.
 */
import { getContractVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { connect, requireEnv, tidOf } from "./session.js";

const { t3n, did } = await connect(requireEnv("T3N_API_KEY"));
const base = getNodeUrl();
console.log(`did: ${did}\n`);

async function probe(label: string, script: string, fn: string, input: unknown) {
  try {
    const v = await getContractVersion(base, script);
    const out = await t3n.executeAndDecode({
      script_name: script,
      script_version: v,
      function_name: fn,
      input,
    });
    console.log(`${label.padEnd(20)} OK   ${JSON.stringify(out).slice(0, 110)}`);
  } catch (e: any) {
    const d = String(e?.detail ?? e?.message ?? e);
    console.log(`${label.padEnd(20)} [${e?.httpStatus ?? "?"}] ${d.slice(0, 110)}`);
  }
}

// Auth + version lookup alone (no contract execution).
try {
  const v = await getContractVersion(base, "tee:tenant/contracts");
  console.log(`${"version lookup".padEnd(20)} OK   tee:tenant/contracts @ ${v}`);
} catch (e: any) {
  console.log(`${"version lookup".padEnd(20)} FAIL ${String(e?.message).slice(0, 90)}`);
}

await probe("tenant-me", "tee:tenant/contracts", "tenant-me", {});
await probe("verify-attestation", `z:${tidOf(did)}:eligibility`, "verify-attestation", {
  policy_id: "adult-eu",
  subject: "aabbccdd",
  digest: "00".repeat(32),
});
await probe("check-eligibility", `z:${tidOf(did)}:eligibility`, "check-eligibility", {
  policy_id: "adult-eu",
});
