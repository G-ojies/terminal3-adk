/**
 * Does T3N host anything that could serve an LLM chat agent?
 *
 * getContractVersion resolves for a registered contract and 404s otherwise, so
 * this enumerates plausible system-contract names to see what actually exists
 * on the cluster.
 */
import { getContractVersion, getNodeUrl } from "@terminal3/t3n-sdk";

const baseUrl = getNodeUrl();

const CANDIDATES = [
  // known-good, as controls
  "tee:user/contracts",
  "tee:tenant/contracts",
  // inference / model serving
  "tee:inference/contracts",
  "tee:llm/contracts",
  "tee:chat/contracts",
  "tee:model/contracts",
  "tee:ai/contracts",
  "tee:completion/contracts",
  "tee:agent/contracts",
  "tee:agent-connect/contracts",
  "tee:agent-registry/contracts",
  // other system contracts referenced in the WIT / docs
  "tee:vc/contracts",
  "tee:organisation/contracts",
  "tee:payroll/contracts",
  "tee:delegation/contracts",
];

console.log(`node: ${baseUrl}\n`);
for (const name of CANDIDATES) {
  try {
    const v = await getContractVersion(baseUrl, name);
    console.log(`EXISTS   ${name.padEnd(32)} @ ${v}`);
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    console.log(`absent   ${name.padEnd(32)} ${/404/.test(msg) ? "(404)" : msg.slice(0, 60)}`);
  }
}
