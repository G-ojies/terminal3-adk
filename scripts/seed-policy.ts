/**
 * Seed a tenant policy into z:<tid>:policies.
 *
 *   npx tsx --env-file=.env scripts/seed-policy.ts <policy_id> [country ...]
 *
 * Attestations are cached per policy per user, so a fresh policy id is the way
 * to force a genuine re-evaluation (a re-run against an existing policy
 * correctly returns the cached answer with reused: true).
 */
import { controlClient } from "./control.js";
import { requireEnv } from "./session.js";

const policyId = process.argv[2];
if (!policyId) {
  throw new Error("usage: seed-policy.ts <policy_id> [allowed_country ...]");
}
const allowed = process.argv.slice(3);

const c = await controlClient();
const policy = {
  min_age: Number(process.env.MIN_AGE ?? 18),
  allowed_countries: allowed,
  ttl_secs: Number(process.env.TTL_SECS ?? 2_592_000),
  verifier_url: requireEnv("VERIFIER_URL"),
};

await c.exec("map-entry-set", {
  map_name: c.canonical("policies"),
  key: policyId,
  value: JSON.stringify(policy),
});

console.log(
  `seeded policy '${policyId}': min_age=${policy.min_age} allowed=[${
    allowed.length ? allowed.join(", ") : "any"
  }]`,
);
