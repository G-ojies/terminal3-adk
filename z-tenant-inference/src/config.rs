//! Types, validation and request building.
//!
//! Everything here is target-independent so it can be unit tested natively.
//! Host calls live in `proxy.rs`.

use alloc::string::{String, ToString};
use alloc::vec::Vec;
use serde_json::{json, Value};

/// Tenant-authored config, stored as JSON in `z:<tid>:inference` under `config`.
///
/// The endpoint lives here and *only* here. It is deliberately not accepted
/// from request input: a contract that dialled a caller-supplied URL while
/// holding a sealed API key would be an SSRF proxy with credentials attached.
#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct Config {
    /// Full chat-completions URL, e.g. `https://ai-gateway.vercel.sh/v1/chat/completions`.
    pub endpoint: String,
    /// Key name to read from `z:<tid>:secrets`.
    pub secret_key: String,
    /// Used when a request omits `model`.
    #[serde(default)]
    pub default_model: Option<String>,
    /// Reject provider responses larger than this. Defaults to 256 KiB, which
    /// matches the platform's own `max_value_bytes`.
    #[serde(default)]
    pub max_response_bytes: Option<usize>,
}

pub const DEFAULT_MAX_RESPONSE_BYTES: usize = 262_144;

/// What a caller may ask for. Note the absence of any endpoint or key field.
#[derive(serde::Deserialize, Debug)]
pub struct CompleteReq {
    #[serde(default)]
    pub model: Option<String>,
    pub messages: Value,
    #[serde(default)]
    pub tools: Option<Value>,
    #[serde(default)]
    pub tool_choice: Option<Value>,
    #[serde(default)]
    pub temperature: Option<f64>,
    /// When true the request goes out via `http-with-placeholders`, so any
    /// `{{profile.<field>}}` markers in the prompt are resolved host-side from
    /// the calling user's profile.
    #[serde(default)]
    pub resolve_profile: bool,
}

#[derive(serde::Serialize, Debug)]
pub struct ConfigStatus {
    pub endpoint: String,
    pub secret_present: bool,
    pub default_model: Option<String>,
    pub max_response_bytes: usize,
}

/// Reject anything that isn't a plausible https endpoint.
///
/// Belt and braces: the tenant writes this value, and the host enforces a
/// per-contract egress allowlist on top. But config is easy to get wrong, and a
/// plaintext endpoint would leak the prompt and the bearer token on the wire.
pub fn validate_endpoint(endpoint: &str) -> Result<(), String> {
    if !endpoint.starts_with("https://") {
        return Err("endpoint must be https".to_string());
    }
    if endpoint.len() > 2048 {
        return Err("endpoint is implausibly long".to_string());
    }
    // A marker here would be substituted host-side into a URL, which is a
    // request-forgery primitive rather than a personalisation feature.
    if endpoint.contains("{{") {
        return Err("endpoint must not contain placeholder markers".to_string());
    }
    Ok(())
}

/// Build the provider request body.
///
/// `messages` and `tools` pass through untouched so this stays a transport and
/// not a translation layer — the caller keeps the provider's own shapes.
/// `stream` is forced off because host HTTP is synchronous.
pub fn build_provider_body(req: &CompleteReq, cfg: &Config) -> Result<Vec<u8>, String> {
    let model = req
        .model
        .clone()
        .or_else(|| cfg.default_model.clone())
        .ok_or("no model given and no default_model configured")?;

    if !req.messages.is_array() {
        return Err("messages must be an array".to_string());
    }
    if req.messages.as_array().map(|a| a.is_empty()).unwrap_or(true) {
        return Err("messages must not be empty".to_string());
    }

    let mut body = json!({
        "model": model,
        "messages": req.messages,
        "stream": false,
    });

    let obj = body.as_object_mut().ok_or("internal: body is not an object")?;
    if let Some(tools) = &req.tools {
        obj.insert("tools".to_string(), tools.clone());
    }
    if let Some(tc) = &req.tool_choice {
        obj.insert("tool_choice".to_string(), tc.clone());
    }
    if let Some(t) = req.temperature {
        obj.insert("temperature".to_string(), json!(t));
    }

    serde_json::to_vec(&body).map_err(|e| e.to_string())
}

/// Headers for the provider call. The bearer token is assembled here and
/// nowhere else, and is never logged or returned.
pub fn provider_headers(api_key: &str) -> Vec<(String, String)> {
    // Content-Type is set by the host HTTP function; sending it explicitly
    // produces a duplicate that some upstreams reject.
    alloc::vec![
        ("Authorization".to_string(), alloc::format!("Bearer {api_key}")),
        ("Accept".to_string(), "application/json".to_string()),
    ]
}

