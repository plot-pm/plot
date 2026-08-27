---
"@plot-pm/board": patch
---

A branch that carries commits gets a row, whether or not anyone opened a PR.

The plan-less row loop iterated **PRs**, which made *has an open PR* an unstated
precondition for appearing on the board at all: a branch with commits and no PR
was in neither collection — no plan named it, so the plan walk missed it, and no
PR existed, so the PR loop never reached it. Measured 2026-08-24 against the live
board: 33 remote branches, 105 rows, and 8 unmerged branches with **no row**.
Four of those were named by a plan — invisible *despite* being planned — so the
finding is not "plan-less work is invisible" but *work with no open PR is
invisible, plan or no plan*.

The subject inverts: the **branch** is the row and its PR, if any, is one fact
about it, which is already how planned rows work. The union walked is
`git branch -r --no-merged origin/<main>`, read on the scan's clock beside the
branch ages because `rowsFromPulse` is the synchronous render path and cannot
spawn a process.

`--no-merged` is the **bound** rather than an optimisation: a merged branch has
nothing outstanding, so the addition grows with abandoned work rather than with
history. Rows are `kind: 'branch'` and `state: 'wip'` — no new row kind, and no
new state — so `classify` routes them through its existing arms into NOT STARTED
while recent and QUIET once stale. None can reach WAITING ON YOU: no PR is handed
over, and every `waiting-on-you` arm requires a PR record.

The set is read from the refs each scan and is **empty on failure**, where empty
means *not looked at* rather than *nothing unmerged* — a failed read renders the
board exactly as it did before the field existed. It is deliberately not bridged
across a `node --watch` restart, since such a restart is frequently *for* a merge
and a bridged set would render freshly-merged branches as outstanding work.
