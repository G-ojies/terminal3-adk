/**
 * Finish discovering `contract-register` / `map-create`, using canonical
 * z:<tid>:<tail> names as the node demands.
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
console.log(`tid: ${tid}\nwasm: ${wasm.length} bytes\n`);

async function call(fn: string, input: Record<string, unknown>) {
  try {
    return { ok: true as const, out: await t3n.executeAndDecode({
      script_name: CONTROL, script_version: version, function_name: fn, input,
    }) };
  } catch (err: any) {
    return { ok: false as const, detail: String(err?.detail ?? err?.message ?? ""), code: err?.httpStatus };
  }
}

async function discover(fn: string, seed: Record<string, unknown>, fills: Record<string, unknown> = {}) {
  console.log(`\n=== ${fn} ===`);
  const input: Record<string, unknown> = { ...seed };
  for (let i = 0; i < 12; i++) {
    const res = await call(fn, input);
    if (res.ok) {
      console.log(`  OK  input keys: ${Object.keys(input).join(", ")}`);
      console.log(`  -> ${JSON.stringify(res.out).slice(0, 500)}`);
      return { input, out: res.out };
    }
    const missing = /missing field `([^`]+)`/.exec(res.detail);
    if (missing) {
      const f = missing[1];
      input[f] = f in fills ? fills[f] : "x";
      console.log(`  + ${f}`);
      continue;
    }
    const badType = /invalid type: ([^,]+), expected ([^\s]+)/.exec(res.detail);
    if (badType) {
      const last = Object.keys(input).at(-1)!;
      console.log(`  ~ ${last}: got ${badType[1]}, wants ${badType[2]}`);
      if (last in fills) { console.log(`  (already filled; stopping)`); return { input, out: undefined }; }
      input[last] = /u\d|i\d|integer/.test(badType[2]) ? 1 : badType[2].includes("seq") ? [] : {};
      continue;
    }
    console.log(`  stop [${res.code}] ${res.detail.slice(0, 240)}`);
    console.log(`  shape: ${JSON.stringify(Object.keys(input))}`);
    return { input, out: undefined };
  }
  return { input, out: undefined };
}

// map-create with a canonical name and a valid visibility variant
await discover("map-create", {
  map_name: `z:${tid}:probe-map`,
  visibility: "private",
});

// contract-register: try base64 wasm, the most common wire form
await discover(
  "contract-register",
  { name: `z:${tid}:probe-contract`, version: "0.1.0" },
  { wasm: wasm.toString("base64"), wasm_b64: wasm.toString("base64"), bytes: wasm.toString("base64"), module: wasm.toString("base64") },
);
