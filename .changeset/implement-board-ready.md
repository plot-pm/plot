---
"plot": minor
---

`/plot-implement` sets new implementation PRs to **Ready** on a project board.

The board-sync plan promised a five-step mapping from Plot events to board columns. Four were built; the third — *new implementation PRs land in Ready* — was not, so those PRs sat in whatever column GitHub assigned them until `/plot-deliver` moved them to Done. The middle of the lifecycle was invisible on the board, which is the part a board exists to show.

It was missed for a structural reason worth recording. The plan was written for Plot 1, where `/plot-approve` created the implementation branches itself, so the mapping table put the Ready transition there. Plot 2 split that apart: approval only records the approval, and `/plot-implement` starts the work. The step did not go missing so much as its home moved out from under it — and nothing failed, because a board update that never happens looks exactly like a board nobody configured.

The status is set at the one moment the PR both exists and has not been worked on: when the implementing session creates it. That is already the moment the brief asks for the `→ #<number>` annotation, so it is one more line of bookkeeping at a point the session is stopping anyway, rather than a new obligation somewhere else.

<!--
bumps:
  skills:
    plot-implement: minor
-->
