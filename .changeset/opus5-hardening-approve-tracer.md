---
"plot": minor
---

`plot-approve` step 2b now treats a tracer bullet as the **default recommendation** for plans with technical uncertainty or a long horizon, rather than an optional suggestion mentioned in passing.

The long-horizon trigger is broadened from "3+ branches AND a natural core-plus-extras decomposition" to "3+ branches OR work that will not produce anything merged for several working sessions" — the second form catches plans that are slow without being wide.

Still never a gate. Proceeding without a tracer remains one answer away, and a plan that does not need one is not slowed down. The change is that when the heuristic fires, the recommendation comes with its reason stated: a thin vertical slice produces something integrated and merged early instead of after the whole plan.

<!--
bumps:
  skills:
    plot-approve: minor
-->
