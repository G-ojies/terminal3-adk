# Eligibility verifier

Companion service to [`z-tenant-eligibility`](../z-tenant-eligibility). It
answers one question — "does this subject satisfy this policy?" — and returns
only a boolean and a coarse reason code.

## Why it exists separately

It is the **only** component in the system that ever holds plaintext PII, and it
holds it for the duration of one request. That is the point of the design, not
an accident:

```
contract (TEE)   composes a body containing {{profile.date_of_birth}}
                 and {{profile.country}} — literal markers, no values
      ↓
host             substitutes the calling user's real values on its own stack,
                 after the contract has finished composing the request
      ↓
this verifier    receives the resolved values, computes a boolean,
                 returns only that boolean
      ↓
contract (TEE)   stores and returns the boolean
```

The tenant's own contract cannot read the user's date of birth, even though it
is the thing asking about it. The verifier can, briefly, and is written to
match: it never logs a resolved value, never echoes one back, and persists
nothing.

## API

`POST /api/eligibility`, `Authorization: Bearer $VERIFIER_API_KEY`

```jsonc
// request — subject values arrive already resolved by the host
{
  "policy_id": "adult-eu",
  "min_age": 18,
  "allowed_countries": ["NG", "GB", "US", "DE"],
  "subject": { "date_of_birth": "1990-01-01", "country": "NG" }
}
```

```jsonc
// response — no input value is ever reflected back
{ "eligible": true, "reason_code": "ok" }
```

Reason codes: `ok`, `age_below_minimum`, `country_not_permitted`,
`profile_incomplete`.

A subject field still containing `{{` means the host did not substitute it,
usually because the user's profile lacks that field. That is reported as
`profile_incomplete` rather than compared as a literal string.

## Deploying

```bash
cd verifier
vercel deploy --prod
vercel env add VERIFIER_API_KEY production
```

Then set `VERIFIER_URL` in the root `.env` to the deployed
`https://<deployment>/api/eligibility`, and make sure that host appears in the
user's `agent-auth-update` grant — otherwise the call is refused with
`egress-denied` before it leaves the enclave.

## Tests

```bash
npx tsx verifier/test.ts   # 15 tests
```

Age is computed calendar-correctly rather than by dividing days by 365.25,
because the minimum-age check is a cliff and the naive version is wrong near a
birthday. The exact-birthday and day-before cases are tested explicitly.
