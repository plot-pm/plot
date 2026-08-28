# The board watches instead of re-asking

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

The board holds branch, plan and worktree state between pulses and re-derives
only what changed, so a quiet estate costs a handful of git processes instead of
115.

## Motivation

### The measurement

One `--offline` scan, traced 2026-08-28, spawns **115 git processes**. The board
runs one every **5 seconds**.

| calls | shape | loop over |
|---|---|---|
| **43** | `rev-list --count origin/X..X` | every local branch |
| **34** | `hash-object <plan>` | every plan |
| **11** | `git -C <worktree> status` | every worktree |
| 9 | `log` (7 of them `-1 --format=%ct` per branch) | mostly branches |
| 5 | `rev-parse` | |
| 3 | `diff` | |
| 10 | `ls-tree`, `for-each-ref`, `worktree`, `symbolic-ref`, `show-ref`, `merge-tree`, `cat-file`, `--version` | one-offs |

The shape is `branches + plans + worktrees + ~27`. **Three per-item loops over
the three things that grow**, and only the constant term is bounded.

Over thirty minutes that is roughly **41,000 process launches**. Nothing leaks —
`entry.running` prevents overlapping scans and a 60 s census showed no
accumulation. It is a RATE, and it is the reason an operator running the board
beside any other spawn-heavy work has to restart the machine.

### Why the loops are there, and why they are no longer small

Both large loops were optimised once already, and their comments say so.
`hash-object`: *"It is one fork per PLAN — not per branch — so it does not
reintroduce the per-branch cost this whole change removes."* That was true when
it was written. The estate then grew to **157 plans and 43 local branches**, and
per-plan stopped being cheap.

This is the same trajectory `the-scan-parses-its-plans-once` corrected, where
`python3` went from 463 spawns to 1. The remaining git calls are the other half
of that problem.

### Batching alone is the smaller idea

The two big loops have native batch forms (`for-each-ref` with
`%(ahead-behind:…)`, `hash-object --stdin-paths`), which would take 115 to about
40. That is a 3× cut and it re-derives everything, every pulse, forever.

**The board polls every five seconds and most pulses find nothing changed.** The
larger win is not computing a cheaper answer — it is not recomputing an answer
that cannot have changed.

## Design

### Three monitors, one per thing that grows

Each holds the last answer and the cheap fact that invalidates it:

| monitor | replaces | invalidated by |
|---|---|---|
| **BranchMonitor** | 43 `rev-list` + 7 `log -1 --format=%ct` | any ref SHA moving |
| **PlanMonitor** | 34 `hash-object` | a plan file's mtime |
| **WorktreeManager** | 11 `git -C status` | the worktree list changing |

That is ~95 of 115 calls behind three signals, and each signal is one call for
the whole set. **Measured on this repo:**

```
git for-each-ref --format='%(refname:short) %(objectname:short)'
    → 261 refs in 0.01 s, ONE process
ls -l docs/plans/*.md
    → 157 plans in 0.00 s, ONE process
```

If no SHA moved, no branch's ahead-count can have changed. If no plan file's
mtime moved, no plan's oid can have changed. The answer stays DERIVED — it is
simply not recomputed when its inputs provably did not move.

### The rule that makes this legal, and it is not new

Manifesto Principle 1 is stateless-and-read-only, stated at
`plot-fleet-scan.sh:120`: *"there is no fleet database… a killed dispatcher, a
dead worker, or a crashed pulse costs nothing — the next pulse re-derives the
truth."* That is load-bearing and this plan does not weaken it.

**`PLOT_TERMINAL_CACHE` already does exactly this**, and CLAUDE.md records the
rule it obeys:

> the board holds the answers in memory and hands them back through
> `PLOT_TERMINAL_CACHE`… Only the host round trip is skipped; **git is
> re-consulted every pass and the entry is discarded the moment it disagrees**,
> which is what keeps it a derivation rather than a record.

So the precedent is set and the distinction is precise: **a cache checked
against a cheap fact every pass is a derivation; one that is trusted is a
record.** `PLOT_TERMINAL_CACHE` applied it to the HOST; these monitors apply it
to GIT.

