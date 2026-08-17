> ## Documentation Index
> Fetch the complete documentation index at: https://docs.terminal3.io/llms.txt
> Use this file to discover all available pages before exploring further.

# 1. Write your TEE contract

Clone the reference implementation now rather than typing the Rust code by hand — it's a **separate project** from the Node/TypeScript app you built in Quickstart, so put it in its own folder alongside it, not inside it:

```bash theme={null}
cd ..                                                        # out of my-t3n-app, back to a shared parent folder
git clone https://github.com/Terminal-3/z-tenant-flight.git
cd z-tenant-flight
```

Below is a walkthrough of the pieces inside that repo — change the host calls and flight-specific logic to match your needs once you understand them.

A TEE contract is a Rust crate compiled to a WASM **component**. It exports its functions through a `contracts` WIT interface and imports only the host capabilities it needs.

<Note>
  Key concepts and tips before starting:

  * [Storage namespace](/t3n/how-t3n-works/z-namespace)
  * [Host API](/t3n/how-t3n-works/host-api)
  * [Create Tenant KV maps](/developers/adk/tips/create-kv-maps)
  * [Capabilities come from your WIT imports](/developers/adk/tips/capabilities-from-wit-import)
</Note>

## Repository Structure

```
z-tenant-flight/
├── src/
│   ├── lib.rs          ← wit-bindgen entry point + Guest impl that dispatches to each fn
│   ├── search.rs       ← search-offers — Duffel search (no PII)
│   └── booking.rs      ← book-offer — Duffel booking (PII via http-with-placeholders)
├── wit/
│   ├── world.wit       ← the world your contract exports + the host interfaces it imports
│   └── deps/           ← vendored host interface packages (host-interfaces, host-tenant)
└── Cargo.toml
```

The packages under `wit/deps/` define the host ABI your contract links against — vendor the versions your target cluster provides (here, `host-interfaces-2.1.0/` and `host-tenant-1.0.0/`).

## Files

### world.wit — declare your interface + host imports

```wit theme={null}
package z:tenant-flight@0.4.0;

world tenant-flight {
  import host:tenant/tenant-context@1.0.0;
  import host:interfaces/logging@2.1.0;
  import host:interfaces/kv-store@2.1.0;
  import host:interfaces/http@2.1.0;                    // search (no PII)
  import host:interfaces/http-with-placeholders@2.1.0;  // booking (PII via placeholders)

  export contracts;
}

interface contracts {
  // Uniform 3-field envelope used by every node-callable contract.
  //   input        — JSON arguments for this function, as bytes
  //   user-profile — None for tenant contracts (profile is resolved host-side)
  //   context      — node-minted DynamicContext (trusted), as bytes
  record generic-input {
    input:        option<list<u8>>,
    user-profile: option<list<u8>>,
    context:      option<list<u8>>,
  }

  // One func per operation. Each takes generic-input and returns JSON bytes on
  // success, or an error string. There is no central `dispatch` function and no
  // `ContractError` enum — the function name *is* the export.
  search-offers: func(req: generic-input) -> result<list<u8>, string>;
  book-offer:    func(req: generic-input) -> result<list<u8>, string>;
}
```

