/**
 * Diagnostic: TenantClient.executeControl sends `contract_id`/`contract_version`,
 * but the node's action.execute wants `script_name`/`script_version`.
 *
 * Confirm that by calling the same control contract directly through
 * T3nClient.execute with the field names the node expects.
 */
import { getContractVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { connect, requireEnv } from "./session.js";

const { t3n, did: tenantDid } = await connect(requireEnv("T3N_API_KEY"));
console.log("tenantDid:", tenantDid);

const CONTROL = "tee:tenant/contracts";
const version = await getContractVersion(getNodeUrl(), CONTROL);
console.log("control contract version:", version);

// The shape the node's schema actually asks for.
const result = await t3n.executeAndDecode({
  script_name: CONTROL,
  script_version: version,
  function_name: "me",
  input: {},
});
console.log("me() via script_name:", JSON.stringify(result, null, 2));
