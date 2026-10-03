# The queue reads the order the scan reads

> The supervisor hands out a slice the scan reports as blocked, and it hands out a slice that merged while its tick ran. Both come from one gap: the queue decides from readings the scan and the host no longer agree with at the moment of the hand-over.

## Status

- **State:** Approved
- **Approved:** 2026-10-02, jwloka, in-session
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1100, #1149
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Started:** 2026-10-02, Jan Wloka, `bug/the-queue-reads-the-scans-order`
- **Started:** 2026-10-03, Jan Wloka, `bug/a-hand-over-is-checked-before-it-is-made`

## Changelog

- The supervisor no longer hands out a slice while an earlier slice of the same plan is unmerged. A claimed earlier slice holds the later one, as the fleet scan already reports.
- A slice whose branch line declares `<!-- waits: <branch> -->` is held until that branch merges, and the tick line counts it as `waits=N`.
- Immediately before a hand-over, the supervisor asks again whether the branch merged or was claimed, and it hands nothing from a reading older than five minutes.

## Motivation

Measured on `origin/main` (`19f662d1`), 2026-10-01.

**The queue completes a slice that is only claimed.** `queueOfPlan` (`packages/board/src/server/queue-reading.ts:144-145`) folds a plan's slice order with `settled = claimed.has(branch) || merged.has(branch)`, and `sliceVerdicts` (`packages/domain/src/rules/eligible.ts:130-137`) advances the chain on `complete`, which `sliceVerdict` answers when no branch is outstanding (`:96`). The fleet scan counts only a merged branch as settled: `plot-fleet-scan.sh:233-236` states the rule, and `:3887-3900` counts `wip` and every other state as outstanding. So a claimed first slice makes the second slice `eligible` for the queue and `blocked` for the scan. The comment above `queueOfPlan` (`queue-reading.ts:108-110`) says the queue must not give a second answer about order, and it gives one.

On 2026-10-01 the first slice of each of three plans held an empty claim ref, and the supervisor handed all three second slices (`bug/the-queue-reads-the-merge-subject`, `bug/the-loop-waits-out-a-usage-limit`, `bug/a-started-agent-leaves-its-starters-group`) to agents while the board showed them `blocked · an earlier slice has to land first`. Each agent wrote `PLOT-BLOCKED`. The three briefs are held in `.plot/briefs/held/` (`19f662d1`) as a workaround.

**The queue cannot read `waits:`.** `plot-plan-meta.sh` reports `waits_on` per branch (measured on `docs/plans/2026-09-30-every-temp-directory-has-an-owner.md`: `"waits_on":"bug/scripts-share-one-temp-helper"`). `branchOf` (`packages/domain/src/adapters/plan-store/plan-store-shell.ts:46-51`) drops it, and `PlanRecordBranch` (`packages/domain/src/ports/plan-store.ts:67-76`) has no field for it. The domain already holds the rule: `waitVerdict` (`eligible.ts:213-220`) and the `held` argument of `isClaimable` (`:168-172`). Nothing on the queue's path calls either. #1100 measured the effect on 2026-09-30: `plot-fleetctl.sh --once` decided `bug/the-suites-own-their-temp-root: hand over to ac80eeac-…` while the scan read that slice `blocked`.

**A hand-over acts on the tick's first reading.** `tick` (`packages/board/src/server/entry/registryd.ts:206-238`) reads the queue once and `startAgents` (`registryd-main.ts:879-905`) calls `performer.assignSlice` for each decision with no further question. #1149 measured a Bitbucket tick of `cost=4692236ms` (78 minutes) that then handed `feature/ewzkus-3845-ueberwachung` to an agent. That branch had merged by PR #3662 and its remote ref was gone. The agent's claim push was rejected three times, and the loop logged `REGISTRY LOCK VIOLATION` (`plot-worker-loop.sh:2290-2293`) about a second agent that did not exist.

## Design

### Slice 1: the queue reads the scan's order and `waits:`

