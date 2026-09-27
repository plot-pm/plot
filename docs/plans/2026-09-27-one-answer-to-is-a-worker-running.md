# One answer to is a worker running

> `plot-reap.sh` and `plot-dispatch.sh --stop` read the same desk and disagree. The reaper refuses because the worker is *alive*; the stop refuses because it is *finished*. Neither acts, and the desk holds a pool slot forever. `reapable.ts:441` tests whether a **pid file is non-empty**; `plot-dispatch.sh:185` sources `plot-worker-state.sh`, which asks the **process table**.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1015
- **Sprint:** plot-works-in-the-repos-that-adopt-it
- **Rounds:** 0

## Changelog

- The reaper asks `plot-worker-state.sh` whether a worker is running, as everything else does. A desk whose pid file outlived its process stops being unreapable.

Board impact: none directly. The board renders what the scan reports, and a reaped desk simply stops appearing.

## Motivation

### Measured 2026-09-26, one desk, two readings

```
$ plot-dispatch.sh --stop bug/a-wave-says-which-question-it-answered
bug/a-wave-says-which-question-it-answered is not running (finished 99861)

$ plot-reap.sh --dry-run
keep  bug/a-wave-says-which-question-it-answered   worker alive (pid 99861)
```

One process, two components, opposite answers. Three desks were in this state at once — `#1004`, `#1007` and `#1014` all merged — each holding a pool slot that nothing could release.

### The two readings

`packages/domain/src/rules/reapable.ts:441`:

```ts
liveWorker: ofTree(readings.workerPid !== null && readings.workerPid !== ''),
```

**A string test on a pid file.** A file that names a dead pid reads `true`.

`plot-dispatch.sh:185` sources `plot-worker-state.sh`, which asks the process table and answers one of eight states — `finished` among them.

### CLAUDE.md already names the one answer

> `plot-worker-state.sh` — **the ONE answer to "is a worker running in this worktree?"** — *sourced, not run*, by both `plot-dispatch.sh` and `plot-fleet-scan.sh`. It carried five of its six states in duplicate until 2026-08-18, and the copies had already drifted on the sixth.

**The reaper is a third caller that does not use it**, and the drift the rule was written to prevent is exactly what happened.

### Why a pid file is the wrong reading

`plot-boardctl.sh` records the same lesson for the board: *"a pidfile outlives its process — which is why `plot-worker-state.sh` never reads one without `ps` beside it, and a recycled pid is the worse half of that."*

A recycled pid is the sharper risk here: the reaper would read some unrelated process as this desk's worker and refuse forever.

## Design

### The rule

**The reaper's `liveWorker` reading comes from `plot-worker-state.sh`, not from the presence of a pid file.**

The domain rule is unchanged — `reapable.ts` takes readings as values and `liveWorker` stays a `ConditionReading`. What changes is the **caller**: `plot-reap.sh` asks the one answer and supplies the result, as `--stop` already does.

### Which states count as live

`running` and `waiting` are live. `finished`, `failed`, `ended`, `none` and `elsewhere` are not.

**`stalled` is the open one** and the slice must argue it: it means unlanded work with no PR, which is a reason to *keep* a desk — but `uncommittedChanges` already answers that, and answering it twice is the duplication this plan removes.

### Ordering matters and is already decided

`plot-dispatch.sh` asks the PR **first**, before the state word, because *"five of five `failed` worktrees measured here held a PR."* The reaper already reads `mergedAt` through `plot-pr-merged.sh`. **This plan changes one reading and no ordering.**

### What this does NOT do

- **It does not widen what the reaper removes.** The five refusals stay; one of them starts answering correctly.
- **It does not change `plot-worker-state.sh`.** It has the answer; this adds a caller.
- **It does not touch `--stop`.** It was right.
- **It does not address the correction-file refusal.** That is #1024.

## Done when

- A desk whose pid file names a dead process is reaped, given its other conditions pass.
- A desk with a live worker is still kept, and the refusal still names the pid.
- The reaper and `--stop` cannot disagree about one desk — asserted by a test that drives both against one fixture.
- `reapable.ts` gains no second liveness rule; the change is in the caller.

## Slices

### One answer to is a worker running (Branch: `bug/one-answer-to-is-a-worker-running`)

`plot-reap.sh` sources `plot-worker-state.sh` for `liveWorker`, the `stalled` question is argued and settled, and the disagreement test is added.

## Notes

Three desks sat unreapable and unstoppable at once on 2026-09-26, each on a merged branch, together holding three of seven pool slots while five slices waited for agents. The operator diagnosed it by reading `kill -0` against the pid file — the same wrong reading the reaper makes — and reported the desks as live before `--stop`'s refusal corrected them.
