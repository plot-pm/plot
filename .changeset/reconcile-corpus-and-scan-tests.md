---
'plot': patch
---

Three "tests that cannot fail" fixtures from issue #2479 now actually discriminate: the open-PR corpus test exercises the MERGED transition `waitVerdict` treats as the only meaningful wait-state change, the slice-chain corpus test's motivating case no longer depends on a live plan's heading shape surviving the next reslice, and the Jira issue-key precedence test stubs its decoy key as open rather than closed so an always-append regression can no longer hide behind the per-key host check.

<!--
plan: docs/plans/2026-10-24-reconcile-scan-sections-7-20-24.md
bumps:
  skills:
    plot: patch
-->
