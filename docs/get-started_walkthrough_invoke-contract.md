> ## Documentation Index
> Fetch the complete documentation index at: https://docs.terminal3.io/llms.txt
> Use this file to discover all available pages before exploring further.

# 4. Invoke your TEE contract

Agents call your contract via the same `execute` transport as any other T3N contract. The only difference is the `script_name` starts with `z:<tid>:`.

<Note> **Agents authenticate as themselves, not as tenants.** Like every T3N session, an agent reads its own DID back from the authenticated session — there's nothing tenant-specific to set.</Note>

## 1. Set up the agent's identity

An agent is a separate authenticated session with its own key — it is not the tenant and not the user. Build it the same way you built `t3n` in [Quickstart](/developers/adk/get-started/quickstart), but with its own credential:

```typescript theme={null}
import {
  T3nClient,
  loadWasmComponent,
  createEthAuthInput,
  eth_get_address,
  metamask_sign,
  getScriptVersion,
  getNodeUrl,
} from "@terminal3/t3n-sdk";

const agentKey = process.env.AGENT_KEY!; // a separate credential — never reuse your tenant's T3N_API_KEY
const agentAddress = eth_get_address(agentKey);

const agentClient = new T3nClient({
  wasmComponent,   // node URL resolved from setEnvironment() — see set-up-dev-env
  handlers: {
    EthSign: metamask_sign(agentAddress, undefined, agentKey),
  },
});

await agentClient.handshake();
const agentAuth = await agentClient.authenticate(createEthAuthInput(agentAddress));
const agentDid = agentAuth.value; // reused below when the user authorizes this agent

const TENANT_SCRIPT = `z:${tenantDid.slice("did:t3n:".length)}:travel-contracts`;
const scriptVersion = await getScriptVersion(getNodeUrl(), TENANT_SCRIPT);
```

## 2. Authorize the contract's egress (as the user)

Before any function that makes an outbound HTTP call can run, the **user (data owner)** must authorize it. A tenant contract's allowed hosts are resolved per-call from the user's authorization grant — not from the contract.

In this walkthrough you're standing in for the user yourself, so build a third session — `userClient` — with its own credential, exactly like `t3n` and `agentClient` above:

```typescript theme={null}
const userKey = process.env.USER_KEY!; // stands in for the real data owner's own key
const userAddress = eth_get_address(userKey);

const userClient = new T3nClient({
  wasmComponent,
  handlers: {
    EthSign: metamask_sign(userAddress, undefined, userKey),
  },
});

await userClient.handshake();
await userClient.authenticate(createEthAuthInput(userAddress));
```

Now the user signs an `agent-auth-update` scoping the agent to your contract, its functions, and the hosts it may reach:

```typescript theme={null}
// Signed by the USER (data owner), not the agent.
const userContractVersion = await getScriptVersion(getNodeUrl(), "tee:user/contracts");
await userClient.execute({
  script_name: "tee:user/contracts",
  script_version: userContractVersion,
  function_name: "agent-auth-update",
  input: {
    agents: [{
      agentDid: agentDid,                               // from step 1
      scripts: [{
        scriptName: TENANT_SCRIPT,                      // z:<tid>:travel-contracts, from step 1
        versionReq: scriptVersion,
        functions: ["search-offers", "book-offer"],
        allowedHosts: ["api.duffel.com"],               // hosts the contract may dial
      }],
    }],
  },
});
```

For a **direct (self) call** — where the user invokes the contract themselves rather than through a separate agent — set `agentDid` to the user's own DID (a self-grant) instead of building a separate `agentClient`. Without a matching grant the contract still runs, but any outbound call is denied with `host/http.egress_denied`. See [Outbound HTTP is authorized by the user, not the contract](/developers/adk/tips/outbound-http-auth-by-user).

## 3. Invoke your contract (as the agent)

With the grant in place, the agent can call the contract's functions:

```typescript theme={null}
// 1. Search for offers (no PII)
const search = await agentClient.executeAndDecode({
  script_name: TENANT_SCRIPT,
  script_version: scriptVersion,
  function_name: "search-offers",
  input: { origin: "LHR", destination: "JFK", departure_date: "2026-07-15", cabin_class: "economy", adult_count: 1 },
});
const offer = search.offers[0];

// 2. Book the chosen offer. No PII in the input — name, DOB and email are
//    resolved host-side from the user's profile via http-with-placeholders,
//    and only when the user's grant authorizes this agent (see the grant above).
const booking = await agentClient.executeAndDecode({
  script_name: TENANT_SCRIPT,
  script_version: scriptVersion,
  function_name: "book-offer",
  input: {
    offer_id:       offer.id,
    passenger_id:   offer.passenger_ids[0],  // opaque Duffel id from search — not PII
    total_amount:   offer.total_amount,
    total_currency: offer.total_currency,
  },
});
// booking.pnr → the flight booking reference. The passenger's name never left the enclave.
```
