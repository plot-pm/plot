---
"plot": minor
---

plot-fleet-scan: report when a branch last CHANGED, not only what state it is in

`local_ahead` and `local_dirty` are **state**, not **change**, and that is the
gap. Measured 2026-08-18 across four concurrent workers:

| Branch | Runtime | Commits | Outcome |
|---|---|---|---|
| `the-gate-reads-what-was-shared` | 55 min | 4 | **opened its PR** — the session's hardest bug |
| `the-scan-enumerates-the-ref` | 27 min | 0 | uncommitted, nothing written for 6 min |

The branch that had just opened a PR read `ahead=0 dirty=False` — commits
pushed, tree tidy — bit-identical to a branch claimed a minute earlier and
abandoned. Two opposite situations, one row. Runtime could not separate them
either: the **longest-running worker was the most productive**, so an operator
watching the clock would have restarted exactly the wrong one.

`--json` now carries `changed_ago_seconds` per branch, the max of three sources:

- the newest commit (`git log -1 --format=%ct`, the **committer** date — a
  rebase or amend rewrites it, and the rewrite is the evidence of work)
- the newest mtime of real work on the floor, editor leftovers excluded
- the worker log's mtime, when one exists

Verified on the live estate: `bug/the-scan-prunes-what-it-fetches` and
`bug/finished-is-not-a-verdict` both read `ahead=0 dirty=False` and last changed
**8.8 and 8.7 hours ago**, while `feature/the-worker-log-is-readable` reads the
same `dirty=True` as three others and last changed **1 second ago**.

## It is a measurement, and never a verdict

No threshold, no `stalled`, no "probably stuck". "Stuck" depends on what the
branch is doing: fifteen minutes of silence is alarming during an edit and
unremarkable during `test:board`, which takes about that long by itself. The
threshold belongs to the reader; the measurement belongs in the scan
(Principle 3). `plot-worker-state.sh` owns worker verdicts and gained
`waiting`/`stalled` in #219 — this adds a number, not an opinion.

**A fact measured after the plan was written:** a worker deep in a serial test
run writes no file for minutes while its *child processes* work. This reports
that worker as quiet, and the number is honest — nothing was written. A consumer
that renders "quiet" as "stuck" will restart a healthy worker mid-suite and redo
everything it had done, which is the failure the plan measured. Stated in the
scan's header, not only here.

## Absent is `null`, never `0`

A branch with no worktree on this machine reports nothing — the same *cannot
see* that `worker: elsewhere` already gives. The other local signals have an
absent value that is also a real value (`false`, `0`, `""`); seconds have none.
A `0` would read as "changed this instant", the most reassuring answer
available, handed to every branch nobody can observe.

## The open point, decided: the pushed branch is NOT covered

`git log -1 origin/<branch>` would catch a worker on another machine moving a
ref. Declined on two grounds. The cost lands **exactly on the population that
must stay free** — a branch with no local worktree is the one whose remote ref
would be its only source, so the call cannot be skipped for precisely the
branches this skips, and the plan's cost argument depends on skipping them. And
the field would stop meaning one thing: every other `local_*` signal answers
*what this machine can see*, while a remote ref is what the refs say, which the
scan already reports as `state` and `claimed`. Deferred rather than rejected — if
the fleet ever spans machines in practice, the right shape is a separate field
with its own absent value. A test asserts the call is absent, so it cannot
reappear silently.

## Three things the plan did not anticipate

**One `stat` per file would have been slower than the work it measures.** The
plan budgeted "one directory stat per worktree"; the design it describes implies
one per *file*, and a worker mid-build has hundreds. Measured here: 50
sequential forks cost 3.1 s, one batched call over three paths cost 0.023 s.
`stat` takes many paths and prints one line each on both dialects, so the whole
list costs one fork.

**One `git status` per worktree, not two.** Asking `plot_worker_dirty` for the
file list ran a *second* status on a worktree the sweep had already asked.
`fleet.test.mjs` counts those calls and caught it — the board polls this every
5 s. The filter is now split from the fetch (`plot_worker_dirty_filter`) and the
newest-mtime is reduced to one integer in the worktree table, where the status
output already exists.

**The scan may not name `.plot-worker.` at all.** `workerstate.test.mjs` asserts
it, because a read-only scan that touches the worker record has started
classifying workers again — the duplication removed on 2026-08-18 after the two
copies had drifted. The log lookup moved to `plot_worker_log()` in the shared
file, which owns those filenames; the scan asks for a path and reads the time.

Two constants were extracted rather than copied, on the file's own stated rule:
`PLOT_EDITOR_LEFTOVER` (the `.tmp*`/`.swp`/`.orig`/`.rej`/`.bak` list, inline
while it had one caller and now shared, so a `.tmp1` cannot reset this clock
while being excluded from `worker_dirty_paths`), and the `stat`-format detection,
now probed once per run and lazily inside `file_mtime` so the function stays
independently extractable — `fleetdelivered.test.mjs` lifts it out by regex and
caught the reshape.

<!--
bumps:
  skills:
    plot: minor
-->

`plot` alone: `plot-fleet-scan.sh` and `plot-worker-state.sh` both live under
`skills/plot/scripts/`. No board change — the `/api/fleet` schema strips unknown
keys, so an older board ignores the new field and the change stays additive.
Whether the Agents tab wants a column remains open in the plan, deliberately: a
raw age invites the operator to build the threshold in their head, which is the
habit the plan is trying to replace.
