---
'@plot-pm/board': minor
---

The verify workflow keeps `docs/releases/vnext-checklist.md` current as plans verify: one `- [ ]` item per plan, `verified N/N` or `refuted` with its issue reference under a `## Refuted` heading, written in the same commit as the plan's `Verified:` record. `/plot-release rc` edits that file in place once it exists, adding only its `RC:` line and version heading, rather than regenerating it. The final release renames it only once an RC round opened it, and the no-argument version check no longer mistakes a bare `vnext-checklist.md` for an open RC round. `/plot-release` also lists refuted and unverified plans before determining a version, naming `/plot-reject` as the remedy for a refuted one.

<!--
plan: docs/plans/2026-10-12-the-fleet-verifies-what-it-delivered.md
bumps:
  skills:
    plot-release: minor
-->