[The interfaces you import here are your contract's entire capability set](/developers/adk/tips/capabilities-from-wit-import) — there is no separate manifest. The host links your contract against the matching tenant world and refuses to load it if it imports an interface that world does not provide.

### Cargo.toml — compile to a WASM component

```toml theme={null}
[package]
name = "z-tenant-flight"
version = "0.4.1"
edition = "2021"

# crate-type cdylib is what makes the wasm32-wasip2 target emit a WASM
# *component* (not a bare module). Keep "lib" too so the business logic
# stays unit-testable natively.
[lib]
crate-type = ["cdylib", "lib"]

[dependencies]
# wit-bindgen's macro generates the bindings from wit/ at compile time.
wit-bindgen = { version = "0.49", default-features = false, features = ["macros", "realloc"] }
serde = { version = "1.0", default-features = false, features = ["derive", "alloc"] }
serde_json = { version = "1.0", default-features = false, features = ["alloc"] }

# Small, self-contained artifact — keeps registration under the size cap.
[profile.release]
opt-level = "s"
lto = true
codegen-units = 1
strip = true
```

### lib.rs — generate bindings + dispatch to each function

```rust theme={null}
wit_bindgen::generate!({
    world: "tenant-flight",
    path: "wit",
    additional_derives: [
        serde::Deserialize,
        serde::Serialize,
    ],
    generate_all,
});

mod booking;
mod search;

struct Component;

// Implement the exported `contracts` interface. Each generated method unwraps
// the input bytes and hands off to the module that does the work.
#[cfg(target_arch = "wasm32")]
impl exports::z::tenant_flight::contracts::Guest for Component {
    fn search_offers(req: exports::z::tenant_flight::contracts::GenericInput) -> Result<Vec<u8>, String> {
        let input = req.input.ok_or("search-offers: missing input")?;
        search::search_offers(&input)
    }

    fn book_offer(req: exports::z::tenant_flight::contracts::GenericInput) -> Result<Vec<u8>, String> {
        let input = req.input.ok_or("book-offer: missing input")?;
        booking::book_offer(&input)
    }
}

#[cfg(target_arch = "wasm32")]
export!(Component);
```

The host bindings live under `crate::host::*` and the exported interface under `crate::exports::*` — both generated by the macro from `wit/`.

### search.rs — `search_offers` (synchronous `http`, no PII)

The `http` interface is synchronous: the response is available before the call returns. Build a `Request` with a `Verb`, headers, and an optional payload.

```rust theme={null}
use crate::host::interfaces::{http as http_iface, logging};

let resp = http_iface::call(&http_iface::Request {
    method: http_iface::Verb::Post,
    url: format!("{DUFFEL_BASE}/air/offer_requests?return_offers=false"),
    headers: Some(duffel_headers(&api_key)),         // Vec<(String, String)>
    payload: Some(serde_json::to_vec(&offer_request_body).map_err(|e| e.to_string())?),
})
.map_err(|e| format!("duffel offer-request: {e}"))?;

if resp.code != 201 {
    let body = String::from_utf8_lossy(&resp.payload);
    return Err(format!("Duffel offer-request failed: HTTP {} — {body}", resp.code));
}
let _ = logging::info("offer request created");
// resp.payload holds the response bytes — parse with serde_json.
```

[Outbound HTTP is authorized by the user, not the contract](/developers/adk/tips/outbound-http-auth-by-user) — the hosts a contract may reach are resolved per-call from the calling user's grant.

### booking.rs — `book_offer` (PII via `http-with-placeholders`)

For calls that carry user PII, use `http-with-placeholders`. Put `{{profile.<field>}}` markers in the request body; the host resolves them from the calling user's profile at dispatch time, so plaintext PII never enters WASM memory.

```rust theme={null}
use crate::host::interfaces::http_with_placeholders as hwp;
use serde_json::json;

let order_body = json!({
    "data": {
        "type": "instant",
        "selected_offers": [req.offer_id],
        "passengers": [{
            "id": req.passenger_id,                              // opaque Duffel id — not PII
            // Resolved host-side from the user's profile (PII never enters WASM):
            "given_name":  "{{profile.first_name}}",
            "family_name": "{{profile.last_name}}",
            "born_on":     "{{profile.date_of_birth}}",
            "email":       "{{profile.verified_contacts.email.value}}",
        }],
        "payments": [{ "type": "balance", "amount": req.total_amount, "currency": req.total_currency }]
    }
});

let resp = hwp::call(&hwp::Request {
    method: hwp::Verb::Post,
    url: format!("{DUFFEL_BASE}/air/orders"),
    headers: Some(duffel_headers(&api_key)),
    payload: Some(serde_json::to_vec(&order_body).map_err(|e| e.to_string())?),
})
.map_err(|e| format!("duffel create-order: {}", format_http_error(e)))?;
```

`hwp::call` returns a typed `HttpError` so failures never leak resolved PII — match on it for clear messages:

```rust theme={null}
fn format_http_error(e: hwp::HttpError) -> String {
    match e {
        hwp::HttpError::EgressDenied(host)        => format!("egress denied for host {host}"),
        hwp::HttpError::PlaceholderDenied(marker) => format!("placeholder not permitted: {marker}"),
        hwp::HttpError::PlaceholderUnknown(field) => format!("user profile missing field: {field}"),
        hwp::HttpError::PlaceholderNoUserContext  => "no user context bound for placeholder resolution".to_string(),
        hwp::HttpError::UpstreamError(reason)     => format!("upstream: {reason}"),
    }
}
```

See [Placeholders in outbound calls](/developers/adk/tips/placeholders-outbound-calls).

### Reading secrets from the `secrets` KV map

The API key is read from the tenant's `secrets` KV map at runtime. [The key is seeded by the tenant SDK](/developers/adk/tips/seed-api-key) before the contract runs — there is no `set-credentials` host function. `kv-store` calls take the **full** `z:<tid>:<map>` name; build it from `tenant-context` at runtime (the host enforces the prefix):

```rust theme={null}
use crate::host::{interfaces::kv_store, tenant::tenant_context};

fn get_api_key() -> Result<String, String> {
    // tenant_did() already returns the tid as a string — do not hex::encode it again.
    // (Wrapping it in hex::encode a second time is a real bug some teams have hit:
    // it silently produces a map path that doesn't match anything you created.)
    let tid = tenant_context::tenant_did();
    let map_name = format!("z:{}:secrets", tid);
    let bytes = kv_store::get(&map_name, b"duffel_api_key")
        .map_err(|e| format!("kv read: {e}"))?
        .ok_or("duffel_api_key not found in z:<tid>:secrets — populate it via the tenant SDK before use")?;
    String::from_utf8(bytes).map_err(|e| e.to_string())
}
```

## Key Design Rules

* Export functions on the `contracts` interface. Each takes `generic-input` and returns `result<list<u8>, string>` — JSON bytes on success, an error string on failure. There is **no** `dispatch` function and **no** `ContractError` enum.
* `kv-store` calls take the **full** `z:<tid>:<map>` name. Build it at runtime from `tenant_context::tenant_did()` — that value is already the string form, don't re-encode it. The host enforces the prefix. The map must exist (created and populated by the tenant SDK) before the contract reads or writes it.
* Import only the host interfaces you use — they are your contract's entire capability set. The host refuses to load a contract that imports an interface its tenant world does not provide.
* `http::call` is synchronous; you get the response back before the function returns. Its egress is authorized per-call by the calling user's grant.
* For calls carrying user PII, use `http-with-placeholders`: put `{{profile.<field>}}` markers in the request and the host resolves them inside the enclave, so plaintext PII never enters your contract.
