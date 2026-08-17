//! The enclave-side call to the model provider.

use crate::config::{
    build_provider_body, provider_headers, reject_forbidden_fields, validate_endpoint, CompleteReq,
    Config, ConfigStatus, DEFAULT_MAX_RESPONSE_BYTES,
};
use alloc::string::{String, ToString};
use alloc::vec::Vec;

/// Entry point for `complete`.
pub fn complete(input: &[u8]) -> Result<Vec<u8>, String> {
    // Refuse transport-level fields before parsing, so a caller trying to
    // redirect the credential fails loudly rather than being quietly ignored.
    reject_forbidden_fields(input)?;

    let req: CompleteReq =
        serde_json::from_slice(input).map_err(|e| alloc::format!("complete: bad input: {e}"))?;

    #[cfg(target_arch = "wasm32")]
    {
        complete_wasm(req)
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = req;
        Err("complete is only implemented on the wasm32 target".to_string())
    }
}

/// Entry point for `config-status`.
pub fn config_status(_input: &[u8]) -> Result<Vec<u8>, String> {
    #[cfg(target_arch = "wasm32")]
    {
        let cfg = load_config()?;
        let secret_present = get_secret(&cfg.secret_key).is_ok();
        let status = ConfigStatus {
            endpoint: cfg.endpoint,
            secret_present,
            default_model: cfg.default_model,
            max_response_bytes: cfg.max_response_bytes.unwrap_or(DEFAULT_MAX_RESPONSE_BYTES),
        };
        serde_json::to_vec(&status).map_err(|e| e.to_string())
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        Err("config_status is only implemented on the wasm32 target".to_string())
    }
}

#[cfg(target_arch = "wasm32")]
use crate::host::{
    interfaces::{http as http_iface, http_with_placeholders as hwp, kv_store, logging},
    tenant::tenant_context,
};

#[cfg(target_arch = "wasm32")]
fn complete_wasm(req: CompleteReq) -> Result<Vec<u8>, String> {
    let cfg = load_config()?;
    validate_endpoint(&cfg.endpoint)?;

    let api_key = get_secret(&cfg.secret_key)?;
    let body = build_provider_body(&req, &cfg)?;
    let headers = provider_headers(&api_key);
    let limit = cfg.max_response_bytes.unwrap_or(DEFAULT_MAX_RESPONSE_BYTES);

    // Log the shape of the call, never its content. A prompt is exactly the
    // kind of thing that must not end up in cluster logs.
    let _ = logging::info(&alloc::format!(
        "inference: {} bytes out, placeholders={}",
        body.len(),
        req.resolve_profile
    ));

    let (code, payload) = if req.resolve_profile {
        // The prompt carries {{profile.*}} markers. The host substitutes them
        // on its own stack after this contract has composed the request, so
        // the plaintext never enters WASM memory here.
        let resp = hwp::call(&hwp::Request {
            method: hwp::Verb::Post,
            url: cfg.endpoint.clone(),
            headers: Some(headers),
            payload: Some(body),
        })
        .map_err(|e| alloc::format!("inference: {}", format_hwp_error(e)))?;
        (resp.code, resp.payload)
    } else {
        let resp = http_iface::call(&http_iface::Request {
            method: http_iface::Verb::Post,
            url: cfg.endpoint.clone(),
            headers: Some(headers),
            payload: Some(body),
        })
        .map_err(|e| alloc::format!("inference: {e}"))?;
        (resp.code, resp.payload)
    };

    if payload.len() > limit {
        return Err(alloc::format!(
            "provider response is {} bytes, over the {limit} byte limit",
            payload.len()
        ));
    }

    if code != 200 {
        let _ = logging::error(&alloc::format!("provider returned HTTP {code}"));
        // The provider's error body is returned so the caller can act on it.
        // Providers put diagnostics here, not user data — and the prompt is not
        // echoed back. If that ever changes, this is the line to revisit.
        let detail = String::from_utf8_lossy(&payload);
        return Err(alloc::format!(
            "provider HTTP {code}: {}",
            detail.chars().take(600).collect::<String>()
        ));
    }

    // Confirm it parses before returning, so callers get a clear error here
    // rather than a confusing one downstream.
    let _: serde_json::Value = serde_json::from_slice(&payload)
        .map_err(|e| alloc::format!("provider response was not JSON: {e}"))?;

    let _ = logging::info(&alloc::format!("inference ok, {} bytes back", payload.len()));
    Ok(payload)
}

/// Build the full `z:<tid>:<tail>` map name.
///
/// `tenant_did()` returns raw bytes, so it is hex-encoded exactly once.
#[cfg(target_arch = "wasm32")]
fn map_name(tail: &str) -> String {
    let tid = tenant_context::tenant_did();
    alloc::format!("z:{}:{}", hex::encode(&tid), tail)
}

#[cfg(target_arch = "wasm32")]
fn load_config() -> Result<Config, String> {
    let map = map_name("inference");
    let bytes = kv_store::get(&map, b"config")
        .map_err(|e| alloc::format!("kv read: {e}"))?
        .ok_or("no 'config' entry in z:<tid>:inference — seed it with the tenant SDK first")?;
    serde_json::from_slice(&bytes).map_err(|e| alloc::format!("inference config is malformed: {e}"))
}

#[cfg(target_arch = "wasm32")]
fn get_secret(key: &str) -> Result<String, String> {
    let map = map_name("secrets");
    let bytes = kv_store::get(&map, key.as_bytes())
        .map_err(|e| alloc::format!("kv read: {e}"))?
        .ok_or_else(|| alloc::format!("'{key}' not found in z:<tid>:secrets"))?;
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

/// Never includes resolved PII — only field names and host-side reasons.
#[cfg(target_arch = "wasm32")]
fn format_hwp_error(e: hwp::HttpError) -> String {
    match e {
        hwp::HttpError::EgressDenied(host) => {
            alloc::format!("egress denied for host {host} — add it to the user's agent auth grant")
        }
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
        let input = br#"{"messages":[{"role":"user","content":"hi"}]}"#;
        assert!(complete(input)
            .unwrap_err()
            .contains("only implemented on the wasm32 target"));
    }

    #[test]
    fn rejects_caller_supplied_endpoint_before_anything_else() {
        let input = br#"{"messages":[{"role":"user","content":"hi"}],"endpoint":"https://evil.test"}"#;
        let err = complete(input).unwrap_err();
        assert!(err.contains("endpoint"));
        // Must fail on the guard, not on the wasm-target check.
        assert!(!err.contains("wasm32"));
    }

    #[test]
    fn rejects_bad_json() {
        assert!(complete(b"not json").unwrap_err().contains("bad input"));
    }
}
