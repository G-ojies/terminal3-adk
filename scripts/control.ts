/**
 * Direct control-plane client for `tee:tenant/contracts`.
 *
 * The SDK's `TenantClient` helpers (`tenant.me()`, `maps.create()`,
 * `contracts.register()`) are out of sync with the node this testnet runs:
 * they send `contract_id`/`contract_version` where the node's action.execute
 * wants `script_name`/`script_version`, and they use different function and
 * field names. See BUGS.md BUG-09 through BUG-12.
 *
 * This module talks to the node directly using the names the node actually
 * accepts, discovered by probing its deserialization errors:
 *
 *   node function      SDK helper                fields
 *   tenant-me          tenant.tenant.me()        {}
 *   map-create         maps.create()             { map_name, visibility, writers, readers }
 *   map-entry-set      executeControl(...)       { map_name, key, value }
 *   contract-register  contracts.register()      { name, version } + multipart blob
 *
 * Every name is fully canonical (`z:<tid>:<tail>`) — the node rejects bare tails.
 */
import { getContractVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { connect, requireEnv, tidOf } from "./session.js";

export const CONTROL = "tee:tenant/contracts";

export async function controlClient() {
  const baseUrl = getNodeUrl();
  const { t3n, did } = await connect(requireEnv("T3N_API_KEY"));
  const version = await getContractVersion(baseUrl, CONTROL);
  const tid = tidOf(did);

  /** Fully-qualified `z:<tid>:<tail>` name. */
  const canonical = (tail: string) => `z:${tid}:${tail}`;

  async function exec<T = unknown>(fn: string, input: unknown): Promise<T> {
    return (await t3n.executeAndDecode({
      script_name: CONTROL,
      script_version: version,
      function_name: fn,
      input,
    })) as T;
  }

  async function execWithBlob(fn: string, input: unknown, blob: Blob) {
    return await t3n.executeWithBlob(
      { script_name: CONTROL, script_version: version, function_name: fn, input },
      blob,
    );
  }

  /** Run an operation, swallowing the node's idempotent "already exists". */
  async function idempotent<T>(label: string, op: () => Promise<T>): Promise<T | undefined> {
    try {
      return await op();
    } catch (err: any) {
      const detail = String(err?.detail ?? err?.message ?? "");
      if (/already exists/i.test(detail)) {
        console.log(`  ${label}: already exists, continuing`);
        return undefined;
      }
      throw err;
    }
  }

  /**
   * Retry a control call that fails with `access denied`.
   *
   * A `map-entry-set` issued immediately after a `map-update` on the same map is
   * sometimes refused with
   *   access denied: StorageRouterOnBehalfOf(Contract(tee:tenant/contracts))
   *   cannot write map "z:<tid>:secrets"
   * yet the identical call succeeds moments later, with the ACL unchanged. It
   * looks like the ACL change has not settled for the governor when the write
   * arrives. Observed request ids: a4063032-0d48-47ab-8858-13b79586ec00,
   * 6f7cf2e7-f890-4ecd-b5fa-119203f0bffc. See BUGS.md BUG-17.
   */
  async function execRetryingDenied<T = unknown>(
    fn: string,
    input: unknown,
    attempts = 4,
  ): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await exec<T>(fn, input);
      } catch (err: any) {
        lastErr = err;
        const detail = String(err?.detail ?? err?.message ?? "");
        if (!/access denied/i.test(detail)) throw err;
        const waitMs = 750 * (i + 1);
        console.log(`  (access denied on ${fn}, retrying in ${waitMs}ms)`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    throw lastErr;
  }

  return {
    t3n,
    did,
    tid,
    baseUrl,
    version,
    canonical,
    exec,
    execWithBlob,
    idempotent,
    execRetryingDenied,
  };
}

/** Readable one-line form of an RpcError. */
export function describeError(err: any): string {
  return `[${err?.httpStatus ?? "?"}] ${err?.detail ?? err?.message ?? String(err)}${
    err?.requestId ? ` (req ${err.requestId})` : ""
  }`;
}
