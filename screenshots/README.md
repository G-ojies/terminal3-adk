# Screenshots

Genuine captures of real runs against the live testnet — each one is an X11
window capture of the command actually executing, not a rendering of saved text.
The command being run is printed at the top of every image.

Reproduce any of them with [`scripts/shoot.sh`](../scripts/shoot.sh).

| | Shows |
|---|---|
| [1-register-and-maps.png](1-register-and-maps.png) | Registering the Rust TEE contract on testnet: tenant status `active`, quotas, the 184 KiB component uploaded as contract id 717, three KV maps created and their ACLs re-pointed, secret sealed, policy seeded. |
| [2-end-to-end-invoke.png](2-end-to-end-invoke.png) | The full flow. First `check-eligibility` resolves PII host-side, calls the verifier and issues an attestation (`reused:false`); the second returns the identical digest with `reused:true` and no outbound request; `verify-attestation` accepts the genuine digest and rejects a tampered one with `digest_mismatch`. |
| [3-placeholder-resolution-proof.png](3-placeholder-resolution-proof.png) | Proof that the host really substitutes profile values. A policy allowing only DE/FR is evaluated against a profile whose `residence_country` is NG, and the verdict flips to `country_not_permitted` — on a value the contract never held. |
| [4-tenant-me-not-a-function.png](4-tenant-me-not-a-function.png) | BUG-10 reproduced live: the documented `await tenant.me()` throws `TypeError: tenant.me is not a function`, and where `me()` actually lives. This is the top unanswered comment on the bounty listing. |
| [5-bug01-does-not-compile.png](5-bug01-does-not-compile.png) | BUG-01 reproduced against Terminal 3's own reference contract. Applying the documented instruction ("do not `hex::encode` it again") produces `error[E0277]: Vec<u8> doesn't implement std::fmt::Display`. |
| [6-test-suite.png](6-test-suite.png) | 38 tests passing — 23 Rust unit tests covering digest stability, PII-absence, inline-PII rejection and constant-time comparison, plus 15 TypeScript tests covering the verifier's age-boundary logic. |

Note on 1 vs 2: the contract id differs across images (717 here) because every
`contract-register` mints a new one — that is BUG-15, and the reason
`scripts/deploy.ts` re-points the map ACLs on every deploy.
