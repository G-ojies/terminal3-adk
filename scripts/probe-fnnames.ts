/**
 * Discover which control functions actually exist on tee:tenant/contracts.
 *
 * The node returns -32603 "Internal error" for a function name it does not
 * know (confirmed with a deliberately fake name), and -32602 with a specific
 * message for a real function given bad params. So the error code separates
 * "no such function" from "function exists, arguments wrong".
 */
import { getContractVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { connect, requireEnv } from "./session.js";

const baseUrl = getNodeUrl();
const { t3n } = await connect(requireEnv("T3N_API_KEY"));
const CONTROL = "tee:tenant/contracts";
const version = await getContractVersion(baseUrl, CONTROL);
console.log(`${CONTROL} @ ${version}\n`);

const CANDIDATES = [
  // what the SDK's TenantNamespace calls
  "me",
  "claim",
  // documented in the tips pages
  "map-entry-set",
  "map-create",
  // plausible kebab-case forms for the documented SDK helpers
  "contract-register",
  "contract-publish",
  "tenant-me",
  "tenant-claim",
  "whoami",
  // control
  "zzz-definitely-not-real",
];

for (const fn of CANDIDATES) {
  try {
    await t3n.executeAndDecode({
      script_name: CONTROL,
      script_version: version,
      function_name: fn,
      input: {},
    });
    console.log(`EXISTS (ok)      ${fn}`);
  } catch (err: any) {
    const code = err?.httpStatus;
    const detail = err?.detail ?? err?.message ?? "";
    if (code === -32602) {
      console.log(`EXISTS (params)  ${fn}  -> ${detail.slice(0, 120)}`);
    } else if (code === -32603) {
      console.log(`absent           ${fn}`);
    } else {
      console.log(`? ${code}          ${fn}  -> ${detail.slice(0, 120)}`);
    }
  }
}
