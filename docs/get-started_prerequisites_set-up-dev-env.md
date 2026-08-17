> ## Documentation Index
> Fetch the complete documentation index at: https://docs.terminal3.io/llms.txt
> Use this file to discover all available pages before exploring further.

# Set Up Development Environment

> Two more steps to get ready for writing your first TEE contract.

<Note>
  This page picks up where [Quickstart](/developers/adk/get-started/quickstart) leaves off. Complete that first — you should already have an authenticated `T3nClient` and your `tenantDid` before starting here.
</Note>

<Steps>
  <Step title="Get your API key and DID">
    If you haven't already, get your DID, download your API key, and claim test credits  from the [claim page](/developers/adk/get-started/prerequisites/request-test-tokens) — it's self-serve, no approval needed.
  </Step>

  <Step title="Install Rust + WASM toolchain">
    [TEE contracts](/t3n/how-t3n-works/tees#tee-contract) are compiled to WebAssembly (WASM) binaries, built with the Rust toolchain.

    If you don't already have `rustup`/`cargo` installed:

    ```bash theme={null}
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # choose the default option when prompted
    source "$HOME/.cargo/env"
    ```

    Then add the WASM target:

    ```bash theme={null}
    rustup target add wasm32-wasip2          # WASI Preview 2 build target — a few seconds
    cargo install wasm-tools                 # optional — inspect/verify the component
    ```

    <Note>
      `cargo install wasm-tools` compiles roughly 100 crates from source and takes about 2 minutes with no progress output in between — that's normal, not a hang.
    </Note>
  </Step>

  <Step title="Build a TenantClient from your session">
    Contracts are registered and managed through a `TenantClient`, built around the `tenantDid` you already obtained in Quickstart — never construct or derive this value yourself.

    Append this to the bottom of the same `quickstart.ts` you created in Quickstart — it needs `t3n` and `tenantDid` from that file's scope:

    ```typescript theme={null}
    import { TenantClient, getNodeUrl } from "@terminal3/t3n-sdk";

    const tenant = new TenantClient({
      t3n,                    // the T3nClient you already authenticated in Quickstart
      baseUrl: getNodeUrl(),  // the active node from setEnvironment()
      tenantDid,               // did.value from Quickstart — never hardcode
    });

    await tenant.me(); // throws if something's wrong; confirms the client actually works
    console.log("TenantClient ready.");
    ```

    Run it the same way as before — `npx tsx quickstart.ts` — and confirm you see `TenantClient ready.` printed after your `tenantDid` line.

    <Warning>
      **This authenticates you to manage your own deployment** — a different job from agent authentication. The DID must equal the one admitted as a tenant in `idx:_tenants`: exactly the `tenantDid` you already have from Quickstart.
    </Warning>
  </Step>
</Steps>

## What's next

Continue to [Write your first TEE contract](/developers/adk/get-started/walkthrough/write-contract).
