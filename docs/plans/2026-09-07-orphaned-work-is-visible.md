# Orphaned work is visible

> Twelve branches carry unmerged commits with no PR and no plan naming them. Five hold real file changes — an e2e fix, a typecheck repair, a guard, a corpus fix, six files of monitor work — and nothing on the estate says they exist. The board calls three of them `abandoned` and says nothing about the other nine.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches

## Changelog

- Work on a branch that no plan names and no PR carries is reported, so it is finished or abandoned deliberately rather than by forgetting.

<!-- Board impact: the board already renders `abandoned` for a branch with
     commits and no PR. This is about the ones it does not reach. -->

## Motivation

**Measured 2026-09-07 over every remote branch.** Of 25 non-`main` refs:

```
 3   an open PR          — live work
10   merged, ref not yet swept
12   unmerged, NO PR
```

**And of those twelve, five hold real file changes** — `PLOT-BLOCKED` markers excluded:

| branch | files | last commit |
|---|---|---|
| `bug/the-monitor-samples-a-pushed-desk` | 6 | 2026-09-01 |
| `bug/a-hung-cleanup-says-which-half` | 3 | 2026-08-31 |
| `bug/main-typechecks-without-dead-tfidf` | 2 | 2026-08-29 |
| `bug/the-corpus-reads-a-head-it-may-not-own` | 2 | 2026-09-01 |
| `bug/the-claimable-guard-counts-what-remains` | 1 | 2026-09-02 |

**NO PLAN ON THE ESTATE NAMES ANY OF THEM.** `grep -rl <branch> docs/plans/*.md` returns nothing for all five. They are not slices that stalled; they are work that exists outside the plan estate entirely.

**The largest is not a scratch branch.** `bug/the-monitor-samples-a-pushed-desk` carries *"Hold the e2e agent past its push so the monitor samples a clean desk"* plus **four written briefs** — 362 insertions.

**THE BOARD SEES THREE OF TWELVE.** Its `abandoned` row fires for a branch with commits and no PR, and it showed three: `the-scan-sees-a-repairable-conflict`, `this-repo-gathers-its-worktrees`, `the-reaper-sweeps-every-kind`. All three were reaped 2026-09-06 — **and they were the three carrying only a `PLOT-BLOCKED` marker or work already landed.** The five carrying real changes were not among them.

**So the visible ones were the empty ones.** That is the defect: the rule that surfaced them is not the rule that finds work worth rescuing.

## What this is not

**Not a sweep.** Deleting these refs is what the reaper and `plot-release-refs.sh` already refuse to do without a merged PR, and correctly — this is unlanded work.

**Not an argument that they should merge.** Some may be superseded, some abandoned on purpose. **What is missing is the decision, not the outcome.**

