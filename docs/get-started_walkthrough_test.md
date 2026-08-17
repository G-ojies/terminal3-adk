> ## Documentation Index
> Fetch the complete documentation index at: https://docs.terminal3.io/llms.txt
> Use this file to discover all available pages before exploring further.

# 5. Test your TEE contract

**Unit tests (Rust):**

Test the business-logic guards on the native target with `cargo test`. Each
function takes the raw input bytes and returns `Result<Vec<u8>, String>`, so you
call it directly and assert on the error string — there is no `ContractError`
enum or test harness to set up. Functions that call the host (`http`, `kv-store`)
only run on `wasm32`; natively they return an error, so unit tests focus on input
parsing and validation.

```rust theme={null}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn book_offer_rejects_inline_pii() {
        // book-offer deserialises into a struct with only opaque ids + amount,
        // so a payload that tries to smuggle passenger PII fails at parse time.
        let input = serde_json::to_vec(&serde_json::json!({
            "offer_id": "off_1",
            "passengers": [{ "given_name": "Jane" }],   // not a valid field
            "total_amount": "199.00", "total_currency": "GBP",
        }))
        .unwrap();
        let err = book_offer(&input).unwrap_err();
        assert!(err.contains("bad input"));
    }

    #[test]
    fn book_offer_rejects_non_json() {
        assert!(book_offer(b"not json").unwrap_err().contains("bad input"));
    }
}
```

**Test checklist:**

* Happy path: `search-offers` → `book-offer` returns `{ id, pnr, status }`.
* Input hygiene: `book-offer` accepts only `offer_id`, `passenger_id`, `total_amount`, `total_currency` — any payload carrying passenger PII is rejected.
* PII never in output: `passport`, `date_of_birth`, and name fields do not appear in any return value or log line.
* The `{{profile.*}}` markers stay literal in the contract — resolution happens host-side, so they never appear resolved in WASM memory.
