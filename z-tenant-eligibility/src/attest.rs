//! `check-eligibility` — evaluate a policy for the calling user and issue an
//! attestation, reusing a still-valid one when present.

use crate::policy::{
    attestation_key, digest_hex, reason, reject_inline_pii, validate_policy_id, Attestation,
    CheckReq, CheckResp,
};
use alloc::string::{String, ToString};
use alloc::vec::Vec;

/// Entry point called from `lib.rs`. `input` is the raw JSON bytes from the
/// node's `generic-input.input` field.
pub fn check_eligibility(input: &[u8]) -> Result<Vec<u8>, String> {
    // Refuse inline PII before parsing, so a misuse fails with a clear reason
    // rather than being quietly accepted through a less private path.
    reject_inline_pii(input)?;

    let req: CheckReq = serde_json::from_slice(input)
        .map_err(|e| alloc::format!("check-eligibility: bad input: {e}"))?;
    validate_policy_id(&req.policy_id)?;

    #[cfg(target_arch = "wasm32")]
    {
        let resp = check_eligibility_wasm(req)?;
        serde_json::to_vec(&resp).map_err(|e| e.to_string())
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = req;
        Err("check_eligibility is only implemented on the wasm32 target".to_string())
    }
}

#[cfg(target_arch = "wasm32")]
use crate::host::{
    interfaces::{http_with_placeholders as hwp, kv_store, logging},
    tenant::tenant_context,
};

#[cfg(target_arch = "wasm32")]
use crate::policy::{build_verifier_body, digest_of, Policy, VerifierResp};

#[cfg(target_arch = "wasm32")]
fn check_eligibility_wasm(req: CheckReq) -> Result<CheckResp, String> {
    // The subject is the authenticated caller, never a contract argument.
    // Without this, any caller could mint an attestation naming someone else.
    let subject_bytes = tenant_context::calling_user_did().ok_or(
        "check-eligibility: no calling user bound to this execution — this contract must be \
         invoked through the Session API, not /api/dev/exec",
    )?;
    let subject = hex::encode(&subject_bytes);

    // Cluster timestamp, not wall clock: replicas must agree or the OCC commit
    // would diverge across the Raft group.
    let now = tenant_context::cluster_timestamp_secs();

    let att_map = map_name("attestations");
    let key = attestation_key(&req.policy_id, &subject);

    // Reuse path — the entire point of the contract. A valid attestation means
    // the answer is already known, so the profile is not read at all.
    if let Some(existing) = kv_store::get(&att_map, &key).map_err(|e| alloc::format!("kv read: {e}"))?
    {
        let att: Attestation = serde_json::from_slice(&existing)
            .map_err(|e| alloc::format!("stored attestation is corrupt: {e}"))?;
        if att.expires_at > now {
            let _ = logging::info("attestation reused; no outbound call, profile not read");
            let digest = digest_hex(&att)?;
            return Ok(CheckResp {
                attestation: att,
                digest,
                reused: true,
            });
        }
    }

    let policy = load_policy(&req.policy_id)?;
    let api_key = get_secret("verifier_api_key")?;

    let _ = logging::info("evaluating policy via placeholder-resolved verifier call");

    // The body contains `{{profile.*}}` markers, still literal at this point.
    // The host substitutes them on its own stack between manifest validation
    // and the outbound request, so plaintext PII never lands in WASM memory.
    let resp = hwp::call(&hwp::Request {
        method: hwp::Verb::Post,
        url: policy.verifier_url.clone(),
        headers: Some(verifier_headers(&api_key)),
        payload: Some(build_verifier_body(&policy, &req.policy_id)?),
    })
    .map_err(|e| alloc::format!("eligibility verifier: {}", format_http_error(e)))?;

    if resp.code != 200 {
        // Deliberately does not echo the response body: a misbehaving verifier
        // could reflect resolved PII, and this error string reaches the caller.
        let _ = logging::error(&alloc::format!("verifier returned HTTP {}", resp.code));
        return Err(alloc::format!(
            "eligibility verifier failed: HTTP {}",
            resp.code
        ));
    }

    let verdict: VerifierResp = serde_json::from_slice(&resp.payload)
        .map_err(|e| alloc::format!("verifier response was not the expected shape: {e}"))?;

    let att = Attestation {
        policy_id: req.policy_id,
        subject,
        eligible: verdict.eligible,
        reason_code: verdict
            .reason_code
            .unwrap_or_else(|| default_reason(verdict.eligible).to_string()),
        issued_at: now,
        expires_at: now.saturating_add(policy.ttl_secs),
    };

    let encoded = serde_json::to_vec(&att).map_err(|e| e.to_string())?;
    kv_store::put(&att_map, &key, &encoded).map_err(|e| alloc::format!("kv write: {e}"))?;

    // Bind the attestation into this transaction's Merkle leaf, so a holder can
    // prove offline from the receipt that the cluster issued exactly this record.
    let digest = digest_of(&att)?;
    kv_store::set_claims_digest(&digest)
        .map_err(|e| alloc::format!("set_claims_digest: {e}"))?;

    Ok(CheckResp {
        attestation: att,
        digest: hex::encode(digest),
        reused: false,
    })
}

