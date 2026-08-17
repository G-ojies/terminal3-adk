//! Shared types, PII-safety validation, and the attestation digest.
//!
//! Everything in this module is target-independent so it can be unit tested
//! natively with `cargo test` — no host imports, no WASM required. The host
//! interfaces only appear in `attest.rs` / `verify.rs`.

use alloc::string::{String, ToString};
use alloc::vec::Vec;
use sha2::{Digest, Sha256};

/// Tenant-authored policy, stored as JSON in `z:<tid>:policies` under the
/// policy id. Authored once by the tenant, never by the calling user.
#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct Policy {
    /// Minimum age in whole years. The contract never learns the user's actual
    /// age — this bound is sent to the verifier, which answers yes/no.
    pub min_age: u32,
    /// ISO-3166-1 alpha-2 codes the policy admits. Empty means "any country".
    #[serde(default)]
    pub allowed_countries: Vec<String>,
    /// How long an issued attestation stays valid, in seconds.
    pub ttl_secs: u64,
    /// Verifier endpoint. Must be on the contract's `http_allow_list`, or the
    /// host refuses the call with `egress-denied`.
    pub verifier_url: String,
}

/// Request accepted by `check-eligibility`.
///
/// Deliberately carries no subject field: the subject is taken from
/// `calling-user-did()` so a caller cannot mint an attestation for another
/// user by passing someone else's identifier.
#[derive(serde::Deserialize, Debug)]
pub struct CheckReq {
    pub policy_id: String,
}

/// Request accepted by `verify-attestation`.
#[derive(serde::Deserialize, Debug)]
pub struct VerifyReq {
    pub policy_id: String,
    /// Hex-encoded subject DID, as returned in an earlier attestation.
    pub subject: String,
    /// Hex-encoded SHA-256 of the attestation being presented.
    pub digest: String,
}

/// What the verifier is expected to return. Note there is no field here that
/// could carry PII back — if the verifier returns extra fields they are
/// dropped by serde rather than forwarded to the caller.
#[derive(serde::Deserialize, Debug)]
pub struct VerifierResp {
    pub eligible: bool,
    #[serde(default)]
    pub reason_code: Option<String>,
}

/// The attestation record. This is both what gets persisted in
/// `z:<tid>:attestations` and what crosses the WIT boundary to the caller.
///
/// Contains no PII: the subject is an opaque DID, and the outcome is a
/// boolean plus a coarse machine-readable reason code.
#[derive(serde::Deserialize, serde::Serialize, Debug, Clone, PartialEq)]
pub struct Attestation {
    pub policy_id: String,
    /// Hex-encoded CompactDid of the subject.
    pub subject: String,
    pub eligible: bool,
    pub reason_code: String,
    /// Cluster timestamp (seconds) at issuance — not wall clock, so replicas agree.
    pub issued_at: u64,
    pub expires_at: u64,
}

/// Response shape for `check-eligibility`.
#[derive(serde::Serialize, Debug)]
pub struct CheckResp {
    #[serde(flatten)]
    pub attestation: Attestation,
    /// Hex SHA-256 of the attestation, to present later to `verify-attestation`.
    pub digest: String,
    /// True when a still-valid attestation already existed, meaning no
    /// outbound call was made and the user's profile was not read at all.
    pub reused: bool,
}

/// Response shape for `verify-attestation`.
#[derive(serde::Serialize, Debug)]
pub struct VerifyResp {
    pub valid: bool,
    pub reason_code: String,
    pub expires_at: u64,
}

/// Reason codes. Coarse by design — a fine-grained reason would leak
/// information about the underlying profile.
///
/// This is the full vocabulary a relying party may see. Some values are only
/// ever produced by the external verifier and passed through, so they are not
/// constructed anywhere in this crate.
#[allow(dead_code)]
pub mod reason {
    pub const OK: &str = "ok";
    pub const AGE_BELOW_MINIMUM: &str = "age_below_minimum";
    pub const COUNTRY_NOT_PERMITTED: &str = "country_not_permitted";
    pub const PROFILE_INCOMPLETE: &str = "profile_incomplete";
    pub const EXPIRED: &str = "expired";
    pub const NOT_FOUND: &str = "not_found";
    pub const DIGEST_MISMATCH: &str = "digest_mismatch";
}

