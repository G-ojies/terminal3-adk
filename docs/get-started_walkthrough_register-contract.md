> ## Documentation Index
> Fetch the complete documentation index at: https://docs.terminal3.io/llms.txt
> Use this file to discover all available pages before exploring further.

# 3. Register your TEE contract

Registration uploads the WASM component you built in [Step 2](/developers/adk/get-started/walkthrough/build-contract) and gives it a tenant-local name. After this step, T3N knows about your contract and gives you a numeric `contract_id` that you use when creating map ACLs.

This code goes back in `quickstart.ts` — the Node/TypeScript project from Quickstart — not in the `z-tenant-flight` Rust repo. Append it to the bottom, after the `TenantClient` code from [Set Up Dev Env](/developers/adk/get-started/prerequisites/set-up-dev-env).

Before you run this code, make sure you have:

* An authenticated `TenantClient` named `tenant`. If you have not created one yet, complete [Quickstart](/developers/adk/get-started/quickstart) and [Set Up Dev Env](/developers/adk/get-started/prerequisites/set-up-dev-env) first.
* A compiled WASM file at `target/wasm32-wasip2/release/z_tenant_flight.wasm`, **inside the separate `z-tenant-flight` folder you cloned** in [Write your TEE contract](/developers/adk/get-started/walkthrough/write-contract) — not inside your Node project.
* Your `tenantDid`, for example `did:t3n:abcdef0123456789abcdef0123456789abcdef01`.

## Choose a contract tail

The `tail` is the local name of your contract inside your tenant namespace. Pass only the part after `z:<tid>:`. For example, the tail `travel-contracts` becomes:

```text theme={null}
z:<tid>:travel-contracts
```

Do not include `z:<tid>:` in the `tail`; the SDK and host derive that from the authenticated tenant.

A tail may contain letters, digits, `_`, `-`, and `.` — but **not** `/`. The SDK rejects slashes (`tail must match /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,127}$/`).

Pick a stable tail for each contract you plan to maintain. When you register a new build at the same tail, increase the `version` value; changing the tail creates a separate contract entry.

<Note>
  Keep tails short and simple (a few words, hyphen-separated) rather than long or descriptive. The full canonical name (`z:<tid>:<tail>`) gets reused downstream in places like delegation grants, and a handful of teams have hit unexpectedly-strict length limits further down the pipeline when using long tails. The 128-character limit above is enforced at registration; treat it as a ceiling, not a target.
</Note>

## Register the WASM

```typescript theme={null}
import { readFile } from "fs/promises";

// Path to the .wasm file INSIDE your cloned z-tenant-flight folder, relative
// to quickstart.ts. Adjust this if you cloned it somewhere else.
const WASM_PATH = "../z-tenant-flight/target/wasm32-wasip2/release/z_tenant_flight.wasm";
const CONTRACT_TAIL = "travel-contracts";
const CONTRACT_VERSION = "0.1.0";

const wasmBytes = await readFile(WASM_PATH);

const result = await tenant.contracts.register({
  tail: CONTRACT_TAIL,
  version: CONTRACT_VERSION,
  wasm: wasmBytes,
});

// This numeric ID is required in the next setup step when you create map ACLs.
const contractId = result.contract_id;
const tenantId = tenantDid.slice("did:t3n:".length);
const scriptName = `z:${tenantId}:${CONTRACT_TAIL}`;

console.log(`registered ${scriptName} as contract id ${contractId}`);
```

`WASM_PATH` above assumes you cloned `z-tenant-flight` as a sibling folder next to your Node project (i.e. `../z-tenant-flight/...` from `quickstart.ts`) — if you put it somewhere else, update the path accordingly.

<Note>
  Registration does not run your code, create maps, seed secrets, or grant outbound HTTP access. It only stores the component and records the versioned contract entry for your tenant.
</Note>

## What T3N stores

The register payload is just `{ tail, version, wasm }`; there is no manifest.

Host-side, T3N:

1. Stores the WASM blob in content-addressed storage.
2. Allocates a numeric `ContractId`.
3. Records the contract under your tenant registry.

Your contract's capabilities come from the host interfaces it imports in `world.wit`, not from this registration request. See [Capabilities come from your WIT imports](/developers/adk/tips/capabilities-from-wit-import).

Outbound hosts are also not declared here. They come from the calling user's authorization grant at invoke time. See [Outbound HTTP is authorized by the user, not the contract](/developers/adk/tips/outbound-http-auth-by-user).

<Warning>
  **Registering a new version can silently affect calls that pin an older one.** Several teams have found that once a higher version is registered for a tail, invocations continue to route to the *latest* registered version — even ones that explicitly pass an older `version` in `contracts.execute()`. If you rely on pinning a specific version, re-verify that pinned calls still behave as expected after any re-registration. There is also currently no API to fetch a tail's *current* `contract_id` after re-registering — if you created map ACLs scoped to the old `contract_id`, re-registration can leave them pointing at a stale ID. Keep a record of each `contract_id` your tenant has ever registered so you can re-grant map access if this happens.
</Warning>

## First-run troubleshooting

| Error or symptom                                                                                                                | What it usually means                                                                                                                                                                 | What to do                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENOENT: no such file or directory`                                                                                             | The WASM path is wrong, or the contract was not built yet — a common cause is `WASM_PATH` pointing into your Node project instead of across to the separate `z-tenant-flight` folder. | Re-run Step 2 and confirm the path with `ls -lh <path-to-z-tenant-flight>/target/wasm32-wasip2/release/*.wasm`, then check `WASM_PATH` is relative to where `quickstart.ts` actually runs from. |
| `tenant not found`                                                                                                              | The session DID does not match an admitted tenant — you constructed or derived `tenantDid` instead of reading it from the session.                                                    | Read `tenantDid` from `did.value` after authenticating (see [Quickstart](/developers/adk/get-started/quickstart)), then rebuild `TenantClient` with it. Confirm with `tenant.me()`.             |
| `version <x> is not higher than current version <y>`                                                                            | You already registered this tail with the same or a higher version.                                                                                                                   | Bump `CONTRACT_VERSION`, for example from `0.1.0` to `0.1.1`.                                                                                                                                   |
| The contract registers, but later cannot read `secrets`                                                                         | The map does not exist yet, or its ACL does not include this `contractId`.                                                                                                            | Use the returned `contractId` when creating the `secrets` map ACLs.                                                                                                                             |
| A previously-working pinned-version call starts failing or behaving unexpectedly                                                | A newer version was registered for the same tail after the pinned call was written.                                                                                                   | See the version-shadowing warning above — re-verify pinned calls after any re-registration.                                                                                                     |
| A long contract tail is rejected further downstream (e.g. when building a delegation grant), even though registration succeeded | Some downstream operations enforce a shorter length limit on the full canonical name than registration does.                                                                          | Prefer a short tail from the start — see the note above.                                                                                                                                        |

The contract is now registered. It still cannot complete the full end-to-end flow until the [maps](/developers/adk/tips/create-kv-maps) and [secrets](/developers/adk/tips/seed-api-key) it reads at runtime exist.
