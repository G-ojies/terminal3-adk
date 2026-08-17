/**
 * Diagnostic: is the DID admitted as a tenant?
 *
 * `TenantNamespace` exposes `claim()` alongside `me()`. Nothing in Get Started
 * mentions it, but "admitted as a tenant in idx:_tenants" (BUG-04) has to
 * happen somehow, and this is the only candidate in the SDK surface.
 *
 * Order: retry `me` once (the docs say generic 500s can be transient), then
 * `claim`, then `me` again to see whether claiming changed anything.
 */
import { getContractVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { connect, requireEnv } from "./session.js";

const { t3n, did: tenantDid } = await connect(requireEnv("T3N_API_KEY"));
const CONTROL = "tee:tenant/contracts";
const version = await getContractVersion(getNodeUrl(), CONTROL);
console.log("tenantDid:", tenantDid, "| control:", CONTROL, version);

async function call(fn: string, input: unknown = {}) {
  try {
    const out = await t3n.executeAndDecode({
      script_name: CONTROL,
      script_version: version,
      function_name: fn,
      input,
    });
    console.log(`\n${fn}() -> OK`);
    console.log(JSON.stringify(out, null, 2));
    return out;
  } catch (err: any) {
    console.log(
      `\n${fn}() -> ${err?.code ?? "ERR"} ${err?.httpStatus ?? ""} ${err?.detail ?? err?.message ?? ""} [req ${err?.requestId ?? "-"}]`,
    );
    return undefined;
  }
}

await call("me");
await call("claim");
await call("me");