**The fold moves into the domain.** Slice order and the `waits:` hold are domain decisions, and today `queueOfPlan` makes them in `packages/board/src/server/queue-reading.ts:125-175`. Slice 1 moves the fold into `packages/domain/src/rules/queue.ts` as a pure function, `planQueue(plan, claimed, merged, listingWhole)`, over a `PlanRecord`, the claimed set, the merged set and whether the merged listing answered whole. It reads nothing and spawns nothing, like the rest of the file. `queueOfPlan` keeps only the reads and calls it. The domain coverage gate then covers every new branch.

**One `settled` predicate.** The join `claimed.has(branch) || merged.has(branch)` is spelled twice today, at `queue-reading.ts:144-145` and `:307`, and both copies drifted from the scan in the same direction. `rules/queue.ts` exports one predicate, `settled(branch, merged)`, true only where the merged set names the branch: the scan's rule (`plot-fleet-scan.sh:233-236`, `:3887-3900`). The fold passes it to `sliceVerdicts` as the `outstanding` count, and `landedWithoutListing` passes it to `blockingBranches` (`:307`), so the fallback asks about the slice the order waits on. A claimed branch is outstanding for the order. A separate reading, *taken* (`claimed || merged`), still keeps a branch out of the queue (`:165-171`): a claimed branch is not offered again, and a claimed first slice no longer makes the second slice claimable. The 2026-09-06 case in the comment at `:131-143` stays answered, because a merged branch with no ref still settles.

**`waits:`.** `PlanRecordBranch` gains `waitsOn: string` (`''` where none), and `branchOf` maps `raw.waits_on`. For each queued branch with a `waitsOn`, `planQueue` asks `waitVerdict(waitsOn, answer)` with this answer, tested in order:

| Reading | Answer |
|---|---|
| the merged set, after the `landedWithoutListing` fallback, names the prerequisite | `merged` |
| otherwise, the merged listing did not answer whole (`MergedListing.whole === false`, `queue-reading.ts:85-90`) | `unreachable` |
| otherwise | `unmerged` |

`waitVerdict` answers `waiting` for both `unreachable` and `unmerged` (`eligible.ts:213-220`), so a partial listing holds the slice and never offers it. The queue never answers `none`: the merged listing cannot tell *never had a PR* from *has an open PR*, and `blocked` is the scan's word to give. A unit case covers each row, the partial-listing row included: a listing with rows and `whole: false` that does not name the prerequisite holds the slice as `waits`.

**A hold of its own.** `QueueHold` (`packages/domain/src/rules/queue.ts:102-123`) gains `'waits'`, `QueuedSlice` gains `waitsOn: string`, and `whyNotReady` (`:205-210`) answers `'waits'` for a slice whose wait has not cleared, tested after the two landing holds and before `no-brief`. `QUEUE_HOLDS` (`:138-144`) and `HOLD_SCOPE` (`registryd-main.ts:1203-1209`, scope `queue`) add the key, so the tick line reports `waits=N`. The held list (`registryd-main.ts:1293-1305`) prints one line per slice under `held on waits (N):`, and for this hold the line names the prerequisite, in this exact form, so it can be grepped:

```
    bug/the-queue-reads-the-merge-subject — waits on bug/the-merge-subject-is-one-rule (unmerged)
```

The word in brackets is the answer from the table: `unmerged` or `unreachable`.

**What stays.** The rule takes readings as values and fetches nothing. No new script. The scan is not touched.

### Slice 2: a hand-over is checked before it is made

**The rule.** `rules/queue.ts` gains `handOverCheck(reading)`, where `reading` is `{ ageMs, refNow, landedNow }`:

- `ageMs` — milliseconds from the tick's `startedAt` to now;
- `refNow` — `present`, `absent` or `unknown`, the remote ref of the branch asked at hand-over time;
- `landedNow` — the `LandedAnswer` of `queuedHasLanded` asked at hand-over time.

It answers, tested in this order: `stale` where `ageMs > HAND_OVER_MAX_AGE_MS` (300 000, five tick intervals of 60 s); `landed` where `landedNow` is `landed`; `unknown` where `landedNow` or `refNow` is `unknown`; `claimed` where `refNow` is `present`; otherwise `hand-over`. Every answer but `hand-over` withholds the write, and the next tick re-derives the queue, which is the existing recovery for a failed start (`registryd-main.ts:868-871`). The age test is first because no fresh answer about one branch makes a 78-minute reading of the other branches current.

