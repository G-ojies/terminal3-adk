/**
 * Populate the calling user's profile with the fields this policy resolves.
 *
 *   npx tsx --env-file=.env scripts/set-profile.ts
 *
 * The contract sends {{profile.date_of_birth}} and
 * {{profile.residence_country}}; the host substitutes them from this profile
 * at dispatch time, so they must exist or the host returns PlaceholderUnknown.
 *
 * Field names verified against `user-upsert`, which rejects unknown keys and
 * names them — the schema accepts date_of_birth, first_name, last_name,
 * residence_country, address, verified_contacts, gender. Notably NOT `country`.
 */
import { getContractVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { connect, requireEnv } from "./session.js";

const baseUrl = getNodeUrl();
const { t3n, did } = await connect(requireEnv("T3N_API_KEY"));
const USER = "tee:user/contracts";
const version = await getContractVersion(baseUrl, USER);

const profile = {
  date_of_birth: process.env.PROFILE_DOB ?? "1990-04-12",
  residence_country: process.env.PROFILE_COUNTRY ?? "NG",
};

console.log(`did: ${did}`);
console.log(`upserting profile fields: ${Object.keys(profile).join(", ")}`);

const out = await t3n.executeAndDecode({
  script_name: USER,
  script_version: version,
  function_name: "user-upsert",
  input: profile,
});

console.log(`-> ${JSON.stringify(out)}`);
