/**
 * Diagnostic: does a *documented, definitely-existing* function also fail?
 *
 * `agent-auth-update` on tee:user/contracts is step 2 of the published invoke
 * walkthrough, so an "unknown function" explanation for the -32603 can be
 * ruled in or out. A self-grant (agentDid = own DID) is the documented
 * direct-call form, so this is a legitimate walkthrough step, not a probe with
 * side effects beyond what the tutorial itself does.
 */
import { getContractVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { connect, requireEnv } from "./session.js";

const baseUrl = getNodeUrl();
const { t3n, did } = await connect(requireEnv("T3N_API_KEY"));
console.log("did:", did);

const v = await getContractVersion(baseUrl, "tee:user/contracts");

async function attempt(label: string, fn: string, input: unknown) {
  try {
    const out = await t3n.executeAndDecode({
      script_name: "tee:user/contracts",
      script_version: v,
      function_name: fn,
      input,
    });
    console.log(`\n${label} -> OK`);
    console.log(JSON.stringify(out, null, 2).slice(0, 600));
  } catch (err: any) {
    console.log(
      `\n${label} -> ${err?.code ?? "ERR"} ${err?.httpStatus ?? ""} ${err?.detail ?? err?.message ?? ""} [req ${err?.requestId ?? "-"}]`,
    );
  }
}

// Documented, real function.
await attempt("agent-auth-update (documented)", "agent-auth-update", {
  agents: [
    {
      agentDid: did,
      scripts: [
        {
          scriptName: "z:deadbeef:noop",
          versionReq: "0.1.0",
          functions: ["noop"],
          allowedHosts: ["example.com"],
        },
      ],
    },
  ],
});

// Deliberately nonsense, to see whether an unknown function is distinguishable
// from the -32603 everything else returns.
await attempt("definitely-not-a-function", "zzz-not-a-real-function", {});
