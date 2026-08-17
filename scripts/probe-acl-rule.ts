/**
 * Determine whether a control-plane `map-entry-set` really bypasses the map's
 * writers ACL, as the docs claim.
 *
 * The docs say: "writers/readers restrict your contracts, not you. As the map's
 * owner you can always write its entries directly via the control plane
 * (map-entry-set), even on a writers: { only: [contractId] } map."
 *
 * A deploy hit `access denied: StorageRouterOnBehalfOf(Contract(
 * tee:tenant/contracts)) cannot write map` immediately after narrowing the ACL,
 * yet the same call succeeded minutes later. This narrows down which it is by
 * setting the ACL and probing straight away, several times.
 */
import { controlClient, describeError } from "./control.js";

const c = await controlClient();
const map_name = c.canonical("acl-probe");

// A throwaway map, so nothing in use gets locked out.
try {
  await c.exec("map-create", {
    map_name,
    visibility: "private",
    readers: "all",
    writers: "all",
  });
  console.log(`created ${map_name}`);
} catch (err) {
  const m = describeError(err);
  console.log(/already exists/i.test(m) ? `${map_name} already exists` : `create: ${m}`);
}

async function entrySet(label: string) {
  try {
    await c.exec("map-entry-set", { map_name, key: "probe", value: label });
    return "allowed";
  } catch (err) {
    const m = describeError(err);
    return /access denied/i.test(m) ? "DENIED" : `error: ${m.slice(0, 90)}`;
  }
}

async function setAcl(acl: Record<string, unknown>) {
  await c.exec("map-update", { map_name, ...acl });
}

console.log("\nACL = writers:all");
await setAcl({ readers: "all", writers: "all" });
for (let i = 1; i <= 3; i++) console.log(`  attempt ${i}: ${await entrySet("wall")}`);

// 999999 is a contract id that cannot exist, so the control plane is
// definitively not in the writers set.
console.log("\nACL = writers:only[999999]  (control plane excluded)");
await setAcl({ readers: "all", writers: { only: [999999] } });
for (let i = 1; i <= 4; i++) console.log(`  attempt ${i}: ${await entrySet("wonly")}`);

// The deploy narrowed BOTH readers and writers. Writers alone is clearly not
// the cause, so test readers.
console.log("\nACL = readers:only[999999]  (control plane cannot READ)");
await setAcl({ readers: { only: [999999] }, writers: "all" });
for (let i = 1; i <= 4; i++) console.log(`  attempt ${i}: ${await entrySet("ronly")}`);

console.log("\nACL = readers AND writers only[999999]  (exactly what the deploy set)");
await setAcl({ readers: { only: [999999] }, writers: { only: [999999] } });
for (let i = 1; i <= 3; i++) console.log(`  attempt ${i}: ${await entrySet("both")}`);

console.log("\nrestoring readers:all writers:all");
await setAcl({ readers: "all", writers: "all" });
console.log(`  final: ${await entrySet("restored")}`);
