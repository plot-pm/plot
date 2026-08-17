---
"plot": minor
---

The scan reports that a branch cannot MOVE, not only what it is

`plot-fleet-scan.sh` has always reported what a branch *is* — claimed, eligible,
blocked, in progress. Five branches got stuck in one afternoon on 2026-08-17 and
not one of them showed up as anything but normal:

| Incident | What it cost |
|---|---|
| #176 artifact conflict | recreate worktree, take a side, rebuild, 547 tests |
| #177 artifact conflict | the same again |
| #177 rebase never pushed | noticed by accident; 30 minutes of dead CI |
| #179 Playwright CDN `403` | read the log, compare run history, rerun |
| #172 fixture regression | add the missing field |

The #177 case is the sharp one: from outside, a rebase that stayed local is
indistinguishable from an agent that stopped.

**Four stuck states, each named separately, each with its evidence.** *Stuck* as
one label would be the one-label-many-states defect this repo keeps removing —
the four differ in the only way that matters, which is what a person does next:
an artifact-only conflict, a real conflict, unpushed work, and a failing check.

**Artifact-only is not artifact-among.** The mechanically resolvable case is a
conflict set of *exactly one file*, that file being the board artifact. A
conflict touching the artifact *and* anything else needs judgement as a whole,
even though one of its files does not. An implementation asking *is the artifact
among the conflicts?* passes the artifact-only case and silently misclassifies
every mixed one, so the set — not the artifact's presence in it — decides.

**A failing check is reported as evidence and never judged.** The row carries
the failing check names, the branch's changed paths, and the branch's own recent
run history; a human concludes. A heuristic mapping failing steps to changed
paths was rejected: that table is unmaintained by construction and goes silently
wrong the first time a workflow is restructured (Principle 3).

**Unpushed work is reported and never fixed.** Pushing someone else's
uncommitted judgement is not mechanical, and the count is true only on the
machine doing the looking.

**A branch that is not stuck produces nothing.** A watcher that flags everything
flags nothing.

Read-only and stateless throughout. `git merge-tree --write-tree` computes the
merge entirely in memory, so a conflict is *foreseen* rather than present, and
every state is re-derived from git and the host on each run — there is no
watcher state to become stale.

New in the pulse: `conflicts`, `conflicts_known` and `changed_paths` per branch.
`conflicts_known` is what keeps an empty list from meaning two things, since
*merges cleanly* and *nobody could ask* arrive in the same shape. New on the
host adapter: `failing_checks` on `pr-list --rich` (same response, no extra
call) and a `runs <branch>` op, metered and asked only where a failure has
already been observed.

The display is a separate wave, and the one granted repair another: this writes
nothing, pushes nothing and resolves nothing.

<!--
bumps:
  skills:
    plot: minor
-->
