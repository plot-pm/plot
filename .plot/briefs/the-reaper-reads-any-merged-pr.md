## Implementation brief — a-finished-plan-delivers-and-clears-up (wave: Landed)

- **Plan (canonical):** `docs/plans/2026-08-27-a-finished-plan-delivers-and-clears-up.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `bug/the-reaper-reads-any-merged-pr` (base: `main`)
- **Ends as:** one PR to `main`

**Independent of the plan's other two waves.** They extract `plot-deliver.sh` and
wire auto-delivery; this one is a self-contained fix and needs nothing from them.

### What to build

`plot-reap.sh:66` asks the host whether a branch's work landed:

```bash
out=$(gh pr list --head "$br" --state all --limit 1 --json mergedAt 2>/dev/null) || return 1
case "$out" in *'"mergedAt":"'*) return 0 ;; *) return 1 ;; esac
```

**`--limit 1` reads only the NEWEST PR.** Where a newer, unmerged PR sits in front
of the real merge, the reaper reports `unlanded work — no merged PR` about a
branch whose work is on main. Measured 2026-08-27:

| branch | newest PR | the real merge |
|---|---|---|
| an-unreachable-host-says-so | #473 `mergedAt=null` | **#446 merged** |
| the-scan-sees-a-stale-sprint-tally | #464 `mergedAt=null` | **#463 merged** |
| a-plan-cites-a-jira-key | #476 `mergedAt=null` | **#447 merged** |

Ask instead whether ANY PR for the branch merged.

### Why it matters more than three worktrees

The masking PRs are ones the fleet opened itself, on already-merged waves, and
the loop closes:

1. a leftover worktree lets auto-dispatch adopt a merged branch;
2. the worker opens a duplicate PR;
3. that PR is newer, so `--limit 1` reads `mergedAt=null`;
4. the reaper keeps the worktree — the input to step 1.

And the estate is the scan's binding constraint. Measured the same day: reaping
12 worktrees took the fleet scan from **462.90 s to 51.28 s** — 22 % fewer
worktrees, 89 % less wall clock, from over the 90 s budget to comfortably inside
it. A worktree the reaper wrongly keeps is not tidiness; it is scan time.

### The decisions the plan settles — do not re-derive them

**A branch with NO merged PR is still kept** (`Done when` item 2). Four such
today (`merged=0, open=0`) — genuinely unlanded work. A fix that reaps them
destroys work and would pass item 1. This is the assertion that makes the change
safe.

**Read `mergedAt`, never `state`.** The script already knows this and says so: a
merged PR reports `CLOSED`, so `state` cannot answer. Reading only the newest PR
is that same error one level out — the newest PR is not the merge.

**The five refusals are unchanged.** Live pid, uncommitted changes, a
`PLOT-BLOCKED*` marker, a tree on the default branch, no merged PR. This wave
corrects how the last one is *measured*; it does not remove it or add another.

**Squash-merge is a different problem.** It leaves a branch permanently ahead of
main, which is why ancestry cannot decide and why the script asks the host at
all. Do not try to fix reaping with `merge-base` — an earlier reading of this
session blamed squash-merge for these three branches and was wrong.

### Done when

Items 1 and 2 of the plan's `## Done when` are yours, and item 2 is the one a
careless fix fails. Plus: `pnpm run validate`, `pnpm run test:reconcile` green;
a changeset with a `bumps:` block naming `plot`; Node 24; `trash` not `rm`.

### Bookkeeping

Annotate the plan's `## Waves` heading on main as `(Branch: x, PR: #N)` — the
Waves dialect, inside the heading. Push your first real commit as soon as it
exists.

### Scope guard

Owns `skills/plot/scripts/plot-reap.sh` and its tests. Nothing else in this plan
is yours: `plot-deliver.sh` and the board wiring are the other two waves. One
sibling branch is in flight elsewhere (`feature/the-pulse-says-a-branch-is-claimed`,
on the fleet scan). Rebase onto current main before you start.
