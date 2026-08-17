/**
 * Find how to populate the calling user's profile, so the host has something
 * to resolve {{profile.date_of_birth}} / {{profile.country}} against.
 */
import { getContractVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { connect, requireEnv } from "./session.js";

const baseUrl = getNodeUrl();
const { t3n, did } = await connect(requireEnv("T3N_API_KEY"));
const USER = "tee:user/contracts";
const version = await getContractVersion(baseUrl, USER);
console.log(`did: ${did}\n${USER} @ ${version}\n`);

const NAMES = [
  "user-me", "profile-get", "profile-upsert", "user-upsert", "upsert",
  "profile-set", "user-profile-upsert", "me", "user-get", "profile",
];

for (const fn of NAMES) {
  try {
    const out = await t3n.executeAndDecode({
      script_name: USER, script_version: version, function_name: fn, input: {},
    });
    console.log(`EXISTS (ok)      ${fn}  -> ${JSON.stringify(out).slice(0, 300)}`);
  } catch (err: any) {
    const code = err?.httpStatus;
    const detail = String(err?.detail ?? err?.message ?? "");
    if (code === -32602) console.log(`EXISTS (params)  ${fn}  -> ${detail.slice(0, 200)}`);
    else if (code === -32603) console.log(`absent           ${fn}`);
    else console.log(`? ${code}  ${fn}  -> ${detail.slice(0, 200)}`);
  }
}
