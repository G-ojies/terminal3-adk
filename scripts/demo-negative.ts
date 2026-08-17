/**
 * Prove the host really is substituting the user's actual profile values.
 *
 *   npx tsx --env-file=.env scripts/demo-negative.ts
 *
 * The positive case alone is suggestive but not conclusive — a verifier that
 * ignored its input would also return "eligible". So this seeds a second
 * policy whose allowed_countries EXCLUDES the profile's residence_country and
 * checks that the verdict flips to country_not_permitted.
 *
 * If the marker were reaching the verifier unresolved, the response would be
 * `profile_incomplete` instead (the verifier treats a literal `{{` as an
 * unresolved placeholder). So the three outcomes are distinguishable:
 *
 *   ok                     -> resolved, and the country is permitted
 *   country_not_permitted  -> resolved, and the real value was evaluated
 *   profile_incomplete     -> NOT resolved
 */
import { getContractVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { controlClient } from "./control.js";
import { requireEnv } from "./session.js";

const POLICY_ID = "eu-only";
const c = await controlClient();
const SCRIPT = c.canonical("eligibility");
const scriptVersion = await getContractVersion(c.baseUrl, SCRIPT);
const verifierUrl = requireEnv("VERIFIER_URL");
const verifierHost = new URL(verifierUrl).host;

// A policy that deliberately excludes NG, the profile's residence_country.
const policy = {
  min_age: 18,
  allowed_countries: ["DE", "FR"],
  ttl_secs: 2_592_000,
  verifier_url: verifierUrl,
};
await c.exec("map-entry-set", {
  map_name: c.canonical("policies"),
  key: POLICY_ID,
  value: JSON.stringify(policy),
});
console.log(`seeded policy '${POLICY_ID}' allowing ${policy.allowed_countries.join(", ")} (profile is NG)\n`);

// Extend the existing grant to cover this policy's calls.
const userVersion = await getContractVersion(c.baseUrl, "tee:user/contracts");
await c.t3n.executeAndDecode({
  script_name: "tee:user/contracts",
  script_version: userVersion,
  function_name: "agent-auth-update",
  input: {
    agents: [
      {
        agentDid: c.did,
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

const out: any = await c.t3n.executeAndDecode({
  script_name: SCRIPT,
  script_version: scriptVersion,
  function_name: "check-eligibility",
  input: { policy_id: POLICY_ID },
});

console.log(`check-eligibility('${POLICY_ID}')\n  -> ${JSON.stringify(out)}\n`);

if (out.reason_code === "country_not_permitted") {
  console.log("PROVEN: the verdict flipped on the profile's real residence_country.");
  console.log("        The host resolved {{profile.residence_country}} to an actual value,");
  console.log("        which the contract itself never saw.");
} else if (out.reason_code === "profile_incomplete") {
  console.log("NOT RESOLVED: the verifier saw a literal {{...}} marker.");
} else {
  console.log(`unexpected reason_code: ${out.reason_code}`);
}
