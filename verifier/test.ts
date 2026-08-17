/**
 * Verifier tests. Run: npx tsx verifier/test.ts
 *
 * The age boundary is a cliff — one day either side flips a legal decision —
 * so the birthday edges are tested explicitly.
 */
import assert from "node:assert/strict";
import { ageInYears, evaluate } from "./api/eligibility.js";

const NOW = new Date(Date.UTC(2026, 7, 17)); // 2026-08-17
let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

console.log("ageInYears");
test("exact birthday counts as the full year", () =>
  assert.equal(ageInYears("2008-08-17", NOW), 18));
test("day before birthday is still one year less", () =>
  assert.equal(ageInYears("2008-08-18", NOW), 17));
test("day after birthday", () => assert.equal(ageInYears("2008-08-16", NOW), 18));
test("leap-day birth resolves", () => assert.equal(ageInYears("2008-02-29", NOW), 18));
test("rejects impossible calendar date", () =>
  assert.equal(ageInYears("2001-02-30", NOW), null));
test("rejects malformed input", () => assert.equal(ageInYears("not-a-date", NOW), null));
test("rejects future date of birth", () => assert.equal(ageInYears("2030-01-01", NOW), null));

console.log("evaluate");
const policy = { policy_id: "adult-eu", min_age: 18, allowed_countries: ["NG", "GB"] };

test("eligible adult in a permitted country", () =>
  assert.deepEqual(
    evaluate({ ...policy, subject: { date_of_birth: "1990-01-01", country: "NG" } }, NOW),
    { eligible: true, reason_code: "ok" },
  ));

test("underage is refused", () =>
  assert.deepEqual(
    evaluate({ ...policy, subject: { date_of_birth: "2015-01-01", country: "NG" } }, NOW),
    { eligible: false, reason_code: "age_below_minimum" },
  ));

test("disallowed country is refused", () =>
  assert.deepEqual(
    evaluate({ ...policy, subject: { date_of_birth: "1990-01-01", country: "FR" } }, NOW),
    { eligible: false, reason_code: "country_not_permitted" },
  ));

test("country match is case-insensitive", () =>
  assert.equal(
    evaluate({ ...policy, subject: { date_of_birth: "1990-01-01", country: "ng" } }, NOW)
      .eligible,
    true,
  ));

test("empty allowed_countries permits any country", () =>
  assert.equal(
    evaluate(
      { policy_id: "p", min_age: 18, allowed_countries: [], subject: { date_of_birth: "1990-01-01", country: "ZZ" } },
      NOW,
    ).eligible,
    true,
  ));

test("an unresolved placeholder is incomplete, not a literal comparison", () =>
  assert.deepEqual(
    evaluate(
      { ...policy, subject: { date_of_birth: "{{profile.date_of_birth}}", country: "NG" } },
      NOW,
    ),
    { eligible: false, reason_code: "profile_incomplete" },
  ));

test("missing subject is incomplete", () =>
  assert.deepEqual(evaluate({ ...policy }, NOW), {
    eligible: false,
    reason_code: "profile_incomplete",
  }));

test("response never carries the input values back", () => {
  const out = evaluate(
    { ...policy, subject: { date_of_birth: "1990-01-01", country: "NG" } },
    NOW,
  );
  const json = JSON.stringify(out);
  assert.equal(json.includes("1990-01-01"), false);
  assert.equal(json.includes("NG"), false);
});

console.log(`\n${passed} passed`);
