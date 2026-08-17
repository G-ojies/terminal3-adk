//! `verify-attestation` — check a presented attestation against the stored
//! record without re-running the policy or reading the user's profile.
//!
//! This is the half that makes an attestation *reusable*: a relying party that
//! holds `{ policy_id, subject, digest }` can confirm the verdict is genuine
//! and current, and learns nothing beyond the boolean.

use crate::policy::{
    attestation_key, digest_hex, reason, validate_policy_id, Attestation, VerifyReq, VerifyResp,
};
use alloc::string::{String, ToString};
use alloc::vec::Vec;

pub fn verify_attestation(input: &[u8]) -> Result<Vec<u8>, String> {
    let req: VerifyReq = serde_json::from_slice(input)
        .map_err(|e| alloc::format!("verify-attestation: bad input: {e}"))?;
    validate_policy_id(&req.policy_id)?;
    validate_hex(&req.subject, "subject")?;
    validate_hex(&req.digest, "digest")?;

    #[cfg(target_arch = "wasm32")]
    {
        let resp = verify_attestation_wasm(req)?;
        serde_json::to_vec(&resp).map_err(|e| e.to_string())
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = req;
        Err("verify_attestation is only implemented on the wasm32 target".to_string())
    }
}

/// Reject non-hex identifiers up front. Both fields are used to build a KV key
/// or compared against one, so anything outside `[0-9a-f]` is malformed input
/// rather than a lookup that should be attempted.
fn validate_hex(value: &str, field: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 128 {
        return Err(alloc::format!("{field} must be 1..=128 hex characters"));
    }
    if !value.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(alloc::format!("{field} must be hex-encoded"));
    }
    Ok(())
}

#[cfg(target_arch = "wasm32")]
use crate::attest::map_name;
#[cfg(target_arch = "wasm32")]
use crate::host::{interfaces::kv_store, tenant::tenant_context};

#[cfg(target_arch = "wasm32")]
fn verify_attestation_wasm(req: VerifyReq) -> Result<VerifyResp, String> {
    let now = tenant_context::cluster_timestamp_secs();
    let map = map_name("attestations");
    let key = attestation_key(&req.policy_id, &req.subject);

    let stored = match kv_store::get(&map, &key).map_err(|e| alloc::format!("kv read: {e}"))? {
        Some(bytes) => bytes,
        None => {
            return Ok(VerifyResp {
                valid: false,
                reason_code: reason::NOT_FOUND.to_string(),
                expires_at: 0,
            })
        }
    };

    let att: Attestation = serde_json::from_slice(&stored)
        .map_err(|e| alloc::format!("stored attestation is corrupt: {e}"))?;

    // Recompute rather than trust the presented digest.
    let actual = digest_hex(&att)?;
    if !constant_time_eq(actual.as_bytes(), req.digest.as_bytes()) {
        return Ok(VerifyResp {
            valid: false,
            reason_code: reason::DIGEST_MISMATCH.to_string(),
            expires_at: att.expires_at,
        });
    }

    if att.expires_at <= now {
        return Ok(VerifyResp {
            valid: false,
            reason_code: reason::EXPIRED.to_string(),
            expires_at: att.expires_at,
        });
    }

    Ok(VerifyResp {
        // An attestation that exists, matches and is unexpired is still only
        // "valid" if its verdict was positive.
        valid: att.eligible,
        reason_code: att.reason_code,
        expires_at: att.expires_at,
    })
}

/// Length-independent comparison, so a caller cannot learn the stored digest
/// byte-by-byte from response timing.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_wasm_returns_err() {
        let input = br#"{"policy_id":"adult-eu","subject":"aabb","digest":"ccdd"}"#;
        assert!(verify_attestation(input)
            .unwrap_err()
            .contains("only implemented on the wasm32 target"));
    }

    #[test]
    fn rejects_non_hex_subject() {
        let input = br#"{"policy_id":"adult-eu","subject":"not-hex!","digest":"ccdd"}"#;
        assert!(verify_attestation(input).unwrap_err().contains("subject"));
    }

    #[test]
    fn rejects_non_hex_digest() {
        let input = br#"{"policy_id":"adult-eu","subject":"aabb","digest":"zzzz"}"#;
        assert!(verify_attestation(input).unwrap_err().contains("digest"));
    }

    #[test]
    fn rejects_bad_json() {
        assert!(verify_attestation(b"{").is_err());
    }

    #[test]
    fn constant_time_eq_matches_semantics_of_normal_eq() {
        assert!(constant_time_eq(b"abcd", b"abcd"));
        assert!(!constant_time_eq(b"abcd", b"abce"));
        assert!(!constant_time_eq(b"abcd", b"abc"));
        assert!(constant_time_eq(b"", b""));
    }
}
