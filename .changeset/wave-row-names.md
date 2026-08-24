---
"@plot-pm/board": patch
---

Fix one-wave plan rows showing branch names instead of wave names

A plan with one wave was rendering branch rows directly instead of wave rows,
which caused the wave's name (e.g., "Derived", "Named") to be replaced by the
branch name (e.g., "bug/a-wave-head-says-what-its-verdict-says"). The wave row
is now always rendered regardless of wave count, but for one-wave plans the
Start work control stays on the plan row rather than duplicating on the wave row.
