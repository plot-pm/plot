---
'@plot-pm/board': patch
---

Passkey registration succeeds with a password-manager authenticator: when `getPublicKey()` returns no key, the board reads the ES256 public key from the attestation object and registers it as SPKI DER.

<!--
plan: docs/plans/2026-11-07-passkey-registration-moves-to-a-settings.md
bumps:
  skills:
    plot: patch
-->
