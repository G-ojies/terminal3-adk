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

  return { t3n, did, tid, baseUrl, version, canonical, exec, execWithBlob, idempotent };
}

/** Readable one-line form of an RpcError. */
export function describeError(err: any): string {
  return `[${err?.httpStatus ?? "?"}] ${err?.detail ?? err?.message ?? String(err)}${
    err?.requestId ? ` (req ${err.requestId})` : ""
  }`;
}
