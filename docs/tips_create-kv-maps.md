> ## Documentation Index
> Fetch the complete documentation index at: https://docs.terminal3.io/llms.txt
> Use this file to discover all available pages before exploring further.

# Create Tenant KV Maps

A TEE contract needs one map before it can run: `secrets`, holding the API key. Create it with the `TenantClient`. The `tail` is the per-map local name; the host stores it as `z:<tid>:<tail>`.

```typescript theme={null}
await tenant.maps.create({
  tail: "secrets",
  visibility: "private",
  writers: { only: [contractId] },
  readers: { only: [contractId] },  // REQUIRED — the kv-governor denies reads when omitted
});
```

`readers` **must** be set explicitly — the KV governor defaults to **deny**, so leaving it off makes the contract's own secret read fail with `AccessDenied`. `MapAlreadyExists` is idempotent — safe to re-run when re-deploying.

**Map visibility quick reference:**

* `"private"` — only your contracts can access this map (default, use it for everything sensitive).
* `"public"` — world-readable via `/api/dev/public-kv/<tid>/<tail>`. Map tail must start with `public:`. Never put PII in a public map.

<Note>
  `writers`/`readers` restrict your **contracts**, not you. As the map's owner you can always write its entries directly via the control plane (`tenant.executeControl("map-entry-set", …)`), even on a `writers: { only: [contractId] }` map — that's how [seeding the API key](/developers/adk/tips/seed-api-key) works. A contract-only map is **not** tamper-proof against its owner; see [Storage Namespaces → Access model](/t3n/how-t3n-works/z-namespace#access-model).
</Note>
