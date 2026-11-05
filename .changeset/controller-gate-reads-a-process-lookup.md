---
'plot': patch
---

The controller gate reads `pgrep`, `ps` and `lsof` as reads, so `while pgrep -f "plot-approve.mjs <slug>" >/dev/null; do sleep 15; done` is no longer refused as a run of `plot-approve`. The command is read with `readShell` and must be one simple command after at most one leading `while` or `until`. A `pgrep` signal option (`--signal`, `-<digits>`, `-KILL`), a substitution, an assignment prefix, and a pipeline with a non-read segment (`pgrep -f x | xargs kill`) keep the command a run.

<!--
plan: docs/plans/2026-11-04-controller-gate-refuses-read-only-commands.md
bumps:
  skills:
    plot: patch
-->
