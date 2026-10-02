---
'plot': patch
---

A worker loop that moves to a new desk records itself at that desk only. `plot-worker-loop.sh` copies `.plot-worker.pid` and `.plot-worker.wrapper.pid` to the desk it moves to and empties both files in the desk it leaves, each write a temporary file renamed into place. A reset that keeps the same desk changes nothing.

Measured 2026-10-02: pid 60290 started at `.worktrees/free-9cbeda11` (PR #1197 merged), moved to `.worktrees/plot-wt-bug-the-largest-caller-follows-the-account-rate`, and the old desk still named 60290. `plot-worker-state.sh` read the old desk as `running`, `plot-reap.sh` refused it as a live worker, and `/plot-dispatch --release` refused it too.

The old files are emptied rather than deleted, because `plot-reap.sh` and `plot-reconcile-scan.sh` §21 recognise a dispatch desk by `.plot-worker.pid`. Every reader reads an empty file as no live worker. `plot-monitor-subject.sh` reads an empty pid file beside a `.plot-worker.exit` as `gone`, so a monitor watching the emptied desk still exits when the wrapper records the loop's exit there.

<!--
bumps:
  skills:
    plot: patch
-->
