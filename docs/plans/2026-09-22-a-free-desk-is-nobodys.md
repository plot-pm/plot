# A free desk is nobody's

> Thirteen worktrees on this machine are named by no manifest, reported by no scan and reaped by nothing — because a free agent holds no branch, and every tool that could clean up is keyed by branch.

## Status

- **State:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-22, in-session review
- **Started:** 2026-09-22, Jan Wloka, `bug/the-reaper-reaches-a-free-desk`

## Changelog

- A worktree left behind by a free agent becomes visible and reapable. Measured 2026-09-22: **19 worktrees, 13 of them detached `free-*` desks with a dead pid, 3 manifests, and `reapable=0`** — `plot-reap.sh` reports per branch and a free agent holds none, so it named neither, and `plot-reconcile-scan.sh` section 21 answered `desks=2` for the same reason. The scan walks all nineteen on every pulse.

Board impact: yes. The board's *"N manifests, M synthesized"* line already hints at the gap; the desks themselves become countable.

## Design

### What was measured

```
git worktree list                    19
  … detached free-* desks            13
  … holding a branch                  2
.plot/agents/*.json                   3
plot-reap.sh --dry-run          reapable=0, kept=2
reconcile-scan section 21           desks=2
```

**The thirteen appear in no line of either tool** — not as `keep`, not as `reap`, not as a finding. They are not refused; they are never considered.

### Why every tool misses them

**`plot-dispatch.sh --start` cuts a free agent's desk DETACHED at `origin/<main>`**, deliberately: a free agent has no slice, so it has no branch to check out. That is correct and documented.

**But both cleanup paths are keyed by branch.** `plot-reap.sh` enumerates the plan estate's branches and asks about each; a desk with no branch is in no enumeration. `plot-reconcile-scan.sh` section 21 reports `desks=` from the same walk.

**So the gap is exactly the population `--start` creates.** Every free agent the fleet ever started leaves a tree that nothing will ever mention — and `--start [N]` is the normal way to run a fleet.

**CLAUDE.md already records the shape**, from the other direction:

> a tree no recognition test places is REPORTED and never promoted … measured 2026-09-09, **ten finished desks while the reaper reported three.**

That measurement found trees the reaper could not *classify*. This is narrower and worse: trees it never *reaches*.

### What it costs

**The scan walks all of them.** `plot-reconcile-scan.sh` and the board's pulse both enumerate worktrees, and 19 at load 14 is what produced *"Last scan failed: timed out after 90000ms — 19 worktrees"* on this machine today.

`plot-release-refs.sh:11` already records the shape of that cost: deleting nine merged branches halved a scan. Worktrees are cheaper than branches per unit, and thirteen of them are free.

### Where the answer belongs, and it is not a gate

**A gate would be wrong here.** CLAUDE.md's *Gates Over Rules* asks whether you can answer *"did I complete this?"* without doing the work — and for a reap the answer is a measurement, so a gate is available in principle. But the thing missing is not enforcement: **nothing is being skipped, because nothing is being asked.** A gate in front of an unasked question refuses nothing.

**The answer is to make the population reachable**, in the tool whose job it already is:

| tool | change |
|---|---|
| `plot-reap.sh` | enumerate the worktree list as well as the branch list; a detached desk under `Worktree root` is a candidate like any other |
| section 21 | count what the reaper counts — the two must not disagree |

**The five refusals do not change.** A free desk is judged by the same rule as any other: a live worker pid, uncommitted changes, a `PLOT-BLOCKED` marker, a tree on the default branch, or no merged PR. What changes is that it is judged at all.

**The merged-PR refusal needs one statement, though.** A free desk never had a slice, so it has no PR to be merged — that refusal would keep every one of them forever. A desk with **no branch and no commits beyond its base** has nothing to lose and nothing to land; that is the reading, and it must be stated rather than inherited.

### What must not break

**A hand-made checkout outside `Worktree root` stays silent.** CLAUDE.md is explicit: *"a person's tree must never become an instruction to remove it"*, and `test -d .plot` cannot separate them because the repo tracks `.plot/`.

**A free agent that is RUNNING keeps its desk.** The live-pid refusal already covers it and must be checked first — `--start` exists to create these, and reaping one out from under a waiting agent is worse than leaving thirteen.

**The reaper still removes CHECKOUTS only.** Refs are `plot-release-refs.sh`'s, and a detached desk has no ref to lose.

## Slices

### The reaper reaches a free desk (Branch: bug/the-reaper-reaches-a-free-desk, PR: #961)

- `bug/the-reaper-reaches-a-free-desk` — `plot-reap.sh` enumerates worktrees under the configured `Worktree root` in addition to the plan estate's branches, judges a detached desk by the same five refusals, and states the no-branch-no-commits reading that replaces the merged-PR question for a desk that never held a slice; `plot-reconcile-scan.sh` section 21 counts the same population so the two cannot disagree

## Notes

- Found by an operator asking why the board reported 19 worktrees against 3 manifests and one working agent.
- **The board's `"3 manifests, 1 synthesized"` line is honest and was the clue.** It counts what the registry can see; the thirteen are outside it entirely.
