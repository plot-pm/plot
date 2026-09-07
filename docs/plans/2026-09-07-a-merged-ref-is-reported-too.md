# A merged ref is reported too

> Section 17 reports a branch with **no PR ever**. Nine branches whose PRs had merged kept their refs for weeks, and nothing named them — including the section written to find exactly this.

## Status

- **State:** Approved
- **Type:** bug
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-07, Jan Wloka, plan-PR #794 merged

## Changelog

- The reconcile scan reports a remote ref whose PR merged, so a branch that finished is not left behind by the section that finds unfinished ones.

## Motivation

**Measured 2026-09-07.** After section 17 reported `unclaimed_work=8` and all eight were resolved, the estate still held **15 remote branches**. Nine had **merged PRs**:

| branch | PR | files |
|---|---|---|
| `feature/the-scan-reads-a-fleet-reading` | #600 | 56 |
| `feature/the-shell-stops-parsing-plans` | #577 | 13 |
| `feature/the-board-reads-the-quiet-kinds` | #683 | 12 |
| `feature/one-answer-to-did-this-land` | #691 | 11 |
| `feature/a-monitor-is-a-pure-rule` | #610 | 8 |
| …and four more | | |

**Section 17's predicate is `no plan names it AND no open PR carries it`**, so a branch whose PR **merged** fails the second test and is never reported. The section written to surface unclaimed work is blind to the largest population of stale refs on the estate.

**`plot-release-refs.sh` IS THE RIGHT TOOL AND IT IS PLAN-SCOPED.** It deletes the merged refs of **one plan's** branches, deliberately: *"a sweep over every merged ref on the estate satisfies 'a delivered plan's merged branches lose their refs' and destroys unlanded work belonging to plans nobody delivered."* That argument holds. **But it means a merged branch whose plan was never delivered — or which no plan names — is reached by nothing**, and nine of them accumulated.

**THE SCAN IS THE RIGHT PLACE BECAUSE IT REPORTS AND NEVER DELETES.** The blast-radius argument that keeps `plot-release-refs.sh` plan-scoped does not apply to a finding: naming a ref costs nothing and un-naming it is free.

## What this is not

**Not a change to `plot-release-refs.sh`'s scope.** Its plan-scoping is the safety argument for an irreversible operation, and this plan does not touch it.

**Not a sweep.** Nothing here deletes. The section names refs and the three answers a person has.

**Not a merge into section 17.** *No PR ever* and *PR merged, ref still here* are different facts with different actions — the first may be unfinished work, the second is finished work not cleaned up. One counter answering both is one a reader must re-derive the split from.

## Slices

### The scan reports a merged ref (Branch: bug/a-merged-ref-is-reported-too, PR: #804)

A new advisory section names a remote branch whose PR merged and whose ref still exists.

**IT ASKS THE HOST, THROUGH THE ONE ANSWER.** `plot-pr-merged.sh` reads `mergedAt`, never `state` and never ancestry. Do not re-derive: squash-merge leaves a branch ahead of main forever, and `git merge-base` disagreed with the host on **ten of ten** measured here.

**BELOW `== blocking sections end ==`**, with its own footer counter. A leftover ref is a tidiness gap, not a broken pointer.

**IT NAMES WHETHER A PLAN CLAIMS IT.** A merged ref whose plan is delivered is `plot-release-refs.sh`'s job and the finding should say so. One that no plan names is the case that has no owner — and that is the finding's real subject.

**AN UNREACHABLE HOST REPORTS NOTHING, NOT EVERYTHING.** Silence must not turn every ref into a finding. `plot-pr-merged.sh` answers *not merged* when it cannot ask, and here that means *not reported*.

**Done when** the scan names a remote ref whose PR merged, distinguishes one a delivered plan claims from one no plan names, counts it in the footer, gates nothing, and reports nothing when the host cannot be asked.

## Notes

### The nine were cleared by hand — 2026-09-07

Each was verified against main by grepping for its own claim, archived to a local `archive/<slug>`, then deleted. **That is the work this section makes visible rather than accidental**: they were found because somebody listed every remote branch, not because anything reported them.

### Round 1 — 2026-09-07

**Verified at the line.** `plot-reconcile-scan.sh:2139` is the predicate: `if branch_merged "$b"; then continue; fi`. Section 17 does not merely fail to report a merged ref — **it skips one explicitly**, by a guard whose own comment says the host decides and ancestry is the fallback.

**Section 2 is not this finding.** *"Merged-but-not-delivered"* reports **plans** whose branches landed and whose phase did not follow. A ref surviving its own merged PR is a different subject with a different action, and no section holds it.

**No slice changed.** The plan stands as written.
