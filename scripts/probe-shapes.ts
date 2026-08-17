/**
 * Discover the real parameter shape of each control function by feeding it
 * progressively and reading the node's own "missing field" / "invalid type"
 * complaints back.
 *
 * The node is strict and specific about deserialization errors, so it will
 * describe its own schema if asked enough times.
 */
import { getContractVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { connect, requireEnv } from "./session.js";

const baseUrl = getNodeUrl();
const { t3n, did } = await connect(requireEnv("T3N_API_KEY"));
const CONTROL = "tee:tenant/contracts";
const version = await getContractVersion(baseUrl, CONTROL);
console.log(`did: ${did}\n${CONTROL} @ ${version}\n`);

async function call(fn: string, input: Record<string, unknown>) {
  try {
    const out = await t3n.executeAndDecode({
      script_name: CONTROL,
      script_version: version,
      function_name: fn,
      input,
    });
    return { ok: true as const, out };
  } catch (err: any) {
    return {
      ok: false as const,
      detail: String(err?.detail ?? err?.message ?? ""),
      code: err?.httpStatus,
    };
  }
}

/** Candidate values tried, in order, when a field's type is unknown. */
const GUESSES: unknown[] = ["x", 1, true, [], {}];

async function discover(fn: string, seed: Record<string, unknown> = {}) {
  console.log(`\n=== ${fn} ===`);
  const input: Record<string, unknown> = { ...seed };

  for (let step = 0; step < 14; step++) {
    const res = await call(fn, input);
    if (res.ok) {
      console.log(`  OK with ${JSON.stringify(input)}`);
      console.log(`  -> ${JSON.stringify(res.out).slice(0, 400)}`);
      return input;
    }

    const missing = /missing field `([^`]+)`/.exec(res.detail);
    if (missing) {
      const field = missing[1];
      input[field] = "x";
      console.log(`  + ${field}`);
      continue;
    }

    const badType = /invalid type: [^,]+, expected ([^\s]+)/.exec(res.detail);
    if (badType) {
      // Find which field we most recently set and retype it.
      const last = Object.keys(input).at(-1)!;
      const expected = badType[1];
      const next =
        expected.includes("seq") || expected.includes("sequence")
          ? []
          : expected.includes("map") || expected.includes("struct")
            ? {}
            : /u\d|i\d|integer/.test(expected)
              ? 1
              : expected.includes("bool")
                ? true
                : GUESSES[0];
      input[last] = next;
      console.log(`  ~ ${last} : ${expected}`);
      continue;
    }

    console.log(`  stop [${res.code}] ${res.detail.slice(0, 220)}`);
    console.log(`  shape so far: ${JSON.stringify(input)}`);
    return input;
  }
  return input;
}

await discover("tenant-me");
await discover("map-create");
await discover("contract-register");
