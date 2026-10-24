---
'plot': patch
---

Fixed `plot-host.sh`'s `issue-label` op failing a plan-state write when the repository lacked one of the `plan:*` labels (#2054, #2055): a single `gh issue edit --add-label --remove-label a,b,c,d` call failed outright when any removed label did not exist in the repository, and because the add had already landed before the failure, the issue was left carrying two `plan:*` labels at once. `issue-label` now reads the issue's current labels first and removes only the ones it actually carries, creates the label being added when the repository lacks it (treating "already exists" as success), and applies both the add and the remove in one `gh issue edit` call so a failure leaves the issue unchanged. A write against an issue already carrying two phase labels now ends with exactly one.

<!--
plan: docs/plans/2026-10-24-plan-state-write-fails-when-a.md
bumps:
  skills:
    plot: patch
-->
