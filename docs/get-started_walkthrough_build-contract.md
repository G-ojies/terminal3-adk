> ## Documentation Index
> Fetch the complete documentation index at: https://docs.terminal3.io/llms.txt
> Use this file to discover all available pages before exploring further.

# 2. Build your TEE contract

This step turns the Rust contract from [Step 1](/developers/adk/get-started/walkthrough/write-contract) into a WASM component. Run these commands below from the contract repository root, where `Cargo.toml` and `wit/world.wit` live.

<Note>
  You do not need `cargo-component`. With `crate-type = ["cdylib", "lib"]` in `Cargo.toml`, the `wasm32-wasip2` target emits a WASM component that T3N can inspect and register.
</Note>

## Build the release artifact

Install the WASI Preview 2 target once per machine, then build the release artifact:

```bash theme={null}
rustup target add wasm32-wasip2
cargo build --target wasm32-wasip2 --release
```

Cargo writes the component to `target/wasm32-wasip2/release/`. If your package name contains hyphens, Cargo converts them to underscores in the file name. The `z-tenant-flight` package therefore builds to:

```bash theme={null}
target/wasm32-wasip2/release/z_tenant_flight.wasm
```

Confirm the file exists before moving on:

```bash theme={null}
ls -lh target/wasm32-wasip2/release/*.wasm
```

The `.wasm` file is the artifact you pass to `tenant.contracts.register` in [Step 3](/developers/adk/get-started/walkthrough/register-contract).

## Verify the component interface

Use `wasm-tools` to print the component's WIT interface:

```bash theme={null}
wasm-tools component wit target/wasm32-wasip2/release/z_tenant_flight.wasm
```

The output should include the host interfaces you imported in `wit/world.wit`, such as `host:interfaces/kv-store`, and your exported interface:

```wit theme={null}
export contracts;
```

If `wasm-tools` is not installed yet:

```bash theme={null}
cargo install wasm-tools
```
