---
"plot": patch
---

reconcile: add section 9 — sprint drift

A plan whose `Sprint:` field disagrees with the sprint file listing it, or is
empty while a sprint lists it, is now reported. Also reports sprint members
whose slug names no plan.

The sprint file is the truth; when a plan's `Sprint:` disagrees, the plan's
field is what needs editing, not the sprint file's membership. The section is
ACTIONABLE BUT NON-BLOCKING — it carries its own footer counter (`sprint_drift=`)
and does not affect the `attention=` count that gates delivery.

<!--
bumps:
  skills:
    plot-reconcile: patch
-->
