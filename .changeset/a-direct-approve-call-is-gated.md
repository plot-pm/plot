---
'plot': patch
---

A direct `node skills/plot/scripts/board/plot-approve.mjs` call now meets the controller gate, as a call to `plot-approve.sh` does. The approve entry also clears an indented `.plot/hold` entry, writes the `Approved:` and `Delivered:` dates in the local time zone, names no `pr-state` exit code the host port does not carry, and removes its booking worktree on any failure.

<!--
plan: docs/plans/2026-10-09-the-shell-sheds-its-decisions.md
-->
