/**
 * Test the contract through a real, separate AGENT identity.
 *
 *   npx tsx --env-file=.env scripts/agent-test.ts
 *
 * Everything up to now used the documented self-call fallback: one credential
 * acting as tenant, data owner and caller at once. This exercises the
 * three-principal model the walkthrough actually describes:
 *
 *   tenant (T3N_API_KEY)  owns and deployed the contract
 *   user   (T3N_API_KEY)  the data owner whose profile placeholders resolve against
 *   agent  (AGENT_KEY)    a distinct DID calling on the user's behalf
 *
 * Two things are genuinely unknown and worth measuring rather than assuming:
 *
 *  1. Whether a self-generated agent DID can transact at all. Common errors
 *     says "Agent identities need separate funding; contact devrel@terminal3.io",
 *     which suggests it may fail on credits (BUG-08).
 *
 *  2. What `calling-user-did()` returns during a delegated call. The WIT says
 *     "the authenticated session DID". If that is the AGENT's DID while the
 *     host resolves the USER's profile for placeholders, then my contract would
 *     attribute the user's eligibility to the agent's DID — a real correctness
 *     problem in my own design, not a platform bug.
 */
import { getContractVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { connect, requireEnv, tidOf } from "./session.js";

const POLICY_ID = process.env.POLICY_ID ?? "agent-test";
const baseUrl = getNodeUrl();
const verifierUrl = requireEnv("VERIFIER_URL");
const verifierHost = new URL(verifierUrl).host;

// ---- the three principals -------------------------------------------------
const { t3n: userClient, did: userDid } = await connect(requireEnv("T3N_API_KEY"));
const { t3n: agentClient, did: agentDid } = await connect(requireEnv("AGENT_KEY"));

const SCRIPT = `z:${tidOf(userDid)}:eligibility`;
const scriptVersion = await getContractVersion(baseUrl, SCRIPT);

console.log(`tenant/user : ${userDid}`);
console.log(`agent       : ${agentDid}`);
console.log(`same DID?   : ${userDid === agentDid ? "YES (not a real test)" : "no — genuinely distinct"}`);
console.log(`contract    : ${SCRIPT} @ ${scriptVersion}\n`);

function report(label: string, err: any) {
  console.log(
    `${label}\n  -> [${err?.httpStatus ?? "?"}] ${err?.detail ?? err?.message ?? String(err)}${
      err?.requestId ? ` (req ${err.requestId})` : ""
    }\n`,
  );
}

// ---- 1. Can the agent identity transact at all? ---------------------------
// Cheapest possible probe: read the user contract's version-gated surface.
console.log("--- 1. can the agent DID execute anything? ---");
const userContractVersion = await getContractVersion(baseUrl, "tee:user/contracts");
try {
  const out = await agentClient.executeAndDecode({
    script_name: "tee:user/contracts",
    script_version: userContractVersion,
    function_name: "user-upsert",
    input: {},
  });
  console.log(`  agent can transact -> ${JSON.stringify(out)}\n`);
} catch (err: any) {
  report("  agent transaction FAILED", err);
}

// ---- 2. Seed a fresh policy so the evaluation is genuine -------------------
const { controlClient } = await import("./control.js");
const c = await controlClient();
await c.exec("map-entry-set", {
  map_name: c.canonical("policies"),
  key: POLICY_ID,
  value: JSON.stringify({
    min_age: 18,
    allowed_countries: ["NG", "GB", "US", "DE"],
    ttl_secs: 2_592_000,
    verifier_url: verifierUrl,
  }),
});
console.log(`--- 2. seeded policy '${POLICY_ID}' ---\n`);

// ---- 3. The USER delegates to the AGENT -----------------------------------
// Signed by the data owner, naming the agent's DID — not a self-grant.
console.log("--- 3. user grants the agent access ---");
try {
  await userClient.executeAndDecode({
    script_name: "tee:user/contracts",
    script_version: userContractVersion,
    function_name: "agent-auth-update",
    input: {
      agents: [
        {
          agentDid,
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
  console.log(`  granted ${agentDid}\n    -> ${SCRIPT} (hosts: ${verifierHost})\n`);
} catch (err: any) {
  report("  grant FAILED", err);
}

// ---- 4. The AGENT invokes the contract ------------------------------------
console.log("--- 4. agent invokes check-eligibility ---");
let attestation: any;
try {
  attestation = await agentClient.executeAndDecode({
    script_name: SCRIPT,
    script_version: scriptVersion,
    function_name: "check-eligibility",
    input: { policy_id: POLICY_ID },
  });
  console.log(`  -> ${JSON.stringify(attestation)}\n`);
} catch (err: any) {
  report("  agent invoke FAILED", err);
}

// ---- 5. Whose DID is the attestation actually about? ----------------------
if (attestation?.subject) {
  const userTid = tidOf(userDid);
  const agentTid = tidOf(agentDid);
  console.log("--- 5. who is the attestation about? ---");
  console.log(`  attestation subject : ${attestation.subject}`);
  console.log(`  user tid            : ${userTid}`);
  console.log(`  agent tid           : ${agentTid}`);

  if (attestation.subject === userTid) {
    console.log(
      "\n  subject = USER. calling-user-did() resolves to the data owner on a\n" +
        "  delegated call, so the attestation is correctly about whose PII was read.",
    );
  } else if (attestation.subject === agentTid) {
    console.log(
      "\n  subject = AGENT. calling-user-did() returns the agent, while the host\n" +
        "  resolved the USER's profile for the placeholders. The attestation is\n" +
        "  therefore attributed to the wrong DID — a correctness bug in this\n" +
        "  contract's design, not the platform's.",
    );
  } else {
    console.log("\n  subject matches neither DID — unexpected, worth investigating.");
  }
}
