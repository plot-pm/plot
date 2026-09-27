# One answer to is a worker running

> `plot-reap.sh` and `plot-dispatch.sh --stop` read the same desk and disagree. The reaper refuses because a process with that pid is *alive*; the stop refuses because the worker recorded an *exit*. Neither acts, and the desk holds a pool slot forever. The reaper takes a `ps` reading and takes no reading of `.plot-worker.exit` — so a finished worker whose pid has been recycled onto another process reads as live.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1015
- **Sprint:** plot-works-in-the-repos-that-adopt-it
- **Rounds:** 1

## Changelog

- The reaper reads the worker's exit record, so a desk whose worker finished stops being held by a recycled pid.

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

### The two readings, and they ask different questions

`packages/domain/src/rules/reapable.ts:441`:

```ts
liveWorker: ofTree(readings.workerPid !== null && readings.workerPid !== ''),
```

**This line is correct and is not the defect.** `workerPid` is a reading, and every producer resolves liveness before the rule sees it — `plot-reap.sh:506-509` and `:1040-1042` both run `[ -n "$p" ] && ps -p "$p"`, and `entities/worktree.ts:132` passes a boolean the caller already answered. `plot-reap.sh:503-504` states the contract: *"an empty pid file is not a live process, and which of those two it is is the rule's to say."*

So `ps -p 99861` **succeeded** when the reaper printed `worker alive (pid 99861)`. The reaper was not trusting a stale file.

`plot-worker-state.sh:888` reads `.plot-worker.exit` **before** it reports on the process, and refines exit 0 through `plot_worker_task_state` — a TREE reading. Its header says so at `:42`: *"`finished` is refined by the TREE."* The pid it prints comes from the manifest (`:755`), not from `ps`.

| component | the question it asks | the answer for this desk |
|---|---|---|
| `plot-worker-state.sh` | did this worker record an exit? | yes → `finished` |
| `reapable.ts`, via the reap adapter | is a process with this pid alive? | yes → `live-worker` |

**Both were right about their own question.** One number, two meanings: the worker that wrote the exit record is gone, and pid 99861 now belongs to something else.

### The defect

**The reaper has no reading of the exit record at all.** A worker that wrote `.plot-worker.exit` is finished whatever `ps` says about that number since, and the reaper cannot see that fact. `plot-boardctl.sh` records the reason this matters: *"a pidfile outlives its process … and a recycled pid is the worse half of that."*

This plan named recycling as a hypothetical risk in its first draft and argued a stale-file mechanism instead. The measurement above **is** the recycling case, and the stale-file mechanism does not exist.

## Design

### The rule

**The reaper reads `.plot-worker.exit` beside its `ps` reading, and a recorded exit means the worker is not live.**

The domain rule is unchanged — `reapable.ts` takes readings as values and `liveWorker` stays a `ConditionReading`. What changes is the **reading**: the adapter currently answers *is this pid alive* and must answer *is this desk's worker still running*, which a recorded exit settles regardless of the pid.

### Why not route through `plot-worker-state.sh`

That script answers eight states, two of which (`waiting`, `stalled`) are TREE readings about what an agent OWES rather than what its process is doing. A pure domain rule must not gain a shell dependency to learn one boolean, and the reaper is not asking the eight-state question. CLAUDE.md's *"ONE answer"* rule is about that classifier having one implementation — the reaper needs a reading, not the classifier.

### Both sites or neither

`plot-reap.sh:506` and `:1040` carry the liveness snippet independently — the reap loop and the dirty sweep. An exit-record reading added to one leaves the other still refusing, and the sweep would go on printing the desk under *"dirty trees nobody owns"*.

### Ordering is already decided and unchanged

`plot-dispatch.sh` asks the PR **first**, before the state word, because *"five of five `failed` worktrees measured here held a PR."* The reaper already reads `mergedAt` through `plot-pr-merged.sh`. **This plan changes one reading and no ordering.**

### What this does NOT do

- **It does not widen what the reaper removes.** The five refusals stay; one of them starts reading correctly.
- **It does not change `reapable.ts:441`.** That expression is right; the reading behind it is incomplete.
- **It does not change `plot-worker-state.sh`.** It was already correct.
- **It does not touch `--stop`.** It was right.
- **It does not address the correction-file refusal.** That is #1024.

## Done when

- A desk whose worker recorded an exit is reaped, given its other conditions pass, even when a process holds that pid.
- A desk whose worker is genuinely running is still kept, and the refusal still names the pid.
- Both reading sites are covered — the reap loop and the dirty sweep — asserted by a test that drives the sweep's counter as well as the reap decision.
- `reapable.ts` gains no second liveness rule and `:441` is unchanged; the change is in the readings.
- A test drives the reaper and `--stop` against one fixture holding an exit record and a recycled pid, and they agree.

## Slices

### One answer to is a worker running (Branch: bug/one-answer-to-is-a-worker-running)

`plot-reap.sh` reads `.plot-worker.exit` at both reading sites, the `ReapReadings` shape carries it, and the disagreement test is added against a fixture with a recycled pid.

## Notes

Three desks sat unreapable and unstoppable at once on 2026-09-26, each on a merged branch, together holding three of seven pool slots while five slices waited for agents. The operator diagnosed it by reading `kill -0` against the pid file and reported the desks as live before `--stop`'s refusal corrected them.

**Amended after round 1 (2026-09-27).** The first draft claimed `reapable.ts:441` tests a pid file and that a file naming a dead pid reads `true`. Both are false: three producers resolve liveness with `ps` before the rule sees the reading, and `plot-reap.sh:503-504` states that contract in the code. The real divergence is that `plot-worker-state.sh:888` reads the exit record first while the reaper reads only `ps`, so the headline measurement is the **recycled-pid** case the first draft listed as hypothetical. The fix moved from the rule to the readings, and from one site to two.

Each of #1004, #1007 and #1014 should be re-checked against the corrected mechanism before the slice starts: a desk with no exit record is a different case from one whose pid was recycled, and only the second is what this plan now describes.

No juror verdict was written for this plan — the spawned juror reported idle having produced nothing, so the round is the moderator's own measurement and carries no independent lens. See `.plot/panels/2026-09-27-one-answer-to-is-a-worker-running/moderator.md`.