### The monitors live in the board, not in the scan

The scan must keep working standalone — `/plot-fleet`, `--next` and
`plot-dispatch.sh` all invoke it with no board running, and `--next` is what
picks a branch to claim. So the monitors are board-side state that feeds the
scan a cache it still verifies, exactly as `PLOT_TERMINAL_CACHE` is passed in
today. **The script keeps its own answer when the cache disagrees.**

A scan run from a terminal is unchanged and pays full price. That is correct: a
one-off run has no steady state to exploit.

### Not chosen: batch the loops and stop there

It is simpler, it needs no new state, and it would help. Rejected as the primary
design because it leaves the cost proportional to the estate on every pulse —
and the estate is what keeps growing. Worth doing INSIDE the monitors, though:
when a signal says something did change, the recompute should use the batch
form rather than the loop.

### Not chosen: a fleet database

A file the board writes and later trusts is the record Principle 1 forbids, and
it would make a crashed board leave stale truth behind. The monitors hold state
**in memory only**, so a restarted board re-derives everything on its first
pulse. Losing the cache costs one expensive scan and nothing else.

### Not chosen: watch the filesystem with inotify/FSEvents

A watcher avoids even the invalidation call. Rejected for now: it adds a
platform dependency and a second failure mode (a missed event is a stale
answer), to save two calls that measure 0.01 s together. Revisit only if the
signals themselves become the cost.

## Branches

### Signalled

- `feature/the-board-knows-what-moved` — the three invalidation signals as one cheap pass: all ref SHAs, all plan mtimes, the worktree list. Tests: one process per signal, asserted by spawn count; a moved ref is detected; a rewritten plan file is detected; an added or removed worktree is detected

### Watched

- `feature/the-monitors-answer-from-memory` — BranchMonitor, PlanMonitor and WorktreeManager hold last answers and recompute only what a signal invalidates, feeding the scan through the `PLOT_TERMINAL_CACHE`-shaped channel. Tests: a second pulse over an unchanged estate spawns dramatically fewer git processes, asserted by count; a changed ref makes exactly that branch recompute; the scan's output is byte-identical to an uncached run

## Done when

1. **A second pulse over an unchanged estate costs far fewer git processes than
   the first.** The whole point, asserted by SPAWN COUNT — a timing assertion is
   flaky and the count is the fact that produces the timing.
2. **The scan's output is byte-identical with and without the monitors**, on the
   same estate. This is a performance change; a verdict that moves is a
   regression, and `--next`, `--json`, the board and `plot-dispatch.sh` all read
   it.
3. **A moved ref invalidates exactly its branch**, not the whole set. A monitor
   that recomputes everything on any change has bought nothing on a busy estate,
   which is when the board matters most.
4. **A stale entry is DISCARDED, never trusted.** The rule that keeps this a
   derivation. Asserted by feeding a deliberately wrong cached answer and
   checking the pulse reports git's answer, not the cache's.
5. **The scan still runs standalone with no board and no cache**, at full cost
   and identical output. `/plot-fleet` and `--next` must not acquire a board
   dependency — `--next` picks branches to claim, and a wrong answer there
   starts the wrong work.
6. **A restarted board re-derives everything.** The monitors hold memory only;
   nothing is written that a later run could read back. Asserted by the absence
   of any new file.
7. **The three signals are one process each**, asserted by count. A signal that
   loops has reintroduced the problem in the invalidation layer.
8. `pnpm test`, `pnpm run test:board`, `pnpm run test:reconcile` green.

## Notes

Proposed by the operator: *"Don't we have a master process, like a
BranchMonitor, a WorktreeManager, a PlanMonitor? Those could run git in a more
controlled way out of their own process space instead of running all
processes."*

The decomposition maps exactly onto the three per-item loops the trace found,
which is the sign it is the estate's natural shape rather than an imposed one.
The prompting symptom was concrete: *"If I run the board and you work with it I
need to restart the computer in 30min."*
