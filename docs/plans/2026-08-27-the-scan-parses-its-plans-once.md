# The scan parses its plans once

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-08-27, Jan Wloka, `bug/the-scan-parses-its-plans-once`

## Changelog

`plot-fleet-scan.sh` parses the plan estate in one pass instead of once per plan,
so a board with a normal number of plans completes its scan inside the timeout.

## Motivation

### The measurement

The board showed this for hours on 2026-08-27:

```
Last scan failed: timed out after 90000ms — 55 worktrees, 44 branches
— showing the last successful pulse below.
```

That reading — 462.9 s of wall clock at 11 % CPU utilisation, 56 worktrees and
43 branches — is what this plan was first written against, and **it is not the
steady state.** Instrumented sampling recorded the estate size before each run
and found a different regime entirely (the sampler lived at
`.plot/measure/scan-sample.sh`, landed `ec35d522` and removed once it had
answered — the numbers it produced are kept here because they are the argument):

| worktrees | branches | real | cpu % | |
|---|---|---|---|---|
| 56 | 43 | 462.9 s | 11 % | the reading above |
| 13 | 35 | 43.6 s | 55.5 % | |
| 13 | 35 | **27.4 s** | **86.8 %** | `--offline` |
| 12 | 33 | 38.9 s | 58.8 % | |

Four consecutive samples on a near-identical estate varied by **1.8 s**
(41.8–43.6 s), so the 462.9 s reading was an outlier regime rather than noise
around a mean. **The scan is not currently timing out**, and a plan justified by
"it cannot finish" would be justified by something that has stopped being true.