**The bound and its cost.** `HAND_OVER_MAX_AGE_MS` is exported from `rules/queue.ts`, and `startAgents` makes no comparison of its own. Measured 2026-10-01 from `.plot/logs/registryd.log`: this repository logged 7 167 ticks, median 14.4 s, p95 115 s, and 83 ticks (1.2%) over 300 s, maximum 2 479 s; `ewz-kus-portal` logged 1 592 ticks, median 20.2 s, p95 103 s, and 8 (0.5%) over 300 s, maximum 4 692 s (#1149's tick). So the bound withholds the hand-overs of about 1% of ticks, and the next tick hands them over.

**The readings.** The refs port gains `remoteHead(branch)`, `git rev-parse --verify --quiet refs/remotes/origin/<branch>` in `refs-git.ts`, answering `present`, `absent` or `unknown` on a failed call. It reads the last-fetched remote-tracking ref, which the scan's fetch keeps current, and makes no network call: `no-network.test.ts` forbids `ls-remote` in the server (#1252). A git call, not a host call: it spends no API budget. `queuedHasLanded` exists (`queue-reading.ts:66-75`). Both are asked only for a branch about to be handed over, at most the tick's free agents.

**The write.** `startAgents` asks `handOverCheck` before each `performer.assignSlice` and writes `<branch>: not handed — <answer>` where it withholds. `tick` passes its `startedAt` through `TickReport` (`registryd.ts:233`), so the age is measured from the reading and not from the write.

**The message.** When the claim push is rejected, `plot-worker-loop.sh` keeps git's stderr instead of `2>/dev/null` and asks `git ls-remote --heads origin <branch>`. An absent ref prints *"the claim push for <branch> was rejected and origin has no such branch: <stderr>"*; a present ref keeps today's lock-violation line. Telling a stale empty claim from another agent's claim is #1152's, and this slice does not decide it.

### The other hand-over paths

Four other paths start work on a slice, and none hands one out from an aged reading:

- **The board's auto-dispatch** (`packages/board/src/server/auto-dispatch.ts`) counts only slices whose pulse verdict is `eligible` (`:547`, `:593`, `:808`). That verdict comes from the scan, which already reads a claimed first slice as outstanding, so auto-dispatch keeps the order. It runs `plot-dispatch.sh --max <n> <slug>` (`:915-917`), which queues the slice for the registry and pushes no claim (`:921-926`). The hand-over is the supervisor's, and slice 2 checks it.
- **`/api/claim`** (`packages/board/src/server/claim.ts:163`) runs `plot-dispatch.sh --no-start --max <n> <slug>`. That also selects from the scan's eligible list and starts no worker, so it hands nothing to an agent either.
- **The loop's hop** (`skills/plot/scripts/plot-worker-loop.sh:9-11`) asks the scan's `--next` when a slice completes and then pushes the claim (`:2290`). Its reading is seconds old, and a rejected push is the lock. Slice 2's message change applies to that push.
- **`plot-dispatch.sh --restart <branch>`** gives a branch that a person names to a new worker. It decides from no reading.

Both `plot-dispatch.sh` paths take their branches from `plot-fleet-scan.sh --list-eligible` (`plot-dispatch.sh:3850`, `:3898`). Outside tests, only `registryd-main.ts` and the performer port and adapter name `assignSlice`, so `startAgents` is the one place that gives a queued slice to an agent.

A pulse can be minutes old, so auto-dispatch can queue a slice that merged after the scan. The queue then drops it on the next tick (`already-merged`), and slice 2 withholds it if it merged during the tick. No third check is needed.

### Rollout

The supervisor loads `plot-registryd.mjs` once and does not reload it. On this machine the running daemon (pid 10942) started on 2026-09-30, so this fix takes effect only after the artifact is rebuilt and the supervisor restarts (`/plot-fleet --stop`, then `--start`). Today a restart can end the agents in the supervisor's process group (#1144, and #1148 for systemd's cgroup stop). The restart is safe once #1144's second slice, `bug/a-started-agent-leaves-its-starters-group`, has merged and the agents running at that time were started after it. Until then, the operator restarts only when no agent holds unpushed work.

