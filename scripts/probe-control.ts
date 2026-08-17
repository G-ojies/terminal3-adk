/**
 * Diagnostic: show the exact control payload TenantClient builds for `me()`,
 * to find why the node rejects it with "missing field `script_name`".
 */
import { TenantClient, getNodeUrl } from "@terminal3/t3n-sdk";
import { connect, requireEnv } from "./session.js";

const { t3n, did: tenantDid } = await connect(requireEnv("T3N_API_KEY"));
console.log("tenantDid:", tenantDid);

for (const tenantContractId of [undefined, "tee:tenant", "tee:tenant/contracts"]) {
  const tenant = new TenantClient({
    t3n,
    baseUrl: getNodeUrl(),
    tenantDid,
    ...(tenantContractId ? { tenantContractId } : {}),
  });
  try {
    const payload = await tenant.controlPayload("me", {});
    console.log(
      `\ntenantContractId = ${tenantContractId ?? "(unset)"}\n`,
      JSON.stringify(payload, null, 2),
    );
  } catch (err) {
    console.log(
      `\ntenantContractId = ${tenantContractId ?? "(unset)"} -> threw:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
