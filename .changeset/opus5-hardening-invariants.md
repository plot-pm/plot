---
"plot": minor
---

New Manifesto Principle 10: **an agent that has gone quiet has failed, not finished.** Unattended agent work must produce an observable trace, and any Plot command running unattended must bound how long it may run and ship partial work with a handover before that bound is reached. This is the agentic case of Principle 1 — work that never reached git did not happen, no matter how the agent narrates it.

A second candidate principle ("evidence over assertion") was considered and rejected: Principle 1 already states it in its strongest form, and checklist question 5 says remove what does not add something essential.

`plot-reconcile` now states read-only-ness as a **design invariant** rather than a description of current behaviour. The skill was already read-only in four places, but all four were present-tense descriptions that a future "and fix the safe ones automatically" edit would have contradicted without violating any stated rule. A scan that repairs what it finds cannot report independently on its own work — and `plot-deliver` Step 7b depends on that independence.

The 8-question decision checklist is unchanged.

<!--
bumps:
  skills:
    plot: minor
    plot-reconcile: patch
-->
