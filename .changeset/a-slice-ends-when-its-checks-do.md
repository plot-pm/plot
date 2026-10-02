---
'plot': patch
'@plot-pm/board': patch
---

A fleet agent keeps its slice until its pull request's checks have a result, so a failed CI run reaches it as a correction. Before, the agent let go of the slice when its prompt ended, minutes before CI reported; measured 2026-10-02, the agent on #1168 opened its PR, took another slice in the same desk, and CI failed eight minutes later with no slice for the correction to reach. After a prompt ends, the loop waits while the branch's head is pushed, an open PR carries it, and the BuildMonitor has no result for that head, for up to `Checks wait` seconds (default 1800; `0` disables it). The new rule `checksVerdict` decides, asked through `plot-checks-verdict.mjs` once a minute. The BuildMonitor now reads the desk's checked-out branch on every pass: it read the branch once at start, so for a free agent, which starts with none, it never published a finding, and for an agent that hopped it reported the old branch.

<!--
plan: docs/plans/2026-10-02-an-agent-runs-the-tests-its-change-touches.md
bumps:
  skills:
    plot: patch
-->