/// Canonical SHA-256 over an attestation.
///
/// Hashes the serde JSON encoding of the struct, whose field order is fixed by
/// the struct definition, so the same attestation always produces the same
/// digest across nodes and runs.
pub fn digest_of(att: &Attestation) -> Result<[u8; 32], String> {
    let bytes = serde_json::to_vec(att).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(hasher.finalize().into())
}

/// Hex form of [`digest_of`].
pub fn digest_hex(att: &Attestation) -> Result<String, String> {
    Ok(hex::encode(digest_of(att)?))
}

/// KV key for an attestation. `subject` is already hex, and `policy_id` is
/// validated to exclude `|`, so the two cannot be confused for one another.
pub fn attestation_key(policy_id: &str, subject_hex: &str) -> Vec<u8> {
    alloc::format!("{policy_id}|{subject_hex}").into_bytes()
}

/// Reject policy ids that could collide in the composite KV key or smuggle a
/// placeholder marker into an outbound request body.
pub fn validate_policy_id(policy_id: &str) -> Result<(), String> {
    if policy_id.is_empty() || policy_id.len() > 128 {
        return Err("policy_id must be 1..=128 characters".to_string());
    }
    if !policy_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(
            "policy_id may contain only ASCII alphanumerics, '-', '_' and '.'".to_string(),
        );
    }
    Ok(())
}

/// Refuse any request that carries inline PII.
///
/// The whole point of this contract is that PII arrives through host-resolved
/// placeholders, never as a contract argument. If a caller passes a profile
/// field directly, that is a misuse worth failing loudly rather than silently
/// accepting a less private path.
pub fn reject_inline_pii(raw: &[u8]) -> Result<(), String> {
    const FORBIDDEN: [&str; 8] = [
        "date_of_birth",
        "dob",
        "given_name",
        "family_name",
        "first_name",
        "last_name",
        "passport",
        "national_id",
    ];
    let text = core::str::from_utf8(raw).unwrap_or("");
    for field in FORBIDDEN {
        if text.contains(field) {
            return Err(alloc::format!(
                "bad input: '{field}' must not be passed inline — this contract reads profile \
                 fields through host-resolved {{{{profile.*}}}} placeholders only"
            ));
        }
    }
    Ok(())
}

