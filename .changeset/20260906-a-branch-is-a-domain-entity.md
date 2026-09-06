---
'plot': minor
---

`SourceBranchSchema` becomes `BranchSchema`, and the rules that judge a branch move onto it. The type is a home for the rules rather than a wrapper round a string — the wrapper framing did not survive measurement: only four fields in the whole domain are a bare branch string, none is a plan slug, and this repo has no branded-type precedent. A `Branch` that only stopped a slug being passed where a branch belongs would move no judgement.

**What was scattered is the judging.** `plot-reap.sh`'s five refusals and `plot-release-refs.sh`'s five guards were the same question asked about the same thing in two scripts that must never disagree — and measured 2026-09-06, they already did. The ref-deleter never asked whether a worker was alive; the reaper never asked whether a PR was open. Each was blind to a guard the other applied.

**They are now one rule with two callers.** `refDeletionProblems` joins `reapProblems` in `rules/reapable.ts`, sharing its readings, and `plot-release-refs.sh` holds no `if` about whether a ref may go — it takes the readings and asks, exactly as the reaper does. All ten readings survive and the ref-deleter gains the three it lacked: a live worker in the branch's worktree, uncommitted work there, and a `PLOT-BLOCKED` marker. Deleting a ref out from under a running worker is the failure that cannot be repaired.

**The asymmetry is preserved and stated in the code.** A reaped checkout comes back with `git worktree add`; a deleted ref does not. That is why the reaper is slug-blind and the ref-deleter is scoped to one plan, and the shared rule flattens neither: it answers about the branch it was handed, reads no plan and enumerates nothing. The rule answers the question; each caller keeps its own scope.

`openPr` is a reading rather than the negation of the merge reading, because a branch carries both — `changeset-release/main` is merged repeatedly and Changesets recreates and reuses it, so its ref holds a live release PR while an older PR of its own has merged.

<!--
plan: docs/plans/2026-09-04-every-element-is-a-domain-concept.md
bumps:
  skills:
    plot: minor
-->
