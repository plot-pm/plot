---
'plot': patch
'@plot-pm/board': patch
---

Plot's helper scripts create every temporary path under `TMPDIR` through one helper, `plot-tmp.sh`, and one exit registry removes them. A fleet scan no longer leaves a cache directory of about 955 files behind on every run, and an INT or TERM now stops a script with 130 or 143 instead of letting it run on to exit 0. `plot-reap.sh --sweep-temp` removes old `plot-*` temp entries and dead-pid budget memos that a SIGKILL left, `plot-registryd.mjs --sweep-temp` runs that sweep at most once an hour, and `/plot-reconcile` reports the counts. A new CI gate refuses a temp path created outside the helper and a delete by glob in a shared temp directory.

<!--
plan: docs/plans/2026-09-30-every-temp-directory-has-an-owner.md
bumps:
  skills:
    plot: patch
    plot-reconcile: patch
-->
