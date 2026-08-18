# The pulse measures progress, not elapsed time

> A worker at 55 minutes and a worker at 55 minutes look identical. One had just opened a PR; the other had written nothing for half an hour. The row shows the clock, and the clock is the one number that cannot tell them apart.

## Status

- **Phase:** Approved
- **Type:** feature
- **Story:** plot-board
- **Sprint:** working-shows-the-agent
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-18, jwloka, in-session
- **Started:** 2026-08-19, Jan Wloka, `feature/the-pulse-reports-when-work-last-changed`

## Changelog

- `plot-fleet-scan.sh` reports when a branch last *changed*, not only how long its worker has been running, so a long job and a stuck one stop looking the same.

## Motivation

Measured 2026-08-18 across four concurrent workers:

| Branch | Runtime | Commits | Outcome |
|---|---|---|---|
| `the-gate-reads-what-was-shared` | 55 min | 4 | **opened PR #215** — the session's hardest bug |
| `a-squashed-branch` | 32 min | 4 | working |
| `the-board-test-does-not-race` | 25 min | 3 | opened PR #214 |
| `the-scan-enumerates-the-ref` | 27 min | 0 | uncommitted work, no file written for 6 min |

The longest-running worker was the **most productive**. Runtime carried no
signal about health, and an operator watching the clock would have restarted
exactly the wrong one.

### What the scan already has, and why it is not enough

The scan reports `local_ahead` and `local_dirty` per branch. Both are **state**,
not **change**:

```
bug/the-gate-reads-what-was-shared    ahead=0 dirty=False worker=running
```

That row was taken while the branch had an open PR and four commits behind it.
It reads identically to a branch someone claimed a minute ago and abandoned:
`ahead=0` because the commits were pushed, `dirty=False` because the tree is
clean. Two opposite situations, one row.

`ageMinutes` exists on board rows, but it measures **the last commit**, which is
silent for the whole span between commits — precisely the window where a worker
is either deep in a test suite or dead.

### Why this matters more with agents than with people

A person who walks away from a branch tells someone, or does not come back
tomorrow. A worker exits silently and leaves a worktree that looks exactly like
one being worked in.

A shell guard written during this session tried to fill the gap and had to be
corrected three times — a question is not abandonment, an open PR is not
abandonment, a temp file is not work. Each correction came from watching it act.
What it never had, and what would have made it right the first time, is a single
fact: **when did this branch last change?**

### The failure this prevents

Restarting a healthy worker is not free. It re-runs work already done, and this
session measured the cost directly: one branch was restarted twice while its
worker waited on an answer, and the second restart redid what the first had
finished.

The inverse costs more. A worker that died at minute 3 of a 55-minute wait is
indistinguishable from one still thinking, and the operator finds out when the
fleet has been idle for an hour.

## Design

### Approach

**Report the age of the newest change to the branch, from any source.** Not the
last commit — the last *evidence of work*, which is the max of:

- the newest commit's timestamp (`git log -1 --format=%ct`)
- the newest mtime among tracked-but-modified and untracked files in the
  worktree, excluding editor leftovers (`.tmp*`, `.swp`, `.orig`, `.rej`, `.bak`)
- the worker log's mtime, when one exists

Emitted as `changed_ago_seconds` beside the existing `local_ahead` and
`local_dirty`. A branch with no worktree on this machine reports it as absent —
the same *cannot see* the six worker states already use for `elsewhere`, never a
fabricated zero.

**The scan reports the number and draws no conclusion.** "Stuck" is a judgement
that depends on what the branch is doing: fifteen minutes of silence is alarming
during an edit and unremarkable during `test:board`, which takes that long by
itself. The threshold belongs to the reader; the measurement belongs here.

### Why not measure the process

CPU time or a liveness probe would answer "is it alive", and the scan already
answers that with six worker states. The question this plan adds is *is it
getting anywhere* — and a worker blocked on a network call, waiting on a lock,
or looping is alive and idle at once.

The tree is also the only source that survives the worker. A dead worker's last
change is still visible; its CPU time is not.

### The cost, and why it is small

One `git log -1` plus one directory stat per worktree — comparable to the
`local_dirty` check already made for every branch, and skipped entirely for
branches with no local worktree. The board polls the scan on a 5 s cache, so
this cost is paid once per cache window rather than per request.

### Open Points

- [ ] Should `changed_ago_seconds` also cover the *pushed* branch — a worker on
      another machine changes a ref, and that is evidence of work this machine
      cannot see in a worktree. `git log -1 origin/<branch>` would catch it at
      the price of a second call per branch.
- [ ] Does the board's Agents tab want this as a column, or only as input to a
      verdict? A raw age invites the operator to build the threshold in their
      head, which is the habit this plan is trying to replace.
- [ ] `docs/plans/2026-08-18-finished-is-not-a-verdict.md` adds a `stalled`
      state from tree contents. Should `stalled` require *both* work on the floor
      **and** a stale `changed_ago_seconds`? That would make the two plans
      dependent, which is why it is a question rather than a decision.

## Branches

- `feature/the-pulse-reports-when-work-last-changed` — `changed_ago_seconds` in `plot-fleet-scan.sh`, computed from commits, worktree mtimes and the worker log, with editor leftovers excluded and an absent value for branches with no local worktree. Tests: a worktree touched a second ago reports near zero; one untouched for an hour reports that hour; a branch with no worktree reports absent, never zero; a `.tmp1` written now does not reset the clock. — PR #238

  **Wait for the file.** `plot-fleet-scan.sh` is held by two other plans' branches as this is written — the squash-merge detection fix (~558/621) and the ref-enumeration fix (~121/134/270), both with uncommitted work. This change sits beside the `local_dirty` computation, disjoint from both, but three agents in one 1200-line bash file produced several rebase rounds earlier the same day and the value here does not justify a fourth. Dispatch once those two have merged.

  (Those two are named in prose rather than in backticks on purpose: `plot-plan-meta.sh` reads any backticked branch name in this section as a branch *of this plan*, and dispatch would then try to claim them. Verified — the first draft of this note made the parser report three branches instead of one.)

## Notes

Prompted by an operator watching four workers and asking whether a better model
would help. It would not: the longest-running worker produced the session's
hardest fix, and the time went into test suites that run serially because
`discovery.test.mjs` races its own server. The clock was never the problem —
reading it as a health signal was.

Related: `docs/plans/2026-08-18-finished-is-not-a-verdict.md` classifies a worker
that stopped; this one measures one that has not. They share a consumer and
nothing else, and either can land first.