/// Build the verifier request body.
///
/// The `{{profile.*}}` markers are literal text inside the WASM. The host
/// substitutes them from the calling user's profile after this contract
/// returns the request, so the plaintext values are never resident here.
pub fn build_verifier_body(policy: &Policy, policy_id: &str) -> Result<Vec<u8>, String> {
    let body = serde_json::json!({
        "policy_id": policy_id,
        "min_age": policy.min_age,
        "allowed_countries": policy.allowed_countries,
        // The JSON keys here are the verifier's API. The values are placeholder
        // markers naming fields on the T3N user profile, whose schema calls the
        // country field `residence_country` (verified against `user-upsert`,
        // which rejects `country` as an unrecognized key).
        "subject": {
            "date_of_birth": "{{profile.date_of_birth}}",
            "country":       "{{profile.residence_country}}",
        }
    });
    serde_json::to_vec(&body).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Attestation {
        Attestation {
            policy_id: "adult-eu".to_string(),
            subject: "aabbccdd".to_string(),
            eligible: true,
            reason_code: reason::OK.to_string(),
            issued_at: 1_700_000_000,
            expires_at: 1_700_086_400,
        }
    }

    #[test]
    fn digest_is_stable_across_calls() {
        let a = sample();
        assert_eq!(digest_of(&a).unwrap(), digest_of(&a).unwrap());
    }

    #[test]
    fn digest_changes_when_verdict_changes() {
        let a = sample();
        let mut b = sample();
        b.eligible = false;
        assert_ne!(
            digest_of(&a).unwrap(),
            digest_of(&b).unwrap(),
            "flipping the verdict must change the digest, or an attestation could be forged"
        );
    }

    #[test]
    fn digest_is_32_bytes_as_set_claims_digest_requires() {
        assert_eq!(digest_of(&sample()).unwrap().len(), 32);
        assert_eq!(digest_hex(&sample()).unwrap().len(), 64);
    }

    #[test]
    fn attestation_carries_no_pii_fields() {
        let json = serde_json::to_string(&sample()).unwrap();
        for banned in ["date_of_birth", "country", "given_name", "passport"] {
            assert!(
                !json.contains(banned),
                "attestation must not carry '{banned}' — it is returned to the caller"
            );
        }
    }

    #[test]
    fn rejects_inline_pii() {
        let raw = br#"{"policy_id":"adult-eu","date_of_birth":"1990-01-01"}"#;
        let err = reject_inline_pii(raw).unwrap_err();
        assert!(err.contains("date_of_birth"));
        assert!(err.contains("placeholder"));
    }

    #[test]
    fn accepts_clean_input() {
        assert!(reject_inline_pii(br#"{"policy_id":"adult-eu"}"#).is_ok());
    }

    #[test]
    fn rejects_policy_id_that_would_collide_in_composite_key() {
        // '|' separates policy from subject in the KV key.
        assert!(validate_policy_id("adult|eu").is_err());
        assert!(validate_policy_id("").is_err());
        assert!(validate_policy_id("adult-eu.v2_1").is_ok());
    }

    #[test]
    fn rejects_policy_id_carrying_a_placeholder_marker() {
        assert!(validate_policy_id("{{profile.country}}").is_err());
    }

    #[test]
    fn attestation_key_is_unambiguous() {
        assert_eq!(attestation_key("p1", "aabb"), b"p1|aabb".to_vec());
        assert_ne!(attestation_key("p1", "aabb"), attestation_key("p1a", "abb"));
    }

    #[test]
    fn verifier_body_keeps_placeholders_literal() {
        let policy = Policy {
            min_age: 18,
            allowed_countries: vec!["NG".to_string(), "GB".to_string()],
            ttl_secs: 3600,
            verifier_url: "https://verifier.example.com/v1".to_string(),
        };
        let body = build_verifier_body(&policy, "adult-eu").unwrap();
        let text = String::from_utf8(body).unwrap();
        // The markers must survive serialization unresolved — the host, not
        // this contract, is what turns them into values.
        assert!(text.contains("{{profile.date_of_birth}}"));
        // Must be the profile's real field name, not the verifier's JSON key.
        assert!(text.contains("{{profile.residence_country}}"));
        assert!(!text.contains("{{profile.country}}"));
        assert!(text.contains("\"min_age\":18"));
    }

    #[test]
    fn verifier_response_drops_unexpected_fields() {
        // A verifier that echoes PII back must not have it forwarded.
        let raw = br#"{"eligible":true,"reason_code":"ok","date_of_birth":"1990-01-01"}"#;
        let parsed: VerifierResp = serde_json::from_slice(raw).unwrap();
        assert!(parsed.eligible);
        let reserialized = serde_json::to_string(&Attestation {
            policy_id: "p".to_string(),
            subject: "aa".to_string(),
            eligible: parsed.eligible,
            reason_code: parsed.reason_code.unwrap_or_default(),
            issued_at: 1,
            expires_at: 2,
        })
        .unwrap();
        assert!(!reserialized.contains("1990-01-01"));
    }

    #[test]
    fn check_req_rejects_non_json() {
        assert!(serde_json::from_slice::<CheckReq>(b"not json").is_err());
    }
}
