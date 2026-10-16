---
'plot': patch
---

The Writer App push now clears any configured `credential.helper` for its one `git push` call, so an ambient credential cannot supply a second, uncontrolled source alongside the askpass token (fixing #1824). A malformed or unreadable App key is now caught inside the shared `installationToken` exchange and reported as a named refusal instead of an unhandled rejection, which also fixes the same class of crash for the Merger App. `plot-push-main.sh` gained a fifth `classify` outcome, `refused`, for exit 3 and 4 — a repo-unresolvable or token-exchange failure the Writer App reports before it ever attempts a push — and `ladder.ts`'s `commitAndPush` now stops on that outcome instead of spending its remaining retry attempts on a push that cannot succeed twice in a row.

<!--
plan: docs/plans/2026-10-16-bitbucket-parity-and-app-identities.md
bumps:
  skills:
    plot: patch
-->
