# BUG-01 reproduction

The walkthrough instructs, in a code comment and again under Key Design Rules,
that `tenant_context::tenant_did()` returns a string and must **not** be
hex-encoded. Applying that instruction to Terminal 3's own reference contract
makes it stop compiling.

## Reproduce

```bash
git clone https://github.com/Terminal-3/z-tenant-flight.git
cd z-tenant-flight
git apply ../repro/bug-01/doc-instruction.patch   # the doc's version, one line
cargo build --target wasm32-wasip2 --release
```

`doc-instruction.patch` changes exactly one line, from what the reference repo
ships to what the documentation instructs:

```diff
-    let map_name = alloc::format!("z:{}:secrets", hex::encode(&tid));
+    let map_name = alloc::format!("z:{}:secrets", tid);
```

## Result

See [`rustc-output.txt`](rustc-output.txt):

```
error[E0277]: `Vec<u8>` doesn't implement `std::fmt::Display`
   --> src/search.rs:182:51
    |
182 |     let map_name = alloc::format!("z:{}:secrets", tid);
    |                                      --           ^^^ `Vec<u8>` cannot be formatted with the default formatter
```

## Why it happens

`wit/deps/host-tenant-1.0.0/package.wit`, in the same repo, declares:

```wit
/// Tenant DID under which this contract is running. The 20-byte
/// raw `CompactDid` shape — same as user / organisation DIDs.
tenant-did: func() -> list<u8>;
```

`list<u8>` binds to `Vec<u8>`, which has no `Display` impl. The value has to be
hex-encoded exactly once, which is what the reference implementation does and
what the documentation says not to do.

Independent confirmation from the TypeScript side: the register walkthrough
builds the same name with `tenantDid.slice("did:t3n:".length)`, and a
`did:t3n:` DID is hex — so the Rust side must hex-encode to produce a matching
map name.
