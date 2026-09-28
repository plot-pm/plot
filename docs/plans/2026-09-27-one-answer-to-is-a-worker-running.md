# One answer to is a worker running

> `plot-reap.sh` and `plot-dispatch.sh --stop` read the same desk and disagree. The stop asks whether a `claude` process still descends from the wrapper and answers `finished` when none does; the reaper asks only whether the wrapper's pid is alive and answers `live-worker`. **A wrapper outlives its agent**, so one pid gets two answers and the desk holds a pool slot forever.

## Status

- **State:** Approved
- **Approved:** 2026-09-27, jwloka, in-session
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1015
- **Sprint:** plot-works-in-the-repos-that-adopt-it
- **Rounds:** 2
- **Started:** 2026-09-27, Jan Wloka, `bug/one-answer-to-is-a-worker-running`

## Changelog

- The reaper asks whether an agent still runs at a desk, not merely whether the wrapper's pid is alive. A desk whose agent is gone stops being held by its surviving wrapper.

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

`packages/domain/src/rules/reapable.ts:89`, inside `reapProblems` — **the rule the reaper actually calls** (`plot-reap.sh:596` imports `firstReapRefusal`):

```ts
if (readings.workerPid !== null && readings.workerPid !== '') {
  problems.push({ refusal: 'live-worker', detail: readings.workerPid });
}
```

**This is correct and is not the defect.** `workerPid` is a reading, and every producer resolves liveness with `ps` before the rule sees it — `plot-reap.sh:506-509` and `:1040-1042`, plus `entities/worktree.ts:132`. `plot-reap.sh:503-504` states the contract: *"an empty pid file is not a live process, and which of those two it is is the rule's to say."*

`plot-worker-state.sh:863-873` asks a **second** question the reaper never asks:

```sh
if plot_worker_agent_alive "$pid"; then
  printf 'running\t%s\t' "$pid"; return
elif [ "$?" -eq 1 ]; then
  # The wrapper is alive and the agent is gone. The DESK decides what that
  # means — `stalled` for work only this machine holds, `waiting` for a
  # marker, `finished` for a desk that is clear — because the process has
  # nothing left to say. No exit file exists: the wrapper has not exited.
  printf '%s\t%s\t' "$(plot_worker_task_state "$wt" "$has_pr")" "$pid"; return
fi
```

| component | the question | the answer for this desk |
|---|---|---|
| `plot-worker-state.sh` | does a `claude` process still descend from this wrapper? | no → refine by the DESK → `finished` |
| `reapProblems`, via the reap adapter | is the wrapper's pid alive? | yes → `live-worker` |

**Both are right about their own question.** A wrapper outlives its agent, and no exit file exists because the wrapper has not exited.

### Reproduced 2026-09-27

Sandbox desk: a live `sleep` standing in for the wrapper, `.plot-worker.wrapper.pid` beside it, **no `claude` child**, clean tree, branch pushed, **no exit record**:

```
plot_worker_state    = [finished|23768|]
plot-reap.sh reading:  PLOT_PID='23768' -> 'worker alive (pid 23768)'
```

The estate's transcript, with no recycled pid and no exit record.

### The defect

**The reaper has no reading of whether an agent still runs at the desk.** `grep -c 'plot_worker_agent_alive\|plot-worker.exit' plot-reap.sh` → **0**. It asks `ps` about the wrapper and stops there, so every desk whose agent exited while its wrapper survived reads as live and can never be reaped.

### Two earlier diagnoses of this transcript were wrong

Both read as measured and neither produces it. Recorded because the pattern is the finding:

- **Draft 1** blamed a string test on a pid file. Refuted: three producers run `ps` first.
- **Round 1** blamed a recycled pid plus an unread exit record. Refuted: `:888` sits **after** the `kill -0` branch returns, under *"The process is gone. What exit code did it leave?"* (`:880-882`), so the exit record is read only when the pid is **dead**. Measured with an exit record present and the pid alive, `plot_worker_state` answers **`running`** — so `--stop` would have killed the recycled process rather than printing `finished`.

**`finished` was the tell throughout.** On a live pid it is reachable only through `plot_worker_agent_alive`.

## Design

### The rule

**The reaper asks whether an agent still runs at the desk, not merely whether a pid is alive.**

