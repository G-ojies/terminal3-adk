/**
 * Discover the user-profile schema.
 *
 * `user-upsert` rejects unknown keys and names every one of them in the error,
 * so sending a batch of candidates reveals which are real in a single call:
 * anything NOT listed as unrecognized is part of the schema.
 */
import { getContractVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { connect, requireEnv } from "./session.js";

const baseUrl = getNodeUrl();
const { t3n } = await connect(requireEnv("T3N_API_KEY"));
const USER = "tee:user/contracts";
const version = await getContractVersion(baseUrl, USER);

const CANDIDATES = [
  "date_of_birth", "first_name", "last_name", "given_name", "family_name",
  "country", "nationality", "citizenship", "residence_country",
  "country_code", "address", "residence", "location", "region",
  "email", "phone", "verified_contacts", "gender", "full_name",
];

async function unrecognized(keys: string[]): Promise<string[]> {
  const input = Object.fromEntries(keys.map((k) => [k, "x"]));
  try {
    await t3n.executeAndDecode({
      script_name: USER, script_version: version, function_name: "user-upsert", input,
    });
    return []; // everything accepted
  } catch (err: any) {
    const detail = String(err?.detail ?? err?.message ?? "");
    const m = /UnrecognizedKeys\s*\{\s*keys:\s*\[([^\]]*)\]/.exec(detail);
    if (m) return m[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
    // A different error means the keys were all recognised but a value/type was wrong.
    console.log(`  (non-schema error: ${detail.slice(0, 200)})`);
    return [];
  }
}

const bad = await unrecognized(CANDIDATES);
const good = CANDIDATES.filter((k) => !bad.includes(k));

console.log("REJECTED (not in schema):");
console.log("  " + (bad.join(", ") || "(none)"));
console.log("\nACCEPTED (part of the profile schema):");
console.log("  " + (good.join(", ") || "(none)"));
