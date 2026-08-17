/**
 * Eligibility verifier for `z-tenant-eligibility`.
 *
 * This service is deliberately the ONLY component in the system that ever sees
 * plaintext PII, and it sees it for exactly as long as one request takes.
 *
 *   contract (TEE)  composes a body containing {{profile.date_of_birth}}
 *                   and {{profile.country}} — literal markers, no values
 *   host            substitutes the calling user's real values on its own
 *                   stack, after the contract has finished
 *   this verifier   receives the resolved values, computes a boolean, and
 *                   returns only that boolean
 *   contract (TEE)  stores and returns the boolean
 *
 * So the trust boundary is explicit: the tenant's contract cannot read the
 * user's date of birth even though it is the thing asking about it.
 *
 * Rules this service follows, because it is the sensitive link in the chain:
 *   - never log a resolved value, only field names and outcomes
 *   - never echo a resolved value back in the response
 *   - never persist anything
 */

type Subject = {
  date_of_birth?: string;
  country?: string;
};

type VerifyRequest = {
  policy_id?: string;
  min_age?: number;
  allowed_countries?: string[];
  subject?: Subject;
};

type VerifyResponse = {
  eligible: boolean;
  reason_code: string;
};

const REASON = {
  OK: "ok",
  AGE_BELOW_MINIMUM: "age_below_minimum",
  COUNTRY_NOT_PERMITTED: "country_not_permitted",
  PROFILE_INCOMPLETE: "profile_incomplete",
} as const;

/**
 * Whole years elapsed, calendar-correct — `Math.floor(days / 365.25)` is wrong
 * near a birthday and this decision is a cliff, so the error would be real.
 * Returns null if the date is unparseable or in the future.
 */
export function ageInYears(dateOfBirth: string, now: Date): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth.trim());
  if (!match) return null;

  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);

  const dob = new Date(Date.UTC(year, month - 1, day));
  // Rejects impossible dates like 2001-02-30, which Date would roll over.
  if (
    dob.getUTCFullYear() !== year ||
    dob.getUTCMonth() !== month - 1 ||
    dob.getUTCDate() !== day
  ) {
    return null;
  }
  if (dob.getTime() > now.getTime()) return null;

  let age = now.getUTCFullYear() - year;
  const monthDelta = now.getUTCMonth() - (month - 1);
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < day)) {
    age -= 1;
  }
  return age;
}

/** Pure decision function, so it can be unit tested without a server. */
export function evaluate(body: VerifyRequest, now: Date): VerifyResponse {
  const dob = body.subject?.date_of_birth;
  const country = body.subject?.country;

  // An unresolved marker means the host did not substitute — usually a missing
  // profile field. Treat it as incomplete rather than accidentally comparing
  // the literal string.
  const unresolved = (v?: string) => !v || v.includes("{{");

  if (unresolved(dob) || unresolved(country)) {
    return { eligible: false, reason_code: REASON.PROFILE_INCOMPLETE };
  }

  const allowed = body.allowed_countries ?? [];
  if (allowed.length > 0 && !allowed.includes(country!.toUpperCase())) {
    return { eligible: false, reason_code: REASON.COUNTRY_NOT_PERMITTED };
  }

  const age = ageInYears(dob!, now);
  if (age === null) {
    return { eligible: false, reason_code: REASON.PROFILE_INCOMPLETE };
  }
  if (age < (body.min_age ?? 0)) {
    return { eligible: false, reason_code: REASON.AGE_BELOW_MINIMUM };
  }

  return { eligible: true, reason_code: REASON.OK };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const expected = process.env.VERIFIER_API_KEY;
  if (expected) {
    const auth = String(req.headers?.authorization ?? "");
    if (auth !== `Bearer ${expected}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  }

  let body: VerifyRequest;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ error: "body must be JSON" });
    return;
  }
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "body must be a JSON object" });
    return;
  }

  const result = evaluate(body, new Date());

  // Log the outcome and which fields were present — never their values.
  console.log(
    JSON.stringify({
      policy_id: body.policy_id ?? null,
      received_fields: Object.keys(body.subject ?? {}),
      eligible: result.eligible,
      reason_code: result.reason_code,
    }),
  );

  res.status(200).json(result);
}
