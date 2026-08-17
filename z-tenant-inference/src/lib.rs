//! z-tenant-inference v0.1.0 — LLM inference proxied through the enclave.
//!
//! Normally an app holding a model provider's API key is, unavoidably, a
//! processor of every prompt it sends: the key sits in its environment and the
//! prompt passes through its memory and logs. This contract moves the call
//! inside the confidential-compute boundary so neither is true.
//!
//!   - `complete`: reads the provider key from `z:<tid>:secrets` inside the
//!     enclave, posts the chat-completion request from there, and returns the
//!     provider's response. The calling application never holds the key.
//!   - With `resolve_profile: true` the request goes out via
//!     `http-with-placeholders`, so `{{profile.<field>}}` markers in the prompt
//!     are substituted by the host at dispatch time — user PII reaches the
//!     model without ever existing in this contract's memory or in the app.
//!   - `config-status`: reports the endpoint and whether the secret is present,
//!     without revealing it.
//!
//! # Security design
//!
//! The endpoint comes from tenant config in KV and never from request input.
//! A contract that dialled a caller-supplied URL while holding a sealed
//! credential would be an SSRF proxy with a key attached. Requests carrying an
//! `endpoint`, `api_key`, `secret` or `authorization` field are refused
//! outright rather than ignored, so misuse fails loudly.
//!
//! Streaming is not offered: host HTTP is synchronous, so the completion
//! returns whole. Callers that want a streamed UI should synthesise the stream
//! on their side.
//!
//! # Host-capability requirements
//!
//! ```json
//! {
//!   "host_capabilities": [
//!     "kv_store", "logging", "tenant_context", "http", "http_with_placeholders"
//!   ]
//! }
//! ```
//!
//! # Setup
//!
//! ```text
//! z:<tid>:secrets    <secret_key> = "<provider api key>"
//! z:<tid>:inference  config       = {"endpoint":"https://…/v1/chat/completions",
//!                                    "secret_key":"gateway_api_key",
//!                                    "default_model":"openai/gpt-5-mini"}
//! ```
//!
//! The provider host must also appear in the calling user's agent-auth grant,
//! or the host refuses egress before the request leaves the enclave.
#![warn(clippy::style, missing_debug_implementations)]
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

extern crate alloc;

pub const CONTRACT_VERSION: &str = "0.1.0";

wit_bindgen::generate!({
    world: "tenant-inference",
    path: "wit",
    additional_derives: [
        serde::Deserialize,
        serde::Serialize,
    ],
    generate_all,
});

mod config;
mod proxy;

struct Component;

#[cfg(target_arch = "wasm32")]
impl exports::z::tenant_inference::contracts::Guest for Component {
    fn complete(
        req: exports::z::tenant_inference::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("complete: missing input")?;
        proxy::complete(&input)
    }

    fn config_status(
        req: exports::z::tenant_inference::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.unwrap_or_default();
        proxy::config_status(&input)
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
        assert_eq!(parts.len(), 3);
        for part in parts {
            assert!(part.parse::<u32>().is_ok());
        }
    }
}
