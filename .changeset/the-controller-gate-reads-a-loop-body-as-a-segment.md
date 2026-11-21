---
'plot': patch
---

The controller gate reads a loop body, a process read, a program's own text and a `git -C` read the same way it reads a bare segment. It refuses `git diff --ext-diff` and every other `git` run option inside a `for` loop body, and an assignment that only looks like a process read, such as `while X=pgrep plot-approve.mjs x`. It refuses a gated script named inside the text of a program that runs its argument text (`awk`, `python`, `node`, `perl`, `ruby`, `sh -c`, `bash -c`, `zsh -c`, `eval`), while a `gh` comment, a `gh api` body, `echo` and `printf` that cite a gated script still pass. It passes a read-only `git -C <dir> grep|diff|show|log` that names a gated script.

<!--
plan: docs/plans/2026-11-21-the-controller-gate-reads-every-command-segment.md
-->
