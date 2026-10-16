---
'plot': patch
---

A crashed `plot-config.sh` read for `Review app`, `Writer app` or `Merger app` now refuses by name (exit 4) instead of silently falling back to the ambient `gh`/host identity as if the key were simply undeclared (exit 5, unchanged for a genuinely absent key) — fixing #1824 and #1827. `plot-commit-status.mjs` no longer signs an unused JWT before minting its installation token, and a failed `gh repo view` now names itself in the `commit-status`/`pr-merge` refusal text instead of a bare "could not resolve owner/repo". No new exit code is introduced; only which of the existing 4/5 refusal paths a caller sees for a crash versus a true absence changes.

<!--
plan: docs/plans/2026-10-16-bitbucket-parity-and-app-identities.md
bumps:
  skills:
    plot: patch
-->
