/**
 * Shared session helpers.
 *
 * The published Quickstart tells you to keep appending to a single
 * `quickstart.ts`, because `t3n` and `tenantDid` are plain locals. That works
 * but does not survive past the first script, so the same flow is factored
 * here and imported by `deploy.ts` and `invoke.ts`.
 */
import {
  T3nClient,
  TenantClient,
  setEnvironment,
  getEnvironment,
  loadWasmComponent,
  eth_get_address,
  metamask_sign,
  createEthAuthInput,
  fetchTrustedManifest,
  getNodeUrl,
} from "@terminal3/t3n-sdk";

/** The SDK defaults to production — set this explicitly while building. */
setEnvironment("testnet");

/**
 * Resolve the trust anchor that pins the node's DKG attestation.
 *
 * The published Quickstart constructs `T3nClient` without this and does not
 * run — `trustAnchor` is required with no default (BUGS.md BUG-09).
 *
 * `fetchTrustedManifest` pulls the operator-signed manifest and verifies it
 * against a key baked into the SDK, so it never returns an unverified anchor.
 * Fetched once per process and reused, as the SDK's own docs instruct.
 *
 * The `{ unsafe_trust_server: true }` opt-out disables attestation
 * verification entirely. It stays behind an explicit env var so it can never
 * be reached by accident.
 */
let anchorPromise: ReturnType<typeof fetchTrustedManifest> | undefined;

async function trustAnchor() {
  if (process.env.T3N_UNSAFE_TRUST_SERVER === "true") {
    console.warn(
      "WARNING: attestation verification disabled via T3N_UNSAFE_TRUST_SERVER",
    );
    return { unsafe_trust_server: true } as const;
  }
  anchorPromise ??= fetchTrustedManifest(getEnvironment());
  return anchorPromise;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env, fill it in, and run with --env-file=.env`,
    );
  }
  return value;
}

/** One authenticated T3N session built from a credential. */
export async function connect(apiKey: string) {
  const wasmComponent = await loadWasmComponent(); // all crypto runs in here
  const address = eth_get_address(apiKey);

  const t3n = new T3nClient({
    wasmComponent,
    trustAnchor: await trustAnchor(),
    handlers: { EthSign: metamask_sign(address, undefined, apiKey) },
  });

  await t3n.handshake();
  const did = await t3n.authenticate(createEthAuthInput(address));

  // Never derive or hardcode this — read it back from the session.
  return { t3n, did: did.value as string, wasmComponent };
}

/**
 * Authenticate as the tenant and build the TenantClient used to manage the
 * deployment.
 *
 * `baseUrl` is passed explicitly on purpose: omitting it is a documented
 * failure mode that surfaces as a confusing throw from `tenant.me()`.
 */
export async function connectTenant() {
  const { t3n, did: tenantDid } = await connect(requireEnv("T3N_API_KEY"));

  const tenant = new TenantClient({
    t3n,
    baseUrl: getNodeUrl(),
    tenantDid,
  });

  // The Quickstart documents `tenant.me()`, which does not exist — `me()` lives
  // on the `tenant` namespace, so the call is `tenant.tenant.me()`.
  // See BUGS.md BUG-10.
  const me = await tenant.tenant.me();

  return { t3n, tenant, tenantDid, me };
}

/** `did:t3n:<hex>` → `<hex>`, which is the `tid` in every `z:<tid>:<tail>` name. */
export function tidOf(tenantDid: string): string {
  return tenantDid.slice("did:t3n:".length);
}
