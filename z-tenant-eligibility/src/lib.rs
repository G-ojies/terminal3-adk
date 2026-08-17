//! z-tenant-eligibility v0.1.0 — reusable confidential eligibility attestations.
//!
//! Demonstrates a z-space tenant pattern the flight showcase does not cover:
//! answering a question *about* a user's PII, caching the answer, and never
//! holding the PII itself.
//!
//!   - `check-eligibility`: resolves the calling user from
//!     `tenant-context.calling-user-did()`, evaluates a tenant-defined policy
//!     by calling an external verifier through `http-with-placeholders`, and
//!     stores the resulting attestation. The request body carries
//!     `{{profile.date_of_birth}}` / `{{profile.country}}` markers which the
//!     host substitutes on its own stack at dispatch time — plaintext PII
//!     never enters this contract's WASM memory, and is never returned.
//!   - `verify-attestation`: re-derives the SHA-256 of the stored record and
//!     compares it to a presented digest, so a third party can check an
//!     attestation without re-running the policy or touching the profile.
//!
//! # Why this is worth building on T3N specifically
//!
//! On a normal stack, "is this user over 18 and in a permitted country?"
//! requires collecting a date of birth and an address, which means every
//! tenant asking the question ends up storing regulated data they did not want
//! and cannot easily delete. Here the question is evaluated inside the
//! enclave, the answer is the only thing that persists, and the answer is
//! reusable: a second call inside the validity window returns `reused: true`
//! and makes no outbound call at all, so the user's profile is read once per
//! policy per window rather than once per check.
//!
//! `kv-store.set-claims-digest` binds the attestation's SHA-256 into the
//! transaction's Merkle leaf, so a holder can prove offline from the ledger
//! receipt that this cluster issued exactly this attestation.
//!
//! # Host-capability requirements
//!
//! Declare in manifest:
//! ```json
//! {
//!   "host_capabilities": [
//!     "kv_store", "logging", "tenant_context", "http_with_placeholders"
//!   ]
//! }
//! ```
//!
//! # Setup
//!
//! Before first use the tenant SDK must create three KV maps and populate two
//! of them (see `../scripts/register.ts`):
//! ```text
//! z:<tid>:secrets       verifier_api_key = "<key for the eligibility verifier>"
//! z:<tid>:policies      <policy_id>      = {"min_age":18,"allowed_countries":[...],...}
//! z:<tid>:attestations  (written by this contract)
//! ```
#![warn(clippy::style, missing_debug_implementations)]
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

extern crate alloc;

pub const CONTRACT_VERSION: &str = "0.1.0";

wit_bindgen::generate!({
    world: "tenant-eligibility",
    path: "wit",
    additional_derives: [
        serde::Deserialize,
        serde::Serialize,
    ],
    generate_all,
});

mod attest;
mod policy;
mod verify;

struct Component;

#[cfg(target_arch = "wasm32")]
impl exports::z::tenant_eligibility::contracts::Guest for Component {
    fn check_eligibility(
        req: exports::z::tenant_eligibility::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("check-eligibility: missing input")?;
        attest::check_eligibility(&input)
    }

    fn verify_attestation(
        req: exports::z::tenant_eligibility::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("verify-attestation: missing input")?;
        verify::verify_attestation(&input)
    }
}

#[cfg(target_arch = "wasm32")]
export!(Component);

#[cfg(test)]
mod tests {
    use super::CONTRACT_VERSION;

    #[test]
    fn contract_version_is_semver() {
        let parts: Vec<&str> = CONTRACT_VERSION.split('.').collect();
        assert_eq!(parts.len(), 3, "CONTRACT_VERSION must be MAJOR.MINOR.PATCH");
        for part in parts {
            assert!(part.parse::<u32>().is_ok(), "each part must be a number");
        }
    }
}