`reapProblems` is unchanged and `liveWorker` stays a `ConditionReading`. What changes is the **reading**: the adapter currently answers *is this wrapper's pid alive* and must answer *is an agent still working here*, which the agent-descendant check settles.

### Where the reading comes from

`plot-worker-state.sh` already answers it, and the reaper is an **adapter** — it spawns `node`, `git`, `ps` and `plot-pr-merged.sh`, and sources shell helpers already. **There is no layering objection**: an earlier draft argued *"a pure domain rule must not gain a shell dependency"*, which refuted a design nobody proposed. The rule takes readings as values; the adapter takes them however it likes.

**Settled 2026-09-27: source `plot-worker-state.sh` whole, and map only the PROCESS states.** The reaper consumes `running`, `finished`, `failed`, `ended` and `none`, and **explicitly discards `waiting` and `stalled`** — those two are read from the DESK and answer *what does this agent still owe*, which is a different question and one `uncommitted-changes` already answers.

This honours both rules at once rather than trading one against the other. CLAUDE.md's *"ONE answer to is a worker running"* is satisfied because there is one classifier; its Agent/Worker split is satisfied because only the machine-side states cross into a rule about removing a checkout. **A mapping that consumed `stalled` would put an agent-side fact into a process-side decision**, which is the confusion the split exists to prevent.

The slice states the five-to-one mapping in code and a test names the two discarded states, so a later reader cannot quietly widen it.

### The unpushed-commits guard, and it is a hazard this creates

`plot-reap.sh:596` calls `firstReapRefusal` → `reapProblems`, which has **no `unpushedCommits` refusal**: its four are `live-worker`, `blocked-marker`, `uncommitted-changes`, `on-default-branch`. The reaper supplies no `ahead` reading. Only `finishedWith` carries that guard and the reaper never calls it.

**So widening *not live* widens what can be reaped**, and a desk whose agent finished may hold committed-but-unpushed work that only this checkout has. MEMORY records the loss twice — *"324 finished lines sat uncommitted"*, *"a stalled worker exits 0 with uncommitted work"*. **The slice adds the guard in the same change**, or the fix trades a stuck desk for lost work.

### Both sites or neither

`plot-reap.sh:506` and `:1040` carry the liveness snippet independently — the reap loop and the dirty sweep. A reading added to one leaves the sweep still printing the desk under *"dirty trees nobody owns"*.

### The re-check was attempted and the fact is unrecoverable

**Searched 2026-09-27, and this plan rests on the sandbox reproduction alone.** #1004, #1007 and #1014 are confirmed `MERGED` on 2026-09-26, so the deadlock is real — but whether each desk had a surviving wrapper with a dead agent cannot now be established:

| where the fact would be | what is there |
|---|---|
| the three worktrees | gone — `git worktree list` names none of them |
| per-slug dispatcher logs | absent |
| the five agent manifests | every one deleted with its desk |
| `registryd.log` | **hand-overs only** — `hand over to <id>` and `handed to <id>`, no supervision verdict for any of the three |

**So the mechanism is proven to EXIST and is not proven to be the one the estate hit.** The sandbox fixture produces the reported transcript character for character in shape; that is the whole evidential basis, and it is stated here rather than implied.

**A finding falls out of the search itself, and it belongs to #1030 from the other side.** Nothing on this machine records *how a desk ended*. The supervisor logs the assignment and not the outcome, and the manifest — the one artifact holding `attempts`, the state at death, and the machine's readings — is deleted by the reap. A post-mortem is impossible by construction, which is why two rounds of this plan could argue from inference for a day without anybody being able to check.

**The slice must therefore not claim the reported incident as its test.** Done-when item 1 names the sandbox fixture, deliberately.

### What this does NOT do

- **It does not widen what the reaper removes, beyond the one reading** — and it adds the unpushed guard so that widening cannot lose work.
- **It does not change `reapProblems`.** The expression at `:89` is right; the reading behind it is incomplete.
- **It does not touch `--stop`.** It was right.
- **It does not claim `plot-worker-state.sh` is flawless.** On a manifest-less desk it has no `startedAt` and `:788-793` trusts `kill -0` — the slice states whether that window is in scope.
- **It does not address the correction-file refusal.** That is #1024.