/// Guard against a caller trying to smuggle transport-level control in.
pub fn reject_forbidden_fields(raw: &[u8]) -> Result<(), String> {
    let text = core::str::from_utf8(raw).map_err(|_| "input is not valid UTF-8".to_string())?;
    for field in ["\"endpoint\"", "\"api_key\"", "\"secret\"", "\"authorization\""] {
        if text.contains(field) {
            return Err(alloc::format!(
                "bad input: {field} is not accepted — the endpoint and credential come from \
                 tenant config, never from the request"
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> Config {
        Config {
            endpoint: "https://ai-gateway.vercel.sh/v1/chat/completions".to_string(),
            secret_key: "gateway_api_key".to_string(),
            default_model: Some("openai/gpt-5-mini".to_string()),
            max_response_bytes: None,
        }
    }

    fn req(json_str: &str) -> CompleteReq {
        serde_json::from_str(json_str).unwrap()
    }

    #[test]
    fn endpoint_must_be_https() {
        assert!(validate_endpoint("https://api.example.com/v1/chat").is_ok());
        assert!(validate_endpoint("http://api.example.com/v1/chat").is_err());
        assert!(validate_endpoint("file:///etc/passwd").is_err());
    }

    #[test]
    fn endpoint_must_not_carry_placeholder_markers() {
        // Otherwise the host would substitute profile data into a URL, turning
        // personalisation into request forgery.
        assert!(validate_endpoint("https://x.example.com/{{profile.country}}").is_err());
    }

    #[test]
    fn caller_cannot_supply_an_endpoint() {
        let raw = br#"{"messages":[{"role":"user","content":"hi"}],"endpoint":"https://evil.example.com"}"#;
        let err = reject_forbidden_fields(raw).unwrap_err();
        assert!(err.contains("endpoint"));
        assert!(err.contains("tenant config"));
    }

    #[test]
    fn caller_cannot_supply_a_credential() {
        for raw in [
            &br#"{"api_key":"sk-1"}"#[..],
            &br#"{"secret":"sk-1"}"#[..],
            &br#"{"authorization":"Bearer x"}"#[..],
        ] {
            assert!(reject_forbidden_fields(raw).is_err());
        }
    }

    #[test]
    fn accepts_a_clean_request() {
        assert!(reject_forbidden_fields(br#"{"messages":[{"role":"user","content":"hi"}]}"#).is_ok());
    }

    #[test]
    fn builds_body_with_model_and_messages() {
        let r = req(r#"{"model":"openai/gpt-5","messages":[{"role":"user","content":"hi"}]}"#);
        let body = build_provider_body(&r, &cfg()).unwrap();
        let v: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["model"], "openai/gpt-5");
        assert_eq!(v["messages"][0]["content"], "hi");
    }

    #[test]
    fn streaming_is_always_disabled() {
        // Host HTTP is synchronous; a streamed response could not be returned.
        let r = req(r#"{"messages":[{"role":"user","content":"hi"}]}"#);
        let v: Value = serde_json::from_slice(&build_provider_body(&r, &cfg()).unwrap()).unwrap();
        assert_eq!(v["stream"], false);
    }

    #[test]
    fn falls_back_to_default_model() {
        let r = req(r#"{"messages":[{"role":"user","content":"hi"}]}"#);
        let v: Value = serde_json::from_slice(&build_provider_body(&r, &cfg()).unwrap()).unwrap();
        assert_eq!(v["model"], "openai/gpt-5-mini");
    }

    #[test]
    fn errors_when_no_model_anywhere() {
        let mut c = cfg();
        c.default_model = None;
        let r = req(r#"{"messages":[{"role":"user","content":"hi"}]}"#);
        assert!(build_provider_body(&r, &c).unwrap_err().contains("no model"));
    }

    #[test]
    fn tools_pass_through_untouched() {
        let r = req(
            r#"{"messages":[{"role":"user","content":"hi"}],
                "tools":[{"type":"function","function":{"name":"f","parameters":{}}}],
                "tool_choice":"auto"}"#,
        );
        let v: Value = serde_json::from_slice(&build_provider_body(&r, &cfg()).unwrap()).unwrap();
        assert_eq!(v["tools"][0]["function"]["name"], "f");
        assert_eq!(v["tool_choice"], "auto");
    }

    #[test]
    fn omits_optional_fields_when_absent() {
        let r = req(r#"{"messages":[{"role":"user","content":"hi"}]}"#);
        let v: Value = serde_json::from_slice(&build_provider_body(&r, &cfg()).unwrap()).unwrap();
        assert!(v.get("tools").is_none());
        assert!(v.get("temperature").is_none());
    }

    #[test]
    fn rejects_non_array_messages() {
        let r = req(r#"{"messages":"hello"}"#);
        assert!(build_provider_body(&r, &cfg()).unwrap_err().contains("array"));
    }

    #[test]
    fn rejects_empty_messages() {
        let r = req(r#"{"messages":[]}"#);
        assert!(build_provider_body(&r, &cfg()).unwrap_err().contains("empty"));
    }

    #[test]
    fn placeholder_markers_survive_into_the_body() {
        // The host resolves these; the contract must not touch them.
        let r = req(
            r#"{"messages":[{"role":"user","content":"My country is {{profile.residence_country}}"}]}"#,
        );
        let text = String::from_utf8(build_provider_body(&r, &cfg()).unwrap()).unwrap();
        assert!(text.contains("{{profile.residence_country}}"));
    }

    #[test]
    fn headers_carry_the_bearer_and_nothing_else_sensitive() {
        let h = provider_headers("sk-secret");
        assert_eq!(h.len(), 2);
        assert_eq!(h[0].0, "Authorization");
        assert_eq!(h[0].1, "Bearer sk-secret");
        assert!(h.iter().all(|(k, _)| k != "Content-Type"));
    }
}
