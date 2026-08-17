# Terminal 3 ADK — walkthrough completion, bug report, and an original TEE contract

Submission for the LOL Ventures bounty *"Create Agent ID, claim free tokens, &
deploy first RUST contract on the network."*

Three things are in here:

1. **The walkthrough, completed** — Quickstart auth through to a registered,
   invoked TEE contract, with every script used to get there.
2. **[`BUGS.md`](BUGS.md)** — 16 findings, including three blockers that stop
   the published Quickstart from running at all, each with a reproduction and
   the node's own request ids.
3. **[`z-tenant-eligibility/`](z-tenant-eligibility/)** — an original TEE
   contract, live on testnet, built for the bounty's bonus ask for use-case
   inspiration.

**Live now:** `z:f39cbc5ab038a4b3fa862e025f971485690864e4:eligibility` @ 0.1.5
(contract id 717) on `cn-api.sg.testnet.t3n.terminal3.io`, calling a real
external verifier at `verifier-jade.vercel.app`.

---

## The headline finding

The published Quickstart does not run. Its very first code sample throws:

```
T3nConfigError: T3nClient: `trustAnchor` is required
```

and the next page's success check, `await tenant.me()`, throws
`TypeError: tenant.me is not a function`.

That second one is **the most-asked unanswered question about this product** —
it is the top comment on the bounty listing itself:

> *"stuck at Set Up Development Environment, the `await tenant.me()` line keeps
> throwing an error and the troubleshooting table don't show a fix for it"*

The answer: `me()` lives on the `tenant` namespace, so the call is
`tenant.tenant.me()`. Even corrected it still fails, because `TenantClient`
sends `contract_id` where the node's `action.execute` expects `script_name`,
and the node's function is named `tenant-me`, not `me`.

Working around all of it took reverse-engineering the node's control plane.
That was possible only because of a fourth bug: unknown function names return
`-32603 Internal error` while real functions given bad arguments return a
precise `-32602`. That asymmetry turns the node into an oracle for its own API
surface — which is how the correct names below were recovered.

| Operation | SDK sends | Node actually wants |
|---|---|---|
| tenant identity | `me` | `tenant-me` |
| create map | `tail` | `map_name`, fully canonical |
| register contract | `tail` | `name`, fully canonical |
| register payload | `wasm` field | multipart blob via `executeWithBlob` |

---

## The contract: reusable confidential eligibility attestations

The reference contract (`z-tenant-flight`) shows PII-safe *booking*. This one
shows something harder to build anywhere else: **answering a question about a
user's PII, and keeping only the answer.**

The problem is mundane and everywhere. To gate anything on "is this person over
18 and in a permitted country?", the usual approach collects a date of birth
and an address. Every tenant that needs the answer ends up storing regulated
data it never wanted, and re-collects it on every check.

`z-tenant-eligibility` inverts that:

| | |
|---|---|
| **The contract never sees the PII** | The predicate is evaluated by an external verifier reached through `http-with-placeholders`. The body carries `{{profile.date_of_birth}}` and `{{profile.residence_country}}` markers, still literal text inside the WASM. The host substitutes them on its own stack after the contract has composed the request. |
| **The caller never sees it either** | Only `{ eligible, reason_code, issued_at, expires_at }` crosses the WIT boundary. Reason codes are coarse by design — a precise reason would leak a bit of the profile. |
| **The answer is reusable** | The attestation is cached per policy per user. A second call inside the validity window returns `reused: true` and makes **no outbound call at all**. |
| **The subject cannot be forged** | The subject comes from `tenant-context.calling-user-did()`, never from contract input. |
| **It is tamper-evident** | `kv-store.set-claims-digest` binds the attestation's SHA-256 into the transaction's Merkle leaf, so a holder can prove from the ledger receipt that this cluster issued exactly this record. |

### It works, live

From [`evidence/04-end-to-end-invoke.txt`](evidence/04-end-to-end-invoke.txt):

```jsonc
// first call — resolves PII host-side, calls the verifier, issues an attestation
{"policy_id":"adult-eu","subject":"f39cbc5a…","eligible":true,"reason_code":"ok",
 "digest":"51fc6b1b5d75923e…","reused":false}

// second call — same digest, no outbound request, profile not read
{… "digest":"51fc6b1b5d75923e…","reused":true}

// verify a genuine attestation, then a tampered one
{"valid":true,"reason_code":"ok","expires_at":1789550459}
{"valid":false,"reason_code":"digest_mismatch","expires_at":1789550459}
```

### Proving the PII really is resolved host-side

A positive result alone is suggestive but not conclusive — a verifier that
ignored its input would also say "eligible". So the verifier is written to
return `profile_incomplete` if it ever sees a literal `{{` marker, and
[`scripts/demo-negative.ts`](scripts/demo-negative.ts) seeds a second policy
whose `allowed_countries` **excludes** the profile's real country:

