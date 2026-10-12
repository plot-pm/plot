---
'plot': minor
---

`plot-verify.mjs` verifies one delivered plan in a pinned run. `prepare` checks out the commit that added `Delivered:` beside a second tree of the default branch that supplies the tools, installs the pin, and lists the files the plan's merged slices changed. `claims` prints the plan's changelog and acceptance items as a numbered list. `fold` reads one juror file per lens and answers one verdict per claim, and refuses a file that omits any `Claim-<n>:` line. `record` books the `Verified:` line and the `## Verification` section through a worktree on `plot/verify-<slug>`. `plot-local-checks.mjs --files <path>` checks a listed set of files and exits 2 on an argument it does not know.

<!--
plan: docs/plans/2026-10-12-the-fleet-verifies-what-it-delivered.md
bumps:
  skills:
    plot: minor
-->