**What survives is the CPU claim, and the offline row is what establishes it.**
With the host round trip removed the scan runs at **86.8 % CPU** — it is not
waiting, it is computing. The online rows spend roughly 12–16 s waiting on
GitHub (that is `the-budget-is-spent-where-it-is-needed`'s territory, not this
plan's); the remaining ~27 s is work this plan makes cheaper.

So this is an **efficiency** plan, not a timeout fix. The spawn count below is
the subject, and it was re-measured on current `main` rather than trusted:

| spawned | plan's original count | measured 2026-08-27 on main |
|---|---|---|
| `python3` | 454 | **463** |
| `plot-plan-meta.sh` | 324 | **319** |

Five days on, the mechanism is unchanged and unfixed.

### What it waits on: process startup, 778 times

Tracing one `--offline` run (`bash -x`, 23 784 lines):

| spawned | count | cost each | total |
|---|---|---|---|
| `plot-plan-meta.sh` | **324** | 0.01 s | ~3 s |
| `python3` | **454** | 0.06 s | **~27 s** |

**More than half the scan's entire CPU budget is Python interpreter startup.**
And the work those interpreters do is re-reading data the scan already has:
`plot-fleet-scan.sh:2771` and `:2847` pipe `$meta` (the lines cited as 2674/2750 when this plan was written; re-located on main 2026-08-27 — the sites are unchanged, only their line numbers moved) — the output of
`plot-plan-meta.sh` — into a fresh `python3` per plan, to pull out `plan_phase`
and `wave_lines`.

So the scan parses each plan, then starts an interpreter to re-parse the parse.

### The batch already exists and is 300× cheaper

`plot-plan-meta.sh` takes a LIST. Measured the same day:

```
one plan   : 0.01 s
ALL plans  : 0.19 s      (a single invocation)
```

324 invocations against one that costs 0.19 s. The helper was built for this —
`board.ts:599` already calls it that way, with a docstring that says so: *"Run
the plan-format helper once over all plan files."* The scan is the caller that
does not.

### This is not what the four shipped plans fixed

Four scan-performance plans are **Released**, and the scan still times out:

- `the-scan-asks-once-not-once-per-branch`
- `the-scan-spawns-git-once-per-question`
- `the-scan-asks-once-per-pulse-not-once-per-branch`
- `the-timeout-report-blames-the-wrong-thing`

They fixed **host API** N+1 — the changelog of the third says it plainly: *"branch
PR state is resolved from the one repo-wide list the scan already fetches,
instead of one request per branch per pulse."* That was real and it worked: one
bulk `pr-list` costs 2.80 s where 43 per-branch `pr-state` calls would cost 55 s.

**The local-subprocess N+1 is a different cost with the same shape, and nobody
measured it.** Each fix targeted something real and none targeted the dominant
term, which is why four Released plans left the symptom untouched.

### The banner still blames the wrong thing

It reports *"55 worktrees, 44 branches"*, implying the estate's size is the cost.
`the-timeout-report-blames-the-wrong-thing` shipped to correct exactly that
inference, and the measurement behind it stands: **pruning 70 % of the worktrees
changed the scan time not at all.** The count is a red herring that a Released
plan already refuted, still printed at the top of the screen.

Worktrees are not free — but at 0.06 s per Python spawn, 454 of them cost more
than every worktree on the disk.

## Design

### One parse, before the loop

`plot-plan-meta.sh` is invoked once with the whole plan list, before the per-plan
loop begins. The loop reads from that result instead of re-invoking anything.

The two `python3` sites that extract `plan_phase` and `wave_lines` per plan
(`:2674`, `:2750`) read from the same single parse. Whether they remain Python at
all is an implementation choice; what the plan fixes is that they run **once**,
not once per plan.

### Not chosen: cache the per-plan parse

A memo keyed on the plan file would cut repeats within one scan and leave the
shape intact — still 324 potential spawns, still a fresh interpreter on every
miss, and a cache to invalidate. The batch call costs 0.19 s for the whole
estate; there is nothing left worth caching.

### Not chosen: raise the 90 s budget

The scan takes 463 s. A budget that accommodates it would be over 8 minutes,
which is not a pulse — and the board renders a stale pulse against fresh plan
data while it waits, which is the *second* defect this timeout causes (below).
Raising the ceiling hides the cost and keeps the lie.

### Not chosen: reduce the worktree count

Already measured and already refuted: pruning 70 % changed nothing. Recorded here
because the banner keeps proposing it.

### The stale-pulse render is a SEPARATE defect, and stays out of scope

While the scan times out, the board renders a 964-second-old pulse beside
current plan data. Measured on the same screen:

- waves in **DONE** carrying `eligible`, `blocked` and `deferred` verdicts —
  section from the current phase, verdict from the stale pulse;
- `plan finished — no branch was needed` printed beside a branch **and** a merged
  PR, though `FINISHED_PLAN_NOTE`'s own docstring defines it as what a DONE row
  says about *"a branch git cannot account for"*;
- `conflicts` on a wave whose PR merged 36 minutes earlier — PR data ages on its
  own timer (`PR data 2179s ago`).

Every fact is individually true and they are of different ages. That is worth its
own plan — *a degraded board should not render stale facts beside fresh ones,
because absent is not false* — and it is not this one. **Fixing the timeout
removes today's instance; it does not remove the class.**

## Waves

### Batched (Branch: bug/the-scan-parses-its-plans-once, PR: #486)

`plot-fleet-scan.sh` parses the plan estate in one `plot-plan-meta.sh`
invocation before the per-plan loop, and the per-plan `python3` extractions run
once rather than per plan.

## Done when

1. **The scan's CPU time falls measurably**, compared against a baseline taken
   on the same estate in the same run — `--offline` on both sides, so the host
   wait (12-16 s, and another plan's subject) is out of the comparison.

   **Not "completes inside 90 s".** That was this item until 2026-08-27, when
   the estate stopped failing it: the scan now runs ~39 s online and 27 s
   offline, so a no-op patch passes. The budget is no longer the discriminator;
   the CPU time is. Items 2 and 3 are the mechanism, and this item is the
   effect they must actually produce.
2. **`plot-plan-meta.sh` is spawned ONCE per scan.** Asserted by spawn count,
   not by duration: a timing assertion is flaky on a loaded machine, and the
   count is the fact that produces the timing. 324 → 1.
3. **`python3` spawns do not scale with plan count.** The second half of the
   same defect — batching the parse while leaving 454 interpreters running
   would satisfy item 2 and save 3 s of the 30.
4. **The scan's OUTPUT is byte-identical** to today's for the same estate.
   This is a performance change; a verdict that moves is a regression, and every
   consumer (`--next`, `--json`, the board, `plot-dispatch.sh`) reads it.
5. **No host call is added or removed.** The API N+1 was fixed by the four
   Released plans; this plan must not disturb it. Asserted by the existing
   no-network test.
6. **A repo whose plans fail to parse still scans**, reporting what it could
   read. A single malformed plan must not take the estate down — the batch call
   makes that a new failure mode, since one invocation now covers every plan.
7. `pnpm run validate`, `pnpm run test:reconcile` green.

## Notes

### Why four Released plans did not fix it

Each measured a real cost and fixed it. None measured the whole. The API N+1 was
visible because it showed up as rate-limit exhaustion — a failure with a name and
an error message. Local subprocess startup produces no error at all: it just
takes 27 seconds, distributed across 454 invocations that each look instant.

**The scan was 11 % CPU-bound the whole time**, and nothing reported that number
until it was asked for directly. That is the argument for `Done when` item 2
being a spawn count rather than a duration: the count is the fact, and it is the
one nobody had.

### It belongs to this sprint's subject

*The board tells the truth in every section.* A board that cannot finish a scan
shows a pulse from sixteen minutes ago and labels it with facts from now. The
timeout is upstream of the lie.

### Correction 2026-08-27: the estate was the binding constraint, not the spawns

Measured immediately after reaping 12 finished worktrees, same machine, same
main:

| | before | after |
|---|---|---|
| worktrees | 54 | **42** |
| real | **462.90 s** | **51.28 s** |
| user | 23.45 s | 13.66 s |
| sys | 27.17 s | 12.48 s |

**9× faster, and inside the 90 s budget.** Removing 22 % of the worktrees removed
89 % of the wall clock.

**That refutes this plan's framing.** The Motivation argues the estate's size is a
red herring — citing `the-timeout-report-blames-the-wrong-thing`, which measured
*pruning 70 % of the worktrees changed the scan time not at all*. That
measurement was real. This one is too, and they disagree because **not all
worktrees cost the same**.

The earlier prune removed worktrees whose branches were merged and quiet. The 12
removed today included branches carrying live refs, open duplicate PRs, and
unlanded commits — each of which the scan interrogates per branch. Count is not
the cost; **state** is.

**What survives.** The 778 spawns are still real, and still worth removing: 324
`plot-plan-meta.sh` invocations against one batch call that costs 0.19 s, and 454
`python3` starts re-parsing that helper's own output. At 51 s the scan sits at
roughly half its budget with a growing estate, so the headroom matters. But this
is now an efficiency plan, not the fix for a timeout — and its `Done when` item 1
(*completes inside 90 s*) is already true without it.

**The fix that actually cleared it was reaping**, which is why
`a-finished-plan-delivers-and-clears-up` — auto-deliver and auto-reap when a
plan's last wave merges — is the plan that keeps this from recurring. This one
buys headroom underneath it.
