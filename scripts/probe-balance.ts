/** What credit does the claim page actually grant, and can an agent be funded? */
import { controlClient } from "./control.js";

const c = await controlClient();
const CANDIDATES = [
  "token-balance", "balance", "token-get-balance", "tenant-usage",
  "token-usage", "usage", "tenant-balance", "token-transfer", "token-grant",
];

for (const fn of CANDIDATES) {
  try {
    const out = await c.exec(fn, {});
    console.log(`EXISTS (ok)      ${fn}  -> ${JSON.stringify(out).slice(0, 300)}`);
  } catch (err: any) {
    const code = err?.httpStatus;
    const detail = String(err?.detail ?? err?.message ?? "");
    if (code === -32602) console.log(`EXISTS (params)  ${fn}  -> ${detail.slice(0, 160)}`);
    else if (code === -32603) console.log(`absent           ${fn}`);
    else console.log(`? ${code}  ${fn}  -> ${detail.slice(0, 160)}`);
  }
}
