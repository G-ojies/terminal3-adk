/**
 * Repair the shared `secrets` map ACL.
 *
 *   npx tsx --env-file=.env scripts/repair-acl.ts <contractId> [contractId ...]
 *
 * `secrets` is read by every contract, so narrowing it to one id locks the
 * others out. This also probes whether the tenant can still write entries after
 * an ACL narrowing — the docs say the owner always can via the control plane,
 * which turns out not to hold.
 */
import { controlClient, describeError } from "./control.js";

const ids = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
if (ids.length === 0) throw new Error("usage: repair-acl.ts <contractId> [contractId ...]");

const c = await controlClient();
const map_name = c.canonical("secrets");
console.log(`repairing ${map_name} for contracts [${ids.join(", ")}]\n`);

async function tryUpdate(label: string, acl: Record<string, unknown>) {
  try {
    await c.exec("map-update", { map_name, ...acl });
    console.log(`  ok    ${label}`);
    return true;
  } catch (err) {
    console.log(`  fail  ${label} -> ${describeError(err)}`);
    return false;
  }
}

async function canWriteEntry() {
  try {
    await c.exec("map-entry-set", { map_name, key: "_acl_probe", value: "ok" });
    return true;
  } catch (err) {
    console.log(`        map-entry-set -> ${describeError(err)}`);
    return false;
  }
}

console.log("before repair:");
console.log(`  tenant can write entries? ${(await canWriteEntry()) ? "yes" : "NO"}\n`);

// Readers restricted to the contracts that need the secret; writers opened so
// the control plane can seed entries again.
const shapes: Array<[string, Record<string, unknown>]> = [
  ["readers=only[ids], writers=all", { readers: { only: ids }, writers: "all" }],
  ["readers=all, writers=all", { readers: "all", writers: "all" }],
];

for (const [label, acl] of shapes) {
  if (await tryUpdate(label, acl)) {
    const ok = await canWriteEntry();
    console.log(`        tenant can write entries now? ${ok ? "yes" : "NO"}\n`);
    if (ok) {
      console.log(`repaired with: ${label}`);
      break;
    }
  }
}
