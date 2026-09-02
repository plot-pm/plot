---
"@plot-pm/board": minor
---

Auto-dispatch names the plan it skipped and why. A plan whose every startable branch was filtered out reached `if (startable === 0) continue;` and left no trace — the branch logs named the branches, nothing named the plan. `skippedPlans()` reads the same three filters the planner reads, in the same order, and reports one of four reasons: `no-brief`, `ref-held`, `in-flight`, `no-eligible-wave`. A plan skipped for briefs is now distinguishable from one skipped for anything else.
