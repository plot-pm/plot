# `finished` is not a verdict

> Every worker exits 0 — the one that opened a PR and the one that stopped mid-task to ask a question. The scan reports both as `finished`, meaning *review it*, and the difference is only visible in the worktree.

## Status

- **Phase:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-18, jwloka, in-session
- **Started:** 2026-08-18, Jan Wloka, `bug/one-worker-state-not-two`

## Changelog

- `plot-fleet-scan.sh` distinguishes a worker that finished its work from one that stopped without finishing it, so a stalled branch is named rather than filed under *review it*.

## Motivation

Plot already knows more about workers than this session assumed. `worker_state()`
has distinguished six outcomes since it was written — `running`, `finished`,
`failed (exit N)`, `ended`, `none`, `elsewhere` — and the scan reports every one.
A first reading of this defect claimed the information was missing; it is not,
and that claim is corrected here rather than quietly dropped.

The defect is narrower and harder: **the process exit code cannot answer the
question the row is asking.**

Measured 2026-08-18 across seven worktrees during a four-agent fleet run. Every
worker exited **0**, including:

- one that opened its PR and reported cleanly — genuinely finished;
- one that stopped and wrote *"I have not opened the PR yet. The DoD requires
  `test:board`, and I won't claim a clean run I haven't seen"* — correct, and
  not finished;
- one that stopped with a `TODO(you)` marker asking which retry semantics were
  wanted, listing three trade-offs — not finished either.

All three land on `worker=finished`, whose documented meaning is *review it*.
Two of the three needed an answer, not a review, and the row could not say so.

### The logic exists twice

Found while preparing this plan, and it changes its shape. `worker_state()`
lives in **`plot-dispatch.sh:136`**, and `plot-fleet-scan.sh` carries a second
implementation of the same thing around line 444 — same `.plot-worker.pid`
read, same `kill -0` liveness check, same rejection of pid `0` and non-numeric
values, same exit-code mapping to `finished` / `ended` / `failed`.

They agree today. A seventh state added to one and not the other would make
them disagree about the same worker, which is worse than either being wrong
alone: two consumers would report different verdicts from one fact, and
whichever a reader consulted first would win.

So this plan merges before it extends. That ordering is not tidiness — adding
`stalled` twice is cheap now and is exactly how the two copies came to exist.

### What the exit code cannot see

`worker_state()` reads the process. The process reports how it terminated, not
whether the task is done. A worker that stops *deliberately* — the behaviour this
repo wants, since the alternative is guessing — is indistinguishable from one
that finished.

The distinguishing facts are all in the worktree, and Plot already collects
each of them for other purposes:

| Fact | Already in the scan | Says |
|---|---|---|
| uncommitted files | `local_dirty` | work on the floor |
| commits ahead | `local_ahead` | work not pushed |
| an open PR | `prs` | work reached review |
| a `TODO(you)` marker | — | the worker is waiting on a person |

Only the last is missing, and it is the one that separates *stalled* from
*waiting*.

### Why this is worth a fix rather than a habit

An operator ran a shell guard beside the board for an afternoon to answer
exactly this. It restarted one branch **twice** while its worker was waiting on
an answer — the second restart re-ran work the first had finished. It also
restarted a branch because of an orphaned `plot-dispatch.sh.tmp1`, 10 KB of
editor leftover that read as uncommitted work.

Both were fixed in the guard, and both fixes are judgements this plan moves into
Plot, where they can be tested rather than remembered.

## Design

### Approach

**Add a seventh worker state: `stalled`.** A worker whose process ended without
finishing its task.

The scan already has every input but one. The classification, in order — and the
order is load-bearing:

| Condition | Worker state |
|---|---|
| process alive | `running` |
| an open or merged PR exists | `finished` — the work reached review |
| a `TODO(you)`/`TODO(human)` marker in the worktree | `waiting` |
| uncommitted work or unpushed commits | `stalled` |
| otherwise | `finished` |

**An open PR outranks everything below it.** Work that reached review has left
the worker's hands, so leftover local edits there mean nothing.

**`waiting` outranks `stalled`**, because a marker is the worker saying *your
turn*. Reporting that as stalled invites a restart into the same wait, which is
a loop rather than a rescue.

**The marker is read from the tree, not the log.** The log records that a
question *was asked*; the marker records that it is still *unanswered*, and only
the marker clears when someone writes the answer. Measured: a restarted worker
found its own question already answered in the commit above it and carried on
without asking again.

**Editor leftovers are not work.** `.tmp*`, `.swp`, `.orig`, `.rej`, `.bak` are
excluded from the dirty count. The exclusion stays narrow: an uncommitted source
file is exactly the case this detection exists for.

### What it does not do

**It does not restart anything.** `/plot-dispatch` starts workers and is the one
place that may; the scan reports and is read-only (Manifesto Principle 1 — the
pulse is derived, nothing is written). A `stalled` row names the branch and its
uncommitted count; the decision to relaunch stays where decisions live.

**It does not replace the reaper.** `plot-reconcile-scan.sh` classifies *empty*
claims — a claimed branch with zero commits past a staleness threshold — and
that is a different question with a different answer (reap the claim). A stalled
worker has work worth keeping, and reaping it would destroy exactly what makes
it worth reporting.

### Open Points

- [ ] Is `TODO(you)` the right marker, or should Plot name one of its own? The
      convention emerged from workers this session and is not documented
      anywhere. A marker Plot defines can be searched for reliably; one that
      emerges can drift into `TODO(human)`, `ASK:`, or prose.
- [ ] Should `stalled` carry *what* is on the floor — a count, or the file
      names? The count is cheap; the names make the row actionable without a
      second command.
- [x] `/plot-dispatch --status` reports worker state too. Does it inherit this
      classification? **Yes, and it must** — measured 2026-08-18, the two carry
      independent copies of the same logic (`plot-dispatch.sh:136` and
      `plot-fleet-scan.sh:~444`). Wave 1 collapses them so wave 2 adds the state
      once. Answering this by inspection rather than by asking is why the plan
      grew a wave.

## Branches

### One implementation

- `bug/one-worker-state-not-two` — collapse the duplicate. `plot-fleet-scan.sh`'s inline copy (~line 444) and `plot-dispatch.sh`'s `worker_state()` (line 136) become one source. No behaviour changes: the six states, their names, and their outputs stay exactly as they are. Test: both consumers report the same state for the same worktree across all six cases, driven from one fixture.

### The seventh state

- `bug/finished-is-not-a-verdict` — `stalled`, the `TODO(you)`/`TODO(human)` marker check, the editor-leftover exclusion, and the classification order — added **once**, to the merged implementation. Tests: a worktree with an open PR and dirty files reads `finished`; one with a marker reads `waiting`; one with uncommitted work and no PR reads `stalled`; one with only a `.tmp1` reads `finished`.

## Notes

The prototype is `.dev/scripts/fleet-pulse.sh`, written during the same session
and corrected three times — a question is not abandonment, an open PR is not
abandonment, a temp file is not work. Each correction came from watching it act,
never from reading it. It is deleted once this lands: two things computing
verdicts from one dataset is how they drift.

Related: `docs/plans/2026-08-18-the-board-answers-agents.md` carries the same
verdicts to `/api/attention` for consumers that cannot run the scan. This plan
puts them where the scan already looks; that one exposes them over HTTP. Either
can land first.