/// Coarse reason when the verifier does not supply one. Intentionally does not
/// distinguish age from jurisdiction, since a precise reason would leak a bit
/// of the underlying profile to the caller.
#[cfg(target_arch = "wasm32")]
fn default_reason(eligible: bool) -> &'static str {
    if eligible {
        reason::OK
    } else {
        reason::PROFILE_INCOMPLETE
    }
}

/// Build the full `z:<tid>:<tail>` map name.
///
/// `tenant_did()` returns the raw 20-byte CompactDid, so it is hex-encoded
/// exactly once here. The published walkthrough says not to encode it at all,
/// which does not compile — see BUGS.md BUG-01.
#[cfg(target_arch = "wasm32")]
pub(crate) fn map_name(tail: &str) -> String {
    let tid = tenant_context::tenant_did();
    alloc::format!("z:{}:{}", hex::encode(&tid), tail)
}

#[cfg(target_arch = "wasm32")]
fn load_policy(policy_id: &str) -> Result<Policy, String> {
    let map = map_name("policies");
    let bytes = kv_store::get(&map, policy_id.as_bytes())
        .map_err(|e| alloc::format!("kv read: {e}"))?
        .ok_or_else(|| {
            alloc::format!(
                "policy '{policy_id}' not found in z:<tid>:policies — create it with the tenant SDK first"
            )
        })?;
    serde_json::from_slice(&bytes).map_err(|e| alloc::format!("policy '{policy_id}' is malformed: {e}"))
}

#[cfg(target_arch = "wasm32")]
fn get_secret(key: &str) -> Result<String, String> {
    let map = map_name("secrets");
    let bytes = kv_store::get(&map, key.as_bytes())
        .map_err(|e| alloc::format!("kv read: {e}"))?
        .ok_or_else(|| {
            alloc::format!("'{key}' not found in z:<tid>:secrets — populate it via the tenant SDK")
        })?;
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

#[cfg(target_arch = "wasm32")]
fn verifier_headers(api_key: &str) -> Vec<(String, String)> {
    // Content-Type is set by the host HTTP function; sending it explicitly
    // produces a duplicate header that some upstreams reject.
    alloc::vec![
        ("Authorization".to_string(), alloc::format!("Bearer {api_key}")),
        ("Accept".to_string(), "application/json".to_string()),
    ]
}

/// Never includes resolved PII — only field names and host-side reasons.
#[cfg(target_arch = "wasm32")]
fn format_http_error(e: hwp::HttpError) -> String {
    match e {
        hwp::HttpError::EgressDenied(host) => alloc::format!(
            "egress denied for host {host} — add it to the user's agent auth grant"
        ),
        hwp::HttpError::PlaceholderDenied(marker) => {
            alloc::format!("placeholder not permitted: {marker}")
        }
        hwp::HttpError::PlaceholderUnknown(field) => {
            alloc::format!("user profile missing field: {field}")
        }
        hwp::HttpError::PlaceholderNoUserContext => {
            "no user context bound for placeholder resolution".to_string()
        }
        hwp::HttpError::UpstreamError(r) => alloc::format!("upstream: {r}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_wasm_returns_err() {
        let input = br#"{"policy_id":"adult-eu"}"#;
        let err = check_eligibility(input).unwrap_err();
        assert!(err.contains("only implemented on the wasm32 target"));
    }

    #[test]
    fn rejects_inline_pii_before_anything_else() {
        let input = br#"{"policy_id":"adult-eu","date_of_birth":"1990-01-01"}"#;
        let err = check_eligibility(input).unwrap_err();
        assert!(err.contains("date_of_birth"));
        // Must fail on the PII check, not on the wasm-target check.
        assert!(!err.contains("wasm32"));
    }

    #[test]
    fn rejects_bad_json() {
        assert!(check_eligibility(b"not json").unwrap_err().contains("bad input"));
    }

    #[test]
    fn rejects_policy_id_with_separator() {
        let input = br#"{"policy_id":"adult|eu"}"#;
        assert!(check_eligibility(input).unwrap_err().contains("policy_id"));
    }

    #[test]
    fn rejects_missing_policy_id() {
        assert!(check_eligibility(br#"{}"#).is_err());
    }
}
