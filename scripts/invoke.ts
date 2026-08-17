/**
 * Grant egress as the data owner, then exercise the contract end to end.
 *
 *   npx tsx --env-file=.env scripts/invoke.ts
 *
 * The walkthrough builds three separate sessions (tenant / user / agent). The
 * claim page issues one credential (BUGS.md BUG-08), so this uses the
 * documented direct-call form: the user self-grants to their own DID.
 *
 * Uses `getContractVersion`, not the documented `getScriptVersion`, which does
 * not exist (BUG-03).
 */
import { getContractVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { connect, requireEnv, tidOf } from "./session.js";

const POLICY_ID = process.env.POLICY_ID ?? "adult-eu";
const baseUrl = getNodeUrl();

const { t3n, did } = await connect(requireEnv("T3N_API_KEY"));
const SCRIPT = `z:${tidOf(did)}:eligibility`;
const scriptVersion = await getContractVersion(baseUrl, SCRIPT);
const verifierHost = new URL(requireEnv("VERIFIER_URL")).host;

console.log(`did:      ${did}`);
console.log(`contract: ${SCRIPT} @ ${scriptVersion}`);
console.log(`verifier: ${verifierHost}\n`);

async function call(label: string, fn: string, input: unknown) {
  try {
    const out = await t3n.executeAndDecode({
      script_name: SCRIPT,
      script_version: scriptVersion,
      function_name: fn,
      input,
    });
    console.log(`${label}\n  -> ${JSON.stringify(out)}\n`);
    return out as any;
  } catch (err: any) {
    console.log(
      `${label}\n  -> [${err?.httpStatus ?? "?"}] ${err?.detail ?? err?.message ?? String(err)}${err?.requestId ? ` (req ${err.requestId})` : ""}\n`,
    );
    return undefined;
  }
}

// ---- 1. The data owner authorizes the contract's egress -------------------
// Outbound HTTP is authorized per-call from the user's grant, not from the
// contract. Without a matching grant the contract runs but the call is denied.
const userContractVersion = await getContractVersion(baseUrl, "tee:user/contracts");
try {
  await t3n.executeAndDecode({
    script_name: "tee:user/contracts",
    script_version: userContractVersion,
    function_name: "agent-auth-update",
    input: {
      agents: [
        {
          agentDid: did, // self-grant: the documented direct-call form
          scripts: [
            {
              scriptName: SCRIPT,
              versionReq: scriptVersion,
              functions: ["check-eligibility", "verify-attestation"],
              allowedHosts: [verifierHost],
            },
          ],
        },
      ],
    },
  });
  console.log(`granted ${did}\n  -> ${SCRIPT} (hosts: ${verifierHost})\n`);
} catch (err: any) {
  console.log(`grant failed: [${err?.httpStatus}] ${err?.detail ?? err?.message} (req ${err?.requestId})\n`);
}

// ---- 2. First check — issues a fresh attestation --------------------------
const first = await call("check-eligibility (first call)", "check-eligibility", {
  policy_id: POLICY_ID,
});

// ---- 3. Second check — should reuse, making no outbound call --------------
const second = await call(
  "check-eligibility (second call, expect reused=true)",
  "check-eligibility",
  { policy_id: POLICY_ID },
);

// ---- 4. Verify the attestation -------------------------------------------
if (first?.subject && first?.digest) {
  await call("verify-attestation (genuine)", "verify-attestation", {
    policy_id: POLICY_ID,
    subject: first.subject,
    digest: first.digest,
  });

  // ---- 5. Negative case: a tampered digest must not verify ---------------
  const tampered = first.digest.replace(/.$/, (c: string) => (c === "0" ? "1" : "0"));
  await call("verify-attestation (tampered digest, expect valid=false)", "verify-attestation", {
    policy_id: POLICY_ID,
    subject: first.subject,
    digest: tampered,
  });
}

if (first && second) {
  console.log(
    `reuse check: first.reused=${first.reused}  second.reused=${second.reused}` +
      (second.reused === true ? "  <- second call made no outbound request" : ""),
  );
}