```
seeded policy 'eu-only' allowing DE, FR (profile is NG)
  -> {"policy_id":"eu-only","eligible":false,"reason_code":"country_not_permitted", …}
```

The verdict flipped on a value the contract never held. Three outcomes are
distinguishable — `ok` (resolved, permitted), `country_not_permitted`
(resolved, real value evaluated), `profile_incomplete` (not resolved) — and we
got the middle one.

### Where it could go

The natural next step is `signing::sign`, turning the attestation into a
portable credential a *different* tenant could verify without querying this one
— the reusable-verified-data story T3N is built for. It isn't used here only
because the docs never state which host interfaces a tenant world provides, so
importing it is an untestable guess (BUG-07).

---

## Repo layout

```
scripts/
  session.ts        auth — trust anchor, handshake, authenticate
  control.ts        direct control-plane client (the SDK's TenantClient is broken)
  quickstart.ts     Quickstart + TenantClient steps
  deploy.ts         register + create maps + re-point ACLs + seed secrets
  set-profile.ts    populate the profile fields the placeholders resolve
  invoke.ts         egress grant, then the full flow incl. a tamper case
  demo-negative.ts  proof that placeholder resolution really happens
  probe-*.ts        the diagnostics used to reverse-engineer the node
z-tenant-eligibility/   the original contract (Rust → wasm32-wasip2)
verifier/               the external verifier — the only component that sees plaintext PII
z-tenant-flight/        the reference contract, cloned and built unmodified
repro/bug-01/           minimal reproduction of the blocking Rust doc bug
evidence/               raw transcripts backing every claim in BUGS.md
docs/                   raw doc markdown, pinned for verbatim citation
```

## Running it

```bash
npm install
cp .env.example .env        # fill in T3N_API_KEY

# build both contracts
(cd z-tenant-eligibility && cargo build --target wasm32-wasip2 --release)
(cd z-tenant-flight      && cargo build --target wasm32-wasip2 --release)

# 38 tests, no host required
(cd z-tenant-eligibility && cargo test --target x86_64-unknown-linux-gnu)  # 23
npx tsx verifier/test.ts                                                   # 15

# deploy the verifier, then point VERIFIER_URL at it
(cd verifier && vercel deploy --prod)

npx tsx --env-file=.env scripts/quickstart.ts
npx tsx --env-file=.env scripts/set-profile.ts
CONTRACT_VERSION=0.1.5 npx tsx --env-file=.env scripts/deploy.ts eligibility
npx tsx --env-file=.env scripts/invoke.ts
npx tsx --env-file=.env scripts/demo-negative.ts
```

`CONTRACT_VERSION` must increase on every deploy — the node rejects a version
that is not higher than the current one.

The contract's tests run natively because all parsing, validation and digest
logic is target-independent; only host calls sit behind
`#[cfg(target_arch = "wasm32")]`.

## Environment

| | |
|---|---|
| OS | Parrot / Debian 13, Linux 6.17.13 |
| Node | v20.19.2, npm 9.2.0 |
| Rust | rustc 1.97.1, target `wasm32-wasip2` |
| SDK | `@terminal3/t3n-sdk@4.39.1` |
| wasm-tools | 1.256.0 |
| Cluster | `cn-api.sg.testnet.t3n.terminal3.io` |
| `tee:tenant/contracts` | 1.26.0 |
| `tee:user/contracts` | 2.25.1 |

## Findings

Full write-ups with reproductions in [`BUGS.md`](BUGS.md).

| # | Severity | Summary |
|---|---|---|
| BUG-09 | Blocker | `T3nClient` requires `trustAnchor`; Quickstart omits it |
| BUG-10 | Blocker | `tenant.me()` does not exist; it is `tenant.tenant.me()` |
| BUG-11 | Blocker | `TenantClient` sends `contract_id`; the node wants `script_name` |
| BUG-13 | Blocker | SDK and node disagree on function and field names throughout |
| BUG-01 | Blocker | `tenant_did()` docs contradict the reference impl; snippet does not compile |
| BUG-12 | Major | Unknown function names return `Internal error`, masking every other defect |
| BUG-03 | Major | `getScriptVersion` does not exist; it is `getContractVersion` |
| BUG-02 | Major | Documented `Cargo.toml` omits the required `hex` dependency |
| BUG-06 | Major | Two pages disagree on bare tail vs full `z:<tid>:` map name |
| BUG-15 | Major | Re-registering mints a new `contract_id`, silently orphaning map ACLs |
| BUG-16 | Major | Profile schema undocumented; the field is `residence_country` |
| BUG-08 | Major | The walkthrough needs three credentials; the claim page issues one |
| BUG-07 | Minor | The tenant world's available host interfaces are never listed |
| BUG-14 | Minor | Two different credential formats are both called "the API key" |
| BUG-04 | Minor | `idx:_tenants` admission referenced but never explained |
| BUG-05 | Minor | `npm install` EBADENGINE warning with no documented Node range |

## License

MIT. `z-tenant-flight/` is Terminal 3's, cloned unmodified for reference.
