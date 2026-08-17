/**
 * Smoke test: prove the registered contract actually executes inside the
 * enclave, without needing the external verifier.
 *
 * `verify-attestation` makes no outbound call, so it runs without an egress
 * grant and without the verifier being deployed. A lookup for an attestation
 * that was never issued should come back { valid: false, reason_code: "not_found" },
 * which is the contract's own Rust returning a value — proof the WASM ran.
 *
 * Also exercises the input-validation paths, which are pure guest-side logic.
 */
import { getContractVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { connect, requireEnv, tidOf } from "./session.js";

const baseUrl = getNodeUrl();
const { t3n, did } = await connect(requireEnv("T3N_API_KEY"));
const script = `z:${tidOf(did)}:eligibility`;
const version = await getContractVersion(baseUrl, script);
console.log(`invoking ${script} @ ${version}\n`);

async function call(label: string, fn: string, input: unknown) {
  try {
    const out = await t3n.executeAndDecode({
      script_name: script,
      script_version: version,
      function_name: fn,
      input,
    });
    console.log(`${label}\n  -> ${JSON.stringify(out)}\n`);
  } catch (err: any) {
    console.log(
      `${label}\n  -> [${err?.httpStatus ?? "?"}] ${err?.detail ?? err?.message ?? String(err)}${err?.requestId ? ` (req ${err.requestId})` : ""}\n`,
    );
  }
}

// Runs entirely in-guest: KV read, miss, structured response. No egress.
await call("verify-attestation (never issued)", "verify-attestation", {
  policy_id: "adult-eu",
  subject: "aabbccdd",
  digest: "00".repeat(32),
});

// Guest-side validation paths — these must be rejected by our Rust, not the host.
await call("verify-attestation (non-hex subject)", "verify-attestation", {
  policy_id: "adult-eu",
  subject: "not-hex!",
  digest: "00".repeat(32),
});

await call("check-eligibility (inline PII must be refused)", "check-eligibility", {
  policy_id: "adult-eu",
  date_of_birth: "1990-01-01",
});

await call("check-eligibility (policy id with separator)", "check-eligibility", {
  policy_id: "adult|eu",
});

// This one needs the verifier + egress grant; expected to fail until deployed.
await call("check-eligibility (real, needs verifier)", "check-eligibility", {
  policy_id: "adult-eu",
});
