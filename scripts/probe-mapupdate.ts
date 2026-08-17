/** Find the control function that updates a map's ACL, and its shape. */
import { controlClient } from "./control.js";

const c = await controlClient();
const map_name = c.canonical("attestations");

const NAMES = ["map-update", "map-acl-update", "map-set-acl", "map-acl", "map-grant", "map-modify"];

for (const fn of NAMES) {
  try {
    await c.exec(fn, {});
    console.log(`EXISTS (ok)      ${fn}`);
  } catch (err: any) {
    const code = err?.httpStatus;
    const detail = String(err?.detail ?? err?.message ?? "");
    if (code === -32602) console.log(`EXISTS (params)  ${fn}  -> ${detail.slice(0, 140)}`);
    else if (code === -32603) console.log(`absent           ${fn}`);
    else console.log(`? ${code}  ${fn}  -> ${detail.slice(0, 140)}`);
  }
}

// Once found, discover its shape the same way as before.
console.log("\n--- shape discovery on the surviving candidate ---");
for (const fn of NAMES) {
  const input: Record<string, unknown> = { map_name };
  let alive = true;
  for (let i = 0; i < 8 && alive; i++) {
    try {
      const out = await c.exec(fn, input);
      console.log(`${fn} OK with ${JSON.stringify(Object.keys(input))} -> ${JSON.stringify(out).slice(0, 200)}`);
      alive = false;
    } catch (err: any) {
      const detail = String(err?.detail ?? err?.message ?? "");
      if (err?.httpStatus === -32603) { alive = false; break; }
      const missing = /missing field `([^`]+)`/.exec(detail);
      if (missing) { input[missing[1]] = "x"; continue; }
      const variant = /unknown variant `[^`]*`, expected (?:one of )?(.+?) at/.exec(detail);
      if (variant) {
        const last = Object.keys(input).at(-1)!;
        input[last] = variant[1].split(",")[0].replace(/[`\s]/g, "");
        continue;
      }
      console.log(`${fn} stop: ${detail.slice(0, 200)}  shape=${JSON.stringify(Object.keys(input))}`);
      alive = false;
    }
  }
}
