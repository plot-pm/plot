---
"plot": patch
---

plot-approve.sh is now an 11-line launcher over board/plot-approve.mjs, a JS entry that reads the plan and its PR through the domain ports, refuses before any merge, and writes the state receipt only after the plan file is written.

<!--
plan: docs/plans/2026-10-09-the-shell-sheds-its-decisions.md
bumps:
  skills:
    plot-approve: minor
-->
