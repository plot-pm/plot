---
'plot': patch
---

The implement lock is a file beside the plan's state file, so a second process sees the board's run and the dispatch command returns once the implement has started. It records the holder's pid, start time and process group and the agent the run started, and holds while either process lives under its recorded start time, or while the group of a holder killed alone has a member, for at most the implement bound plus one minute. A stale lock is replaced only under a guard file, so two starts that read it stale cannot both win. Each dispatch command launch writes its own launch log.

<!--
plan: docs/plans/2026-10-10-the-controllers-close-their-review-findings.md
bumps:
  skills:
    plot-dispatch: patch
-->
