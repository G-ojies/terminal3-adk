/**
 * Try to reproduce the deploy's one-off `access denied` on a control-plane
 * write, by replaying its exact sequence: update map A's ACL, update map B's
 * ACL, then immediately write an entry to A.
 */
import { controlClient, describeError } from "./control.js";

const c = await controlClient();
const a = c.canonical("race-a");
const b = c.canonical("race-b");

for (const m of [a, b]) {
  try {
    await c.exec("map-create", { map_name: m, visibility: "private", readers: "all", writers: "all" });
  } catch {
    /* already exists */
  }
}

const ID = 718;
let denied = 0;

for (let round = 1; round <= 5; round++) {
  // Exactly the deploy's order.
  await c.exec("map-update", { map_name: a, readers: { only: [ID] }, writers: { only: [ID] } });
  await c.exec("map-update", { map_name: b, readers: { only: [ID] }, writers: { only: [ID] } });
  try {
    await c.exec("map-entry-set", { map_name: a, key: "k", value: `round-${round}` });
    console.log(`round ${round}: allowed`);
  } catch (err) {
    denied++;
    console.log(`round ${round}: DENIED -> ${describeError(err).slice(0, 130)}`);
  }
}

console.log(`\n${denied}/5 rounds denied`);

// Leave them open so nothing stays locked.
for (const m of [a, b]) {
  await c.exec("map-update", { map_name: m, readers: "all", writers: "all" });
}
