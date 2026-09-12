---
'@plot-pm/board': patch
---

Auto-dispatch runs the configured `Brief command` for a plan it skipped as `no-brief`, then claims the slice on a later pulse — so an approved plan with a free agent no longer waits for an operator. Measured 2026-09-12 across seven dispatches in one session: each reported `brief_asked=1 dispatched=0` and the claim followed 60–75 seconds later, once a human's brief reached `origin/main`. It asks without awaiting and claims nothing on that pass, because the gate reads `origin/<main>` rather than the filesystem. One ask per plan, never a second while one is outstanding, and the ask is charged against the agent budget because a brief writer is a process like any other. An unset or `none` command is today's behaviour exactly: the skip is logged and nothing spawns.
