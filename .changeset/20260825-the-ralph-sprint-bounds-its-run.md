---
"@plot-pm/board": patch
---

ralph-plot-sprint: the runner bounds its own run

Recovers the budget machinery from PR #57 — the last substantive thing that PR
still held after #423 took its documentation. Measured 2026-08-25: main had
**zero** occurrences of `budget`, `ship-partial` or `deliverable checkpoint` in
`ralph-sprint.sh`; the July branch has 27, 9 and 21.

**Not a rebase.** #57 is 1738 commits behind main and conflicts in six files —
none of them these two. The two ralph files were three-way merged onto current
main instead, so both sides survive: July's budget, checkpoint and ship-partial
machinery, and main's later `PLOT_UNATTENDED` handling and version bump.

This is the mechanism half of `opus5-longhorizon-hardening`, whose tracer was
built to prove exactly this: that a config-driven budget can bound an unattended
loop and ship partial work before the bound rather than after. Its documentation
half landed in #423; the plan said the mechanism stayed open. It no longer does.