**Not a fourth ref-deleting rule.** `finishedWith` (#754) is the one place that answers whether a desk is finished with. This reports; it removes nothing.

## Slices

### The scan reports work no plan claims (Branch: bug/orphaned-work-is-visible)

`plot-reconcile-scan.sh` reports a remote branch carrying unmerged commits that no plan names and no PR carries.

**IT IS KEYED ON FILE CHANGES, NOT ON COMMITS.** Seven of the twelve carry only a claim commit and a `PLOT-BLOCKED` marker; those are already reapable and already handled. **The five that matter changed source files**, and that is the reading — `git diff --name-only main...branch`, excluding `PLOT-BLOCKED*`.

**IT IS ADVISORY AND BELONGS BELOW `== blocking sections end ==`.** Unclaimed work is a legibility gap, not a broken pointer, and a finding that can stop a delivery is a gate nobody agreed to.

**IT NAMES WHAT A PERSON CAN DO**, and there are exactly three answers: open a PR, write the plan that claims it, or delete the ref. A finding that says only *this exists* leaves the reader where the board already left them.

**Done when** the scan reports a remote branch with unmerged file changes that no plan names and no open PR carries, names the branch, its file count and its last commit date, counts it in the machine-countable footer, and gates nothing.

## Notes

### Why the board's `abandoned` row is not enough — 2026-09-07

It fires on *commits and no PR*, which is true of all twelve. It showed three, and the three it showed were the three with nothing in them.

**The difference is what the row asks.** *Has this branch commits?* is answered by a claim commit. *Does this branch hold work?* needs the diff — and that is the one question nobody was asking.

### The five were worked through — 2026-09-07

Each branch was compared against `main` rather than assumed abandoned. **Three had been superseded and two had not**, and nothing on the estate distinguished them.

| branch | verdict |
|---|---|
| `bug/the-monitor-samples-a-pushed-desk` | **superseded** — main fixed the same flake better |
| `bug/the-claimable-guard-counts-what-remains` | **superseded** — the `> 20` floor is gone from main |
| `bug/the-corpus-reads-a-head-it-may-not-own` | **superseded** — main creates the symref rather than tolerating its absence |
| `bug/main-typechecks-without-dead-tfidf` | **landed** — the TF-IDF helpers it deletes are already gone |
| `bug/a-hung-cleanup-says-which-half` | **UNRECOVERED** — `PLOT_LOOP_TRACE` exists nowhere on main |

**THE MONITOR BRANCH IS THE INSTRUCTIVE ONE.** Both it and main fixed the same 2026-09-01 CI failure — three PRs failing at once — and **main's fix is the better one**: it polls `run.monitorCalls()`, scoped to this monitor's subcommands, where the branch polled `stub.calls()`, the whole log. The branch also held the agent with `sleep 20`; main needs no sleep because the scoped poll cannot return on somebody else's call.

**Two engineers solved one flake independently and neither knew.** That is the cost this plan is about, priced: not the lost work, but the duplicated work.

**`a-hung-cleanup-says-which-half` is the one to recover.** It adds `_stage` markers through the worker loop's cleanup block, guarded by `PLOT_LOOP_TRACE` so an ordinary dispatch is unchanged, because *"the hang is somewhere in this block and the process table cannot say where — every snapshot shows the same three processes."* Main still has all 14 `_kill_tree`/`wait` sites and no way to tell which one hangs. It conflicts with main and needs a rebase, not a merge.

### All twelve, worked through — 2026-09-07

The first pass checked five. **All twelve were then compared against `main`, and the result changes the plan's claim.**

| branch | files | verdict |
|---|---|---|
| `feature/the-scan-asks-for-the-state` | 11 | **live** — dispatched today |
| `plot-corpus-pin` | 13 | merges and deliveries only, no unique commit |
| `bug/an-idle-reading-does-not-end-a-worker` | 0 | zero commits |
| `infra/the-estate-speaks-waves` | 87 | **superseded** — the estate went to `## Slices`, 223 files, zero `## Waves` |
| `infra/the-components-leave-the-shell` | 12 | **superseded** — `agent-rows/` already holds the split |
| `infra/a-wedged-run-says-what-it-held` | 5 | **landed** — the TAP reporter is in `ci.yml` |
| `idea/the-pr-list-join-is-silently` | 2 | **landed** — the plan is on main |
| `bug/main-typechecks-without-dead-tfidf` | 2 | **landed** |
| `bug/the-monitor-samples-a-pushed-desk` | 6 | **superseded**, better |
| `bug/the-claimable-guard-counts-what-remains` | 1 | **superseded** |
| `bug/the-corpus-reads-a-head-it-may-not-own` | 2 | **superseded** |
| **`bug/a-hung-cleanup-says-which-half`** | 3 | **UNRECOVERED** |

**ELEVEN OF TWELVE ARE ALREADY ON MAIN OR SUPERSEDED BY SOMETHING BETTER. ONE IS NOT.**

**That inverts what the count suggested.** Twelve unmerged refs with no PR reads as twelve pieces of lost work; it is one, plus eleven refs nobody swept because no rule sweeps an unmerged branch.

**So the finding is sharper than the plan first stated.** The cost is not lost work — it is that **the estate cannot tell a superseded branch from an unfinished one**, and a person must read every diff to find out. Eleven of these were safe to delete for weeks and nothing said so; the twelfth would have been deleted with them by any sweep keyed on age.

**And the reaper is right to refuse all twelve.** `finishedWith` asks *did the host merge a PR for this?* — the answer is no for every one, including the eleven whose content is on main by another route. **A rule that deleted on content-equivalence rather than on a merged PR would have been correct eleven times and destroyed the twelfth.**
