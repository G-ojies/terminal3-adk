/**
 * Register the contract for real, using the transport the node actually wants:
 * `executeWithBlob` (multipart) rather than a base64 field, and the node's own
 * field names (`name`, not `tail`).
 */
import { readFile } from "node:fs/promises";
import { getContractVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { connect, requireEnv, tidOf } from "./session.js";

const baseUrl = getNodeUrl();
const { t3n, did } = await connect(requireEnv("T3N_API_KEY"));
const tid = tidOf(did);
const CONTROL = "tee:tenant/contracts";
const version = await getContractVersion(baseUrl, CONTROL);

const wasm = await readFile(
  new URL("../z-tenant-eligibility/target/wasm32-wasip2/release/z_tenant_eligibility.wasm", import.meta.url),
);
const blob = new Blob([wasm], { type: "application/wasm" });
console.log(`tid: ${tid}\nwasm: ${wasm.length} bytes\n`);

const input: Record<string, unknown> = {
  name: `z:${tid}:eligibility`,
  version: "0.1.0",
};

for (let i = 0; i < 10; i++) {
  try {
    const out = await t3n.executeWithBlob(
      {
        script_name: CONTROL,
        script_version: version,
        function_name: "contract-register",
        input,
      },
      blob,
    );
    console.log("REGISTERED");
    console.log("input:", JSON.stringify(input));
    console.log("result:", typeof out === "string" ? out.slice(0, 600) : JSON.stringify(out).slice(0, 600));
    break;
  } catch (err: any) {
    const detail = String(err?.detail ?? err?.message ?? "");
    const missing = /missing field `([^`]+)`/.exec(detail);
    if (missing) {
      console.log(`  + ${missing[1]}`);
      input[missing[1]] = "x";
      continue;
    }
    const variant = /unknown variant `[^`]*`, expected (?:one of )?(.+?) at/.exec(detail);
    if (variant) {
      const last = Object.keys(input).at(-1)!;
      const first = variant[1].split(",")[0].replace(/[`\s]/g, "");
      console.log(`  ~ ${last} -> ${first}`);
      input[last] = first;
      continue;
    }
    console.log(`  stop [${err?.httpStatus}] ${detail.slice(0, 300)}`);
    console.log(`  input: ${JSON.stringify(input)}`);
    break;
  }
}