### The held briefs

On 2026-10-01 three second-slice briefs moved to `.plot/briefs/held/` (`19f662d1`) so the running supervisor could not hand them out. The master agent moves each one back to `.plot/briefs/` when its first slice merges:

| Held brief | Moves back when this merges |
|---|---|
| `the-queue-reads-the-merge-subject.md` | `bug/the-merge-subject-is-one-rule` |
| `the-loop-waits-out-a-usage-limit.md` | `bug/the-rule-names-a-usage-limit` |
| `a-started-agent-leaves-its-starters-group.md` | `bug/the-launch-gives-back-the-callers-streams` |

After this plan's slice 1, `bug/the-queue-reads-the-scans-order`, runs in a restarted supervisor, a brief no longer needs to be held: the queue holds a second slice while its first slice is unmerged.

### What this does NOT do

- It does not make the queue read the scan's output. It applies the scan's rule to the same plan records, and a test pins the two to agree.
- It does not change `sliceVerdicts` or `isClaimable`, and it does not change the scan.
- It does not answer `blocked` for a `waits:` naming a branch that never had a PR. The scan reports that; the queue holds it as `waits`.
- It does not shorten a long tick. #1065 and #1094 own the host's cost.

## Slices

### The queue reads the scan's order (Branch: bug/the-queue-reads-the-scans-order, PR: #1247)

`planQueue` and the exported `settled` predicate in `rules/queue.ts`, the order advanced on merged branches only, `PlanRecordBranch.waitsOn`, the `waits` hold, its tick count and its held-list line, and the queue as the corpus test's third surface. <!-- builds: planQueue, settled, the waits queue hold -->

### A hand-over is checked before it is made (Branch: bug/a-hand-over-is-checked-before-it-is-made, PR: #1252) <!-- waits: bug/the-queue-reads-the-scans-order -->

`handOverCheck`, `remoteHead` on the refs port, the check in `startAgents`, and the rejection message in the loop. <!-- builds: handOverCheck, remoteHead -->

## Done when

- Slice 1: `planQueue` lives in `packages/domain/src/rules/queue.ts` with `settled`, and `queue-reading.ts` contains no `claimed.has(` join. A unit case gives `planQueue` a two-slice plan whose first branch is claimed and unmerged and asserts the second slice is not `claimable`; the same case with the first branch merged asserts it is. The domain coverage gate passes at 100% branches.
- Slice 1: `packages/domain/corpus/eligible.corpus.test.ts` adds the queue as a third surface beside the board's verdict and `--list-eligible`: for every slice in `docs/plans/`, `planQueue`'s `claimable` agrees with the scan's verdict, and a disagreement names both answers and the slice.
- Slice 1: unit cases for `waitsOn`, one per row of the answer table: a prerequisite in the merged set clears the hold; an unnamed prerequisite on a listing with rows and `whole: false` holds it as `waits` with `unreachable`; an unnamed prerequisite on a whole listing holds it with `unmerged`.
- Slice 1: a `registryd-main` test asserts the held-list line `<branch> — waits on <prerequisite> (unmerged)` under `held on waits (1):`.
- Slice 1: `plan-store-shell` maps `waits_on` to `waitsOn`, with a case for a branch line that declares none.
- Slice 2: unit cases for every `handOverCheck` answer, one per row, at 100% branch coverage.
- Slice 2: a `startAgents` test with a stub world whose branch merged after the reading asserts no `assignSlice` call and the `not handed — landed` line; a reading 301 s old asserts `not handed — stale`.
- Slice 2: a contract test pushes a claim for a branch absent on a bare origin's sibling and asserts the loop prints the absent-ref message, not `REGISTRY LOCK VIOLATION`.
- Both: `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck` and the domain coverage gate pass. Each slice carries a changeset.

## Notes

Plans one rule for two issues because both are the queue deciding from a reading that is no longer true: #1100 from a claim that is not a landing, #1149 from a listing that is no longer current. #1139's merge-subject proof, once merged, feeds `landedNow` through `queuedHasLanded` and needs no change here. #1152 owns the stale-claim message case.
