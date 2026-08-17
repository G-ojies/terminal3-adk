/**
 * Diagnostic: is the session healthy, or is `tee:tenant/contracts`
 * specifically failing for this DID?
 *
 * Also checks whether the claim-page credential works on the REST discover
 * path, which documents a different credential shape (`t3n_key_<...>` in an
 * X-T3N-Api-Key header) than the `0x`-prefixed signing key the Quickstart
 * feeds to eth_get_address.
 */
import {
  discoverWhoami,
  discoverListContracts,
  getContractVersion,
  getNodeUrl,
} from "@terminal3/t3n-sdk";
import { connect, requireEnv } from "./session.js";

const apiKey = requireEnv("T3N_API_KEY");
const baseUrl = getNodeUrl();
console.log("node:", baseUrl);
console.log("key shape:", /^t3n_key_/.test(apiKey) ? "t3n_key_..." : "0x-hex signing key");

// --- REST discover path ----------------------------------------------------
for (const [name, fn] of [
  ["discoverWhoami", () => discoverWhoami({ baseUrl, apiKey })],
  ["discoverListContracts", () => discoverListContracts({ baseUrl, apiKey })],
] as const) {
  try {
    const out = await fn();
    console.log(`\n${name} -> OK`);
    console.log(JSON.stringify(out, null, 2).slice(0, 1500));
  } catch (err: any) {
    console.log(`\n${name} -> ${err?.message ?? String(err)}`);
  }
}

// --- RPC path: does a non-tenant contract resolve? -------------------------
const { t3n } = await connect(apiKey);
for (const contract of ["tee:user/contracts", "tee:tenant/contracts"]) {
  try {
    const v = await getContractVersion(baseUrl, contract);
    console.log(`\nversion(${contract}) -> ${v}`);
  } catch (err: any) {
    console.log(`\nversion(${contract}) -> ${err?.message ?? String(err)}`);
  }
}

// A read-only call against the user contract, to compare against tenant's 500.
try {
  const v = await getContractVersion(baseUrl, "tee:user/contracts");
  const out = await t3n.executeAndDecode({
    script_name: "tee:user/contracts",
    script_version: v,
    function_name: "me",
    input: {},
  });
  console.log("\ntee:user/contracts me() -> OK");
  console.log(JSON.stringify(out, null, 2).slice(0, 800));
} catch (err: any) {
  console.log(
    `\ntee:user/contracts me() -> ${err?.code ?? "ERR"} ${err?.httpStatus ?? ""} ${err?.detail ?? err?.message ?? ""} [req ${err?.requestId ?? "-"}]`,
  );
}
