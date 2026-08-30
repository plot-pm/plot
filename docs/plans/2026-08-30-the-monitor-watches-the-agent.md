# The monitor watches the agent

> Attach a monitor to a dispatched agent and it samples the job on a cadence, comparing each answer with the last — so an agent that dies, stalls, or finishes without opening a PR is reported instead of discovered.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-domain-is-one-implementation
- **Issue:** <!-- optional -->
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

- A dispatched agent is watched: finished work with no PR, a stalled process, and a dead agent are reported on the board's attention surface rather than found by someone looking.

<!-- Board impact: YES — new attention entries. The pulse contract gains fields;
     no existing value changes. Rebuild the artifact. -->

## Motivation

**Twice in one session, finished work sat on a branch with no PR, and nothing
noticed.**

| | how it died | what was there |
|---|---|---|
| `feature/the-ports-have-adapters` | exited cleanly | 4 commits, 7 ports, 261 tests green |
| `feature/the-domain-agrees-with-production` | stalled | 4 commits, corpus tier, 13/13 green |

**Both were found because a person asked.** Nothing in Plot reports *this branch
has finished work and no review* — not the scan, not the board, not the worker
state.

**The second one is the sharper case, because the process lied.**
Measured 2026-08-30: **50 minutes elapsed, 0.01s CPU**, children `bash` only.
The pid was alive, so every check that asks *is a worker running?* said yes. Had
the answer been trusted, that work would still be sitting there.

**The signals already exist; nothing asks them on a cadence and nothing reports
the answer.**

- `plot-worker-state.sh` knows eight states and refines `finished` by the tree
- `plot_worker_activity()` samples subtree CPU over 0.4 s and returns
  `working` / `idle` — the exact signal that would have caught the stall
- `attention.ts` is already the surface for *this needs you*

**What is missing is the middle: something that asks regularly, compares this
answer with the last, and speaks when the comparison is bad.** A single reading
cannot distinguish a worker thinking from a worker gone; two readings, minutes
apart, can.

## Design

### It observes; it does not act

**The monitor writes attention entries and changes nothing else.** It does not
kill a process, open a PR, reap a worktree or restart an agent — every one of
those is a judgement with a blast radius, and `plot-reap.sh` and
`plot-dispatch.sh` already own them behind their own refusals.

**That boundary is what makes it safe to run continuously.** A watcher that can
only report is one nobody has to supervise.

### What it reports, and how each is measured

| finding | measurement |
|---|---|
| **finished, no PR** | tree clean, commits ahead of the default branch, no PR for the branch |
| **stalled** | pid alive, CPU delta zero across samples, no `PLOT-BLOCKED` marker |
| **gone** | pid dead, work uncommitted in the tree |
| **blocked** | a `PLOT-BLOCKED*` marker exists |

**Each is a measurement, not a judgement** — the same discipline `plot-reap.sh`
applies to its five refusals. *"Finished without a PR"* is three facts anded
together, and every one is checkable by a script.

### The cadence, and why it is not the pulse

**The board pulses every 5 s; the monitor samples far slower.** A stall is only
visible over minutes — CPU delta across two samples 0.4 s apart says whether a
process is busy *now*, which is noise on its own. What identifies a stall is
*idle across successive samples while the tree has not changed*.

**So the monitor keeps the previous answer.** That is the one piece of state
here, and it is derived rather than recorded: lose it and the next sample
rebuilds it, at the cost of one interval's delay.

### Attaching, and why it is explicit

**`plot-dispatch.sh` attaches a monitor when it starts a worker.** The agent
already has a manifest and a worktree; the monitor is the third thing the
dispatcher sets up, and it dies with the agent.

**A hand-made worktree gets none**, and that is deliberate. Attaching to
everything would mean watching worktrees nobody dispatched — the population
`plot-dispatch.sh` already refuses to reason about, because they carry no claim
and follow no naming.

## Slices

### Sampling (Branch: feature/the-monitor-samples-the-agent)

The sampler: one function, given a worktree, returning the four findings above
or none. Built on `plot-worker-state.sh` and `plot_worker_activity()` rather
than beside them.

**Done when** each of the four findings is individually triggerable in a test,
`finished-no-PR` fires on a branch with commits and no PR and does NOT fire once
a PR exists, and nothing in it writes.

### Comparing (Branch: feature/the-monitor-remembers-the-last-answer)

The cadence and the previous-answer comparison, so `stalled` needs two readings
rather than one.

**Done when** a single idle sample reports nothing, two consecutive idle samples
over an unchanged tree report `stalled`, and a tree that changed between samples
resets the comparison.

### Reporting (Branch: feature/the-monitor-reaches-attention)

The findings become attention entries.

**Done when** a finished-no-PR branch appears on the attention surface, the
entry names the branch and what to do, and it clears when the PR is opened.

### Attaching (Branch: feature/dispatch-attaches-a-monitor)

`plot-dispatch.sh` starts a monitor alongside each worker.

**Done when** a dispatched agent is monitored without the operator asking, a
hand-made worktree is not, and `--dry-run` says which monitors it would attach.

## Notes

**This does not replace reading the board.** It changes what the board can tell
you: today a finished-no-PR branch is indistinguishable from one still being
worked on, and after this it is not.

**The two measured cases are the acceptance test.** If the monitor had been
running, `the-ports-have-adapters` would have reported `finished, no PR` within
one interval of the worker exiting, and `the-domain-agrees-with-production`
would have reported `stalled` after two idle samples. Neither needed a person
to ask.

**Open: what the master agent does with a report.** Reporting to the board is
this plan; an agent that acts on the report — restarting, reaping, opening the
PR — is the next question, and it needs the controller
([`the-controller-answers-every-asker`](2026-08-30-the-controller-answers-every-asker.md))
to ask through. Deliberately not here: a watcher that acts is a different risk
from one that reports.
