# Bug & Friction Report — Terminal 3 ADK

Findings from working through the ADK Quickstart and the TEE contract
walkthrough end to end, against the live testnet node.

Every finding below was reproduced against
`https://cn-api.sg.testnet.t3n.terminal3.io` with a real claimed credential.
Where the node returned a request id, it is included.

**Outcome:** the published Quickstart does not run as written. Three defects
sit between a new developer and their first authenticated call, and four more
between that call and a working contract. All are worked around in this repo,
and the contract is live and fully functional —
`z:f39cbc5ab038a4b3fa862e025f971485690864e4:eligibility` @ 0.1.4, contract id
716, issuing real attestations against a real external verifier.

Fourteen findings, ordered by where a developer meets them. Raw transcripts for
each are in [`evidence/`](evidence/).

| # | Severity | Summary |
|---|---|---|
| [BUG-09](#bug-09) | Blocker | `T3nClient` requires `trustAnchor`; Quickstart omits it — the first sample does not run |
| [BUG-10](#bug-10) | Blocker | `tenant.me()` does not exist; it is `tenant.tenant.me()` |
| [BUG-11](#bug-11) | Blocker | `TenantClient` sends `contract_id`; the node wants `script_name` |
| [BUG-12](#bug-12) | Major | Unknown function names return `Internal error`, masking every other defect |
| [BUG-13](#bug-13) | Blocker | SDK and node disagree on function and field names throughout |
| [BUG-03](#bug-03) | Major | `getScriptVersion` does not exist; it is `getContractVersion` |
| [BUG-01](#bug-01) | Blocker | `tenant_did()` docs contradict the reference impl; the snippet does not compile |
| [BUG-02](#bug-02) | Major | Documented `Cargo.toml` omits the required `hex` dependency |
| [BUG-06](#bug-06) | Major | Two pages disagree on bare tail vs full `z:<tid>:` map name |
| [BUG-15](#bug-15) | Major | Re-registering mints a new `contract_id`, silently orphaning map ACLs |
| [BUG-16](#bug-16) | Major | Profile schema undocumented; the field is `residence_country`, not `country` |
| [BUG-07](#bug-07) | Minor | The tenant world's available host interfaces are never listed |
| [BUG-08](#bug-08) | Major | The walkthrough needs three credentials; the claim page issues one |
| [BUG-14](#bug-14) | Minor | Two different credential formats are both called "the API key" |
| [BUG-04](#bug-04) | Minor | `idx:_tenants` admission referenced but never explained (downgraded — see entry) |
| [BUG-05](#bug-05) | Minor | `npm install` EBADENGINE warning with no documented Node range |

| Environment | |
|---|---|
| OS | Parrot / Debian 13, Linux 6.17.13 |
| Node | v20.19.2, npm 9.2.0 |
| Rust | rustc 1.97.1, target `wasm32-wasip2` |
| SDK | `@terminal3/t3n-sdk@4.39.1` |
| Node (cluster) | `cn-api.sg.testnet.t3n.terminal3.io` |
| `tee:tenant/contracts` | 1.26.0 |
| `tee:user/contracts` | 2.25.1 |

Severity: **Blocker** stops you completely, **Major** costs real debugging
time, **Minor** is friction or polish.

---

# Part 1 — The Quickstart does not run

## BUG-09 — `T3nClient` requires `trustAnchor`; the Quickstart omits it entirely

**Severity: Blocker** · Page: [Quickstart](https://docs.terminal3.io/developers/adk/get-started/quickstart)

This is the first defect a new developer hits, on the first code sample, on the
page that promises a working call "in under 10 minutes".

The documented snippet constructs the client like this:

```typescript
const t3n = new T3nClient({
  wasmComponent,
  handlers: {
    EthSign: metamask_sign(address, undefined, T3N_API_KEY),
  },
});
```

Running it verbatim:

```
T3nConfigError: T3nClient: `trustAnchor` is required and must be either a
TrustAnchor ({ expected_peer_ids, rtmr3_allowlist }) that pins the node's DKG
attestation, or the explicit opt-out { unsafe_trust_server: true }.
  code: 'CONFIG_ERROR', field: 'trustAnchor'
```

The SDK's own type docs confirm this is deliberate — "Required (no silent
default)". So the Quickstart was written against an older SDK and never
updated.

**Impact.** Total. Nobody completes step 3 of Quickstart by copying the
documented code. Every subsequent page assumes `t3n` exists.

**Fix used here** (`scripts/session.ts`) — the secure path, not the opt-out:

```typescript
import { fetchTrustedManifest, getEnvironment } from "@terminal3/t3n-sdk";

const t3n = new T3nClient({
  wasmComponent,
  trustAnchor: await fetchTrustedManifest(getEnvironment()),
  handlers: { EthSign: metamask_sign(address, undefined, apiKey) },
});
```

`fetchTrustedManifest` pulls the operator-signed manifest and verifies it
against a key pinned in the SDK, so it never returns an unverified anchor.

**Suggested fix.** Add `trustAnchor` to the Quickstart snippet using
`fetchTrustedManifest`, and mention `{ unsafe_trust_server: true }` only as an
explicitly-labelled local-dev fallback. Publishing the insecure opt-out as the
quick fix would be worse than the current bug.

---

## BUG-10 — `tenant.me()` does not exist

**Severity: Blocker** · Page: [Set Up Development Environment](https://docs.terminal3.io/developers/adk/get-started/prerequisites/set-up-dev-env)

The documented success check is:

```typescript
await tenant.me(); // throws if something's wrong; confirms the client actually works
```

It throws, but not for the reason implied:

```
TypeError: tenant.me is not a function
```

`me()` is not on `TenantClient`. It lives on the `tenant` namespace, so the
call is `tenant.tenant.me()`:

```
$ node -e "import('@terminal3/t3n-sdk').then(m=>{
    console.log(typeof m.TenantClient.prototype.me,
                typeof m.TenantNamespace.prototype.me)})"
undefined function
```

**This is the exact failure reported as the top question on the Superteam
listing for this bounty** — *"stuck at Set Up Development Environment, the
`await tenant.me()` line keeps throwing an error and the troubleshooting table
don't show a fix for it."* The fix is `tenant.tenant.me()`, and even that
then hits BUG-11 below.

**Suggested fix.** Correct the snippet to `tenant.tenant.me()`, and add a
`TypeError: tenant.me is not a function` row to Common errors — it is currently
the single most-asked question about this product and has no documented answer.

---

## BUG-11 — `TenantClient`'s control plane is wire-incompatible with the node

**Severity: Blocker** · SDK defect

With BUG-09 and BUG-10 worked around, `tenant.tenant.me()` still fails:

```
RpcError: Invalid action request: missing field `script_name` at line 1 column 105
  rpcMethod: 'action.execute', httpStatus: -32602
  requestId: ec5aa3b0-6ae9-4352-85bf-22edd2bcfff9
```

`TenantClient.controlPayload` builds:

```json
{ "contract_id": "tee:tenant/contracts", "contract_version": "1.26.0",
  "function_name": "me", "input": {} }
```

but the node's `action.execute` schema wants `script_name` / `script_version` —
the same field names the invoke walkthrough already uses for `T3nClient.execute`.
So the tenant path and the agent path disagree about the wire format, and the
tenant path is the one that's wrong.

**Impact.** Every `tenant.*`, `maps.*` and `contracts.*` helper routes through
`executeControl`, so the entire documented deployment path — register, create
maps, seed secrets — is unusable via the SDK's tenant helpers.

**Fix used here** (`scripts/control.ts`): bypass `TenantClient` and call
`t3n.executeAndDecode({ script_name, script_version, function_name, input })`
directly.

---

## BUG-12 — Unknown function names return `-32603 Internal error`

**Severity: Major** · Node defect

This one turns every other defect into a mystery, so it is worth fixing first.

Calling a function name the contract does not export returns a bare internal
error rather than a method-not-found:

```
me()                      -> -32603 Internal error [10d424b7-…]
claim()                   -> -32603 Internal error [481a5a62-…]
zzz-not-a-real-function   -> -32603 Internal error [b57b60c2-…]
```

Compare a *real* function given bad arguments, which is precise and helpful:

```
agent-auth-update -> -32602 role-assignments edge validation failed:
                     grants[0] invalid: invalid contract_id: z:deadbeef:noop
```

**Impact.** A name mismatch is indistinguishable from a broken node. The
Common errors page tells you a generic 500 means "retry once, then report with
`request_id`" — so the documented response to a client-side typo is to file a
support ticket. That is how BUG-10's real cause stayed unexplained.

Incidentally this asymmetry is what made the rest of this report possible: since
`-32602` means "function exists, arguments wrong" and `-32603` means "no such
function", the node can be probed for its own API surface. That is how the
correct names below were recovered.

**Suggested fix.** Return a distinct `-32601 Method not found` naming the
unknown function.

---

# Part 2 — SDK and node disagree on names

## BUG-13 — Function and field names differ between SDK and node

**Severity: Blocker** · SDK defect

Recovered by probing the node (see BUG-12). The SDK's names are on the left;
what the node actually accepts is on the right:

| Operation | SDK sends | Node expects |
|---|---|---|
| tenant identity | `me` | **`tenant-me`** |
| create map | `tail` | **`map_name`**, fully canonical |
| register contract | `tail` | **`name`**, fully canonical |
| register payload | `wasm` field | **multipart blob** via `executeWithBlob` |

Verified surface of `tee:tenant/contracts@1.26.0`:

```
absent           me
absent           claim
EXISTS (ok)      tenant-me
EXISTS (params)  map-create         -> missing field `map_name`
EXISTS (params)  map-entry-set      -> missing field `map_name`
EXISTS (params)  contract-register  -> missing field `name`
```

Bare tails are rejected outright:

```
canonical map name invalid: must start with `z:f39cbc5ab038a4b3fa862e025f971485690864e4:`
```

which independently settles BUG-06 below in favour of the full-name form.

The WASM is not a JSON field at all. Passing `{ name, version }` alone gives:

```
host:stash.persist-attached-blob: StashError::NoBlobAttached
```

It must be attached as multipart through `t3n.executeWithBlob(payload, blob)`.

**Working registration** (`scripts/deploy.ts`), which produced contract id 713:

```typescript
await t3n.executeWithBlob(
  {
    script_name: "tee:tenant/contracts",
    script_version: "1.26.0",
    function_name: "contract-register",
    input: { name: `z:${tid}:eligibility`, version: "0.1.1" },
  },
  new Blob([wasm], { type: "application/wasm" }),
);
// -> { name: "z:f39cbc…:eligibility", contract_id: 713 }
```

**Suggested fix.** Pin the SDK's tenant helpers to the node's contract and add
a round-trip test. The mismatch is mechanical and would be caught by a single
integration test against a live node.

---

## BUG-03 — `getScriptVersion` does not exist in the SDK

**Severity: Major** · Page: [SDK & API Reference](https://docs.terminal3.io/developers/adk/reference), [Invoke your TEE contract](https://docs.terminal3.io/developers/adk/get-started/walkthrough/invoke-contract)

The invoke walkthrough uses it twice:

```typescript
const scriptVersion = await getScriptVersion(getNodeUrl(), TENANT_SCRIPT);
const userContractVersion = await getScriptVersion(getNodeUrl(), "tee:user/contracts");
```

No such export exists in `@terminal3/t3n-sdk@4.39.1`. The real one is
`getContractVersion`, with an identical signature:

```typescript
declare function getContractVersion(rpcUrl: string, contractId: string): Promise<string>;
```

A plain rename fixes it. It works correctly once renamed — that call is how the
control-contract versions above were resolved.

---

# Part 3 — The Rust walkthrough

## BUG-01 — `tenant_did()` docs contradict the reference implementation, and the documented snippet does not compile

**Severity: Blocker** · Page: [Write your first TEE contract](https://docs.terminal3.io/developers/adk/get-started/walkthrough/write-contract)

The walkthrough instructs, in a code comment and again under Key Design Rules,
that the tenant DID is already a string and must **not** be hex-encoded:

```rust
// tenant_did() already returns the tid as a string — do not hex::encode it again.
// (Wrapping it in hex::encode a second time is a real bug some teams have hit:
// it silently produces a map path that doesn't match anything you created.)
let tid = tenant_context::tenant_did();
let map_name = format!("z:{}:secrets", tid);
```

Three independent contradictions:

**1. The WIT declares bytes, not a string** — `wit/deps/host-tenant-1.0.0/package.wit`
in the repo the walkthrough tells you to clone:

```wit
/// Tenant DID under which this contract is running. The 20-byte
/// raw `CompactDid` shape — same as user / organisation DIDs.
tenant-did: func() -> list<u8>;
```

**2. It therefore does not compile.** Applying the documented instruction to
Terminal 3's own reference contract (`repro/bug-01/`):

```
error[E0277]: `Vec<u8>` doesn't implement `std::fmt::Display`
   --> src/search.rs:182:51
    |
182 |     let map_name = alloc::format!("z:{}:secrets", tid);
    |                                      --           ^^^ `Vec<u8>` cannot be formatted
```

**3. The reference implementation does the opposite of the instruction.**
`z-tenant-flight/src/search.rs:182` and `src/booking.rs:171`:

```rust
let map_name = alloc::format!("z:{}:secrets", hex::encode(&tid));
```

Confirmed from two more directions: the register walkthrough builds the same
name in TypeScript with `tenantDid.slice("did:t3n:".length)`, and my live DID is
`did:t3n:f39cbc5ab038a4b3fa862e025f971485690864e4` — 40 hex characters, exactly
20 bytes hex-encoded.

**Impact.** A developer following the walkthrough faithfully gets a compile
error, and the obvious fix is the one thing the documentation has just told
them, in bold, is a known bug.

**Knock-on.** The same wrong rule is repeated on the Common errors page, so the
troubleshooting page confirms the mistake rather than correcting it:

> Double hex-encoding DID | Map lookups fail silently | Use `tenant_did()` return directly without re-encoding

**Suggested fix.** Correct the snippet to `hex::encode(&tid)`, restate the rule
as "returns raw bytes — hex-encode exactly once", and fix the Common errors row.

---

## BUG-02 — The documented `Cargo.toml` is missing the `hex` dependency

**Severity: Major** · Page: [Write your first TEE contract](https://docs.terminal3.io/developers/adk/get-started/walkthrough/write-contract)

The walkthrough's manifest lists three dependencies; the reference repo's has a
fourth, `hex = { version = "0.4", default-features = false, features = ["alloc"] }`,
and genuinely needs it (`hex::encode` at `src/search.rs:182`, `src/booking.rs:171`).

Copying the documented manifest gives
`E0433: failed to resolve: use of undeclared crate or module 'hex'` — a second
error stemming from the same under-tested sample as BUG-01.

**Suggested fix.** Add `hex`, or generate the doc's manifest from the reference
repo so the two cannot drift.

---

## BUG-06 — Two pages disagree on whether `kv_store::get` takes the bare tail or the full map name

**Severity: Major** · Pages: [Seed API key](https://docs.terminal3.io/developers/adk/tips/seed-api-key) vs [Write your first TEE contract](https://docs.terminal3.io/developers/adk/get-started/walkthrough/write-contract)

Seed-api-key says:

> At call time your contract reads it back with `kv_store::get("secrets", "duffel_api_key")`

Write-contract says the opposite, in bold:

> `kv-store` calls take the **full** `z:<tid>:<map>` name.

The node settles it — bare tails are rejected outright:

```
canonical map name invalid: must start with `z:f39cbc5ab038a4b3fa862e025f971485690864e4:`
```

So seed-api-key is wrong. Following it produces the `map not found` error whose
documented fix ("ensure map tails match exactly") points at the wrong cause.

**Suggested fix.** Correct the seed-api-key snippet, and add "used the bare tail
instead of `z:<tid>:<tail>`" to the `map not found` row in Common errors.

---

## BUG-07 — The tenant world's available host interfaces are never listed

**Severity: Minor** (documentation gap)

The walkthrough states a hard constraint without the information needed to
satisfy it:

> Import only the host interfaces you use... The host refuses to load a contract
> that imports an interface its tenant world does not provide.

`host-interfaces-2.1.0/package.wit` declares 17 interfaces, several of which look
directly useful to a tenant contract (`signing`, `token`, `state`,
`authorisation`, `contracts-call`). Nothing says which subset a tenant world
provides.

This shaped a real design decision: `z-tenant-eligibility` would naturally use
`signing::sign` to issue a portable, independently-verifiable attestation, but
since there is no way to know in advance whether that import is permitted, it
falls back to `kv-store::set-claims-digest` and the ledger receipt.

**Related.** Both my component and the reference one import ~14 `wasi:cli/*` and
`wasi:io/*` interfaces declared in neither `world.wit` — the Rust standard
library pulls them in, visible under `wasm-tools component wit`. Given the
"host refuses unknown imports" warning, it is worth stating that these are
expected.

---

## BUG-15 — Re-registering a contract silently orphans every map ACL

**Severity: Major** · Undocumented behaviour

Each `contract-register` mints a **new** `contract_id`, even for the same
contract name at a bumped version. Observed across four deploys of one
contract: 712 → 713 → 714 → 715.

Map ACLs are keyed by `contract_id`. The documented flow creates maps once,
using the id from the first registration, so the second deploy leaves every map
pointing at a contract that is no longer the one running:

```
contract error: kv read: kv_store.get on 'z:f39cbc…:attestations' read denied:
access denied: TenantContract(did:t3n:f39cbc…/714) cannot read map
"z:f39cbc…:attestations"   (req f3dc2b01-d584-4c8b-a52c-c8fd88e217f3)
```

Worse, `map-create` is idempotent — it returns "already exists" and does *not*
refresh the ACL — so the natural "just re-run the deploy script" reflex does
not fix it and produces no warning.

**Impact.** First deploy works; every subsequent one breaks at runtime with an
error that points at the map rather than at the re-registration that caused it.
The Common errors page lists `access denied: <caller> cannot <op> map` with the
fix "call `tenant.maps.update` to add contract to ACL", but never says that a
redeploy is what invalidates it, so it reads as a one-time setup mistake.

**Fix used here** (`scripts/deploy.ts`): call `map-update` on every deploy,
unconditionally, right after registering.

```typescript
await c.idempotent(map_name, () => c.exec("map-create", { map_name, visibility: "private", ...acl }));
await c.exec("map-update", { map_name, ...acl });   // create is a no-op on redeploy
```

**Suggested fix.** Either keep `contract_id` stable across versions of the same
contract name, or have `contract-register` re-point the ACLs of maps owned by
the previous id. Failing both, document it prominently in the register step.

---

## BUG-16 — The user-profile schema is undocumented, and the field is not `country`

**Severity: Major** · Documentation gap

Placeholder resolution is the headline feature — `{{profile.<field>}}` is how
PII reaches an external service without entering the contract. But no page
lists what `<field>` may be. The walkthrough shows `{{profile.first_name}}`,
`{{profile.last_name}}`, `{{profile.date_of_birth}}` and
`{{profile.verified_contacts.email.value}}` in passing, and that is the entire
published surface.

A natural marker like `{{profile.country}}` fails at runtime, after a
successful build, register and invoke:

```
contract error: eligibility verifier: user profile missing field: country
  (req a2a56613-dc9e-4107-9f9a-17cf14a2993f)
```

`user-upsert` rejects unknown keys and helpfully names them, which makes the
schema recoverable by probing:

```
REJECTED: citizenship, country, country_code, email, family_name, full_name,
          given_name, location, nationality, phone, region, residence
ACCEPTED: date_of_birth, first_name, last_name, residence_country, address,
          verified_contacts, gender
```

The field is **`residence_country`**. Note the trap: `country` is rejected as a
profile key *and* is the obvious name to reach for.

**Impact.** The failure surfaces only after a full build-register-invoke cycle,
and the message says the profile is missing a field rather than that the field
name is not one the schema has — so the natural reading is "populate your
profile", not "you named it wrong". Populating it with `country` then fails
separately at upsert.

**Suggested fix.** Publish the profile schema next to the placeholder docs, and
have `PlaceholderUnknown` distinguish "field not in schema" from "field in
schema but unset on this profile".

---

# Part 4 — Onboarding friction

## BUG-08 — The walkthrough needs three credentials; the claim page issues one

**Severity: Major** · Page: [Invoke your TEE contract](https://docs.terminal3.io/developers/adk/get-started/walkthrough/invoke-contract)

Step 4 introduces two further credentials with no explanation of their origin:

```typescript
const agentKey = process.env.AGENT_KEY!; // never reuse your tenant's T3N_API_KEY
const userKey  = process.env.USER_KEY!;  // stands in for the real data owner's own key
```

The claim page issues exactly one key and one DID, and the comment explicitly
forbids reusing it. Common errors hints that extra identities need separate
funding ("Agent identities need separate funding; contact devrel@terminal3.io"),
but that is on a troubleshooting page rather than in the step that needs it.

**Suggested fix.** State how to obtain agent and user credentials in step 4, and
lead with the lighter self-call variant the page already documents further down,
so the walkthrough is completable with the one key you were issued.

---

## BUG-14 — Two different credential formats share one name

**Severity: Minor**

`DiscoverOptions.apiKey` documents an opaque key relayed in a header:

> The agent's opaque API key (`t3n_key_<...>`), relayed verbatim in the
> `X-T3N-Api-Key` header.

The claim page issues a `0x`-prefixed 64-hex-character value, which is signing
key material consumed by `eth_get_address(key)` — a different kind of secret
entirely. Passing the claim-page credential to the discover helpers fails:

```
discoverWhoami        -> discover request failed: server returned HTTP 400
discoverListContracts -> discover request failed: server returned HTTP 400
```

Both are called "the API key" in the docs.

**Suggested fix.** Name them distinctly (signing key vs. agent API key) and say
which one the claim page issues.

---

## BUG-04 — `idx:_tenants` admission is referenced but never explained

**Severity: Minor** (documentation gap — *downgraded after testing*)

The `TenantClient` step warns:

> The DID must equal the one admitted as a tenant in `idx:_tenants`.

Nothing explains what `idx:_tenants` is, how a DID gets admitted, or how to
check. I initially rated this a blocker and suspected it was the cause of the
`tenant.me()` reports. **That was wrong, and worth recording as such:** once
BUG-09/10/11/13 were worked around, `tenant-me` confirmed the claim page had
admitted the DID all along:

```json
{ "tenant": "did:t3n:f39cbc5ab038a4b3fa862e025f971485690864e4",
  "label": "testnet-dev", "status": "active",
  "quotas": { "max_contracts": 10, "max_maps": 50, "max_wasm_bytes": 1048576, … } }
```

So admission is automatic and this is a documentation gap, not a defect. It is
kept in the report because the warning sends people looking for a provisioning
step that does not exist, which is its own cost when the real errors are
elsewhere.

**Suggested fix.** State that claiming a key admits your DID automatically, and
show the `tenant-me` output as the way to confirm it.

---

## BUG-05 — `npm install` emits an EBADENGINE warning the docs never mention

**Severity: Minor** · Page: [Quickstart](https://docs.terminal3.io/developers/adk/get-started/quickstart)

```
npm WARN EBADENGINE   required: { node: '^22.20 || ^24.12 || >=25' },
npm WARN EBADENGINE   current: { node: 'v20.19.2', npm: '9.2.0' }
```

The SDK's own `engines` is `">=18.0.0"`, so the constraint comes from a
transitive dependency. Everything in this report was done on Node 20 with no
issue traceable to it.

**Impact.** Low, but it is the first output a new developer sees, and Quickstart
lists no Node prerequisite at all — so the natural response is to go install a
different Node before finding out it was unnecessary.

**Suggested fix.** State a supported Node range, and note that this warning is
benign.

---

## Note on the environment, not on Terminal 3

`cargo install wasm-tools` failed twice on `Could not connect to server
(index.crates.io)`, and `fetchTrustedManifest` intermittently failed with
`fetch failed`, both from local network flakiness rather than anything in the
ADK. Scripts in this repo retry the manifest fetch for that reason. Recorded
only so the transcript is not confusing.