## Done when

- A desk whose wrapper is alive and whose agent has exited is reaped, given its other conditions pass — **the sandbox fixture is the test, not the reported incident**, whose desks and manifests are gone.
- A desk with a live agent is still kept, and the refusal still names the pid.
- **A desk holding unpushed commits is never reaped**, and the refusal names them — the guard `reapProblems` does not have today.
- Both reading sites are covered, asserted by a test driving the sweep's counter as well as the reap decision.
- The reaper and `--stop` agree on one fixture, and the test names the agent-descendant fact as the reason.
- The five-to-one state mapping is in code, and a test names `waiting` and `stalled` as deliberately discarded.
- `reapProblems` gains no second liveness rule; the change is in the readings.

## Slices

### One answer to is a worker running (Branch: bug/one-answer-to-is-a-worker-running, PR: #1033)

`plot-reap.sh` takes the agent-descendant reading at both sites, the unpushed-commits guard lands with it, and the agreement test runs against the live-wrapper/dead-agent fixture.

## Notes

Three desks sat unreapable and unstoppable at once on 2026-09-26, each on a merged branch, together holding three of seven pool slots while five slices waited for agents. The operator diagnosed it by reading `kill -0` against the pid file and reported the desks as live before `--stop`'s refusal corrected them.

**Amended after round 1 (2026-09-27).** The first draft claimed `reapable.ts:441` tests a pid file and that a file naming a dead pid reads `true`. Both are false: three producers resolve liveness with `ps` before the rule sees the reading, and `plot-reap.sh:503-504` states that contract in the code. The real divergence is that `plot-worker-state.sh:888` reads the exit record first while the reaper reads only `ps`, so the headline measurement is the **recycled-pid** case the first draft listed as hypothetical. The fix moved from the rule to the readings, and from one site to two.

Each of #1004, #1007 and #1014 should be re-checked against the corrected mechanism before the slice starts: a desk with no exit record is a different case from one whose pid was recycled, and only the second is what this plan now describes.

No juror verdict was written for this plan — the spawned juror reported idle having produced nothing, so the round is the moderator's own measurement and carries no independent lens. See `.plot/panels/2026-09-27-one-answer-to-is-a-worker-running/moderator.md`.

**Round 2 (2026-09-27): the mechanism was wrong again.** The evidence juror committed `amend` having executed, **reproduced the transcript in a sandbox**, and refuted round 1's diagnosis from the code it cited. Round 1 said the exit record is read first; it is read only when `kill -0` fails, and with a live pid plus an exit record `plot_worker_state` answers `running` — so the transcript was unreachable by the mechanism the plan named. The actual divergence is `plot_worker_agent_alive`: a wrapper outliving its agent, with no exit file at all, which is what `plot-worker-state.sh:868-871` says in its own comment.

Three further findings landed: the reaper calls `firstReapRefusal` → `reapProblems`, so **`reapable.ts:441` is not on its path** and round 1 exonerated a line the subject does not execute; `reapProblems` has **no `unpushedCommits` refusal** and the reaper supplies no `ahead`, so widening *not live* can lose work; and the domain-purity objection was refuting a design nobody offered.

**A process failure is recorded with it.** The juror's verdict arrived at 17:33; a moderation declaring it absent was written at 17:26 and the plan was amended, committed and pushed from that moderation. The panel was still running. The juror caught it — *"the file changed on disk mid-review"* — and re-measured against the amended text, which is the only reason the round is usable. **A juror that has not written is not a juror that found nothing.**

Verdict and full reading: `.plot/panels/2026-09-27-one-answer-to-is-a-worker-running/evidence.md`, moderation in `moderator.md`.

**Three decisions taken with the operator, 2026-09-27.** Each was a call the evidence could not make alone:

- **The unpushed-commits guard lands in the same slice.** One slice does two things, and the reason is that no intermediate commit may be able to lose work. The alternative — liveness first, guard after — leaves a window open across a push.
- **`plot-worker-state.sh` is sourced whole and only its process states are mapped.** See the Design section; `waiting` and `stalled` are discarded by name.
- **The re-check was attempted and failed.** The operator did not recall the process table for the three desks, and nothing on the machine holds it. The plan says so rather than carrying the question forward a third round.
