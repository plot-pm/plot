---
'plot': patch
---

Plot's helper-script reference moves to `skills/plot/scripts/README.md`, and `CLAUDE.md` names it in two lines. Every session, fleet worker and subagent loaded that table on its first request — 84,352 of 139,389 characters, 61% of the file — and nothing parsed a row of it. `CLAUDE.md` is now 55,287 characters. `scripts/check-helper-table.sh` runs in CI and keeps the table out, refusing a restored table, a `plot-` row, and a new script with no row in the README.

<!--
plan: docs/plans/2026-10-02-an-agent-starts-with-what-it-reads.md
bumps:
  skills:
    plot: patch
-->
