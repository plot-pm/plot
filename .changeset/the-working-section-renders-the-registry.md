---
"@plot-pm/board": patch
---

The WORKING section renders one row per registry entry, not one per branch row
`classify` put there.

A worker in a worktree is a fact about the FLEET; its branch's state is a fact
about the WORK. WORKING used to derive the first from the second — a worker
appeared only where the pulse produced a row for its branch AND `classify` put
that row in WORKING. Both fail routinely for reasons that have nothing to do
with the worker: a scratch branch no plan lists, the branch the board is served
from (`main`), or a branch that merged into DONE. Measured 2026-08-24, the
registry knew 23 agents and WORKING rendered none of them.

The section now iterates `fleet.agents` and joins BACK to a branch row where one
exists. Where a row exists the worker row carries what it knows — plan, wave, PR,
git state — by the same projection the branch's own row uses. Where none exists
the row states only what the registry knows: the worktree and the branch. Absent
is not false. A merged branch keeps its own row in DONE while its worker renders
in WORKING; both are true and neither moves.

The status word is the registry's five-way state, so `someone is on it` narrows
to a genuinely running worker — an idle, stalled, finished or unknown worker each
says its own condition, because a row whose usual state is a lie teaches its
reader to ignore it.

Wave 1 (`Shown`) of `the-working-section-shows-every-worker`.
