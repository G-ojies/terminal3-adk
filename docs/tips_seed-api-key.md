> ## Documentation Index
> Fetch the complete documentation index at: https://docs.terminal3.io/llms.txt
> Use this file to discover all available pages before exploring further.

# Seed API key into secrets map

> Seed the API key into the secrets map using the map-entry-set control call.

Your contract reads the API key from `z:<tid>:secrets` at runtime. There's no `set-credentials` function — the tenant SDK writes the key straight into the map with the `map-entry-set` control call, on the authenticated `tee:tenant/contracts` path (not an agent call).

```typescript theme={null}
await tenant.executeControl("map-entry-set", {
  map_name: tenant.canonicalName("secrets"),
  key:      "duffel_api_key",
  value:    process.env.DUFFEL_API_KEY!,
});

console.log("API key sealed in z:<tid>:secrets — not visible outside the TEE");
```

What happens:

1. `map-entry-set` writes the value into `z:<tid>:secrets`. It is a control-plane write, so it **bypasses the map's `writers` ACL** — the key lands even though the map is read/write-restricted to the contract alone (see [Create tenant KV maps](/developers/adk/tips/create-kv-maps)).
2. At call time your contract reads it back with `kv_store::get("secrets", "duffel_api_key")` inside the TDX enclave.

The only path to the key is through your contract code — no external observer, not the agent, not the calling developer, can read it back out.
