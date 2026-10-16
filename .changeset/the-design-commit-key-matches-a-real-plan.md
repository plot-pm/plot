---
'plot': patch
---

`designCommitOf` in `auto-design.ts` and `design.ts` read a plan's `Design:` commit via `refs.recordCommit(file, 'Design')` now, instead of a `/^Design:\s*(\S+)/m` regex that never matched the real bulleted-bold `- **Design:** ...` shape a plan actually writes — every key read as `''`, so a failed-then-retried spec run could never be told apart from a fresh one under a newer `Design:` commit. `design.ts`'s `restart` command also now judges a branch "spec written" by reading the `## Spec` section's content via `specIsEmpty`, the same way `settleDesignRun` already did, instead of by counting commits past default — a commit that touched something other than `## Spec` no longer reads as "written".

<!--
plan: docs/plans/2026-10-16-fleetd-scan-cost-and-read-cadence.md
bumps:
  skills:
    plot: patch
-->
