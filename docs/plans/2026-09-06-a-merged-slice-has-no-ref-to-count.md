# A merged slice has no ref to count

> Eight briefed, eligible slices were dispatched and every one was held `not-claimable`. The queue counts a slice's outstanding branches from remote refs, and a merged branch's ref is deleted — so slice 1 reads unfinished forever and every slice behind it reads `blocked`.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches

## Changelog

- A slice whose branches have merged reads as complete, so the slices behind it become eligible.

<!-- Board impact: the board already renders these slices as eligible, because
     it asks the host. This makes the queue agree with what the board shows. -->

## Motivation

**Measured 2026-09-06.** Eight slices were briefed, pushed to `origin/main`, and dispatched. The supervisor's tick:

```
plot-registryd tick agents=8 handed=3 held=479 idle=5
  already-merged=9  merge-unknown=0  no-brief=0  not-claimable=470  no-free-agent=0
```

**Five agents free, no briefs missing, and all eight held `not-claimable`.**

**THE ARITHMETIC IS IN ONE LINE.** `queue-reading.ts:91`:

```ts
outstanding: slice.branches.filter(
  (line) => !line.deferred && !claimed.has(line.branch),
).length,
```

`claimed` is the set of branches **with a remote ref**. Its comment states the intent — *"A branch with a ref has been started by somebody; one without has not."* That is true of a branch nobody has begun. **It is false of a branch that merged**, because merging deletes the ref, and `plot-release-refs.sh` deletes the rest deliberately.

**SO A MERGED BRANCH COUNTS AS OUTSTANDING**, its slice never reaches `complete`, and `sliceVerdicts` propagates that: `priorComplete &&= verdict === 'complete'` makes every later slice `blocked`.

**Verified on `a-lifecycle-is-enforced-by-a-test`.** Six slices, one branch each. Slices 1–5 merged as **#707, #710, #716, #720, #723**. Not one of the six branches has a remote ref. Slice 6 is `blocked`, and the plan's own work is finished five-sixths of the way.

**ALL EIGHT DISPATCHED SLICES ARE LATER SLICES**, and every one hits this:

| plan | slices | dispatched |
|---|---|---|
| `a-lifecycle-is-enforced-by-a-test` | 6 | slice 6 |
| `every-element-is-a-domain-concept` | 6 | a later slice |
| `the-workflow-owns-the-word-phase` | 5 | a later slice |
| `a-process-is-started-by-its-own-command` | 5 | a later slice |
| `a-pulse-says-what-changed` | 3 | slice 3 |
| `a-sprint-knows-when-it-ended` | 4 | slice 4 |
| `every-generated-bundle-is-marked` | 2 | slice 2 |
| `the-last-two-callers-ask-the-adapter` | 2 | slice 2 |

**THE BOARD AND THE QUEUE DISAGREE, AND THE BOARD IS RIGHT.** The board renders all eight as `eligible` and offers *Start work*; the queue holds them. Two readers of one estate giving opposite answers is the defect this repo keeps measuring, and here it stops the fleet.

**THE READING THE QUEUE NEEDS IS ALREADY IN THE FILE.** `queue-reading.ts:28` declares `sliceHasMerged(branch)` on `QueueWorld` and `:172` calls it — for agent entries, not for `claimable`. The question is asked; its answer never reaches the verdict.

## What this is not

**Not a change to `sliceVerdict`.** `rules/eligible.ts` is right: a slice with zero outstanding branches is complete, and a slice behind an incomplete one is blocked. It is being handed the wrong `outstanding`.

**Not a reason to keep merged refs.** `plot-release-refs.sh` deletes them for a measured reason — the fleet scan went 218.5 s → 111.5 s over nine branches. Keeping refs to make a count work would trade a correctness fix for a performance regression.

**Not ancestry.** `CLAUDE.md`'s gate is explicit: the host answers *did this land*, never `git merge-base`. Squash-merge leaves a branch ahead of main forever, and this repo measured ancestry disagreeing with the host on **ten of ten** branches.

## Slices

### A merged branch is not outstanding (Branch: bug/a-merged-slice-has-no-ref-to-count)

`outstanding` counts a branch as done when the host says it merged, not only when a ref exists.

**THE THREE STATES MUST STAY THREE.** A branch is *unstarted* (no ref, not merged), *in flight* (ref exists), or *landed* (merged, ref gone). Today's reading collapses the first and third, and they are opposites.

**IT ASKS THE HOST, THROUGH THE READING ALREADY DECLARED.** `sliceHasMerged` is on `QueueWorld` and implemented; this slice routes its answer into the `outstanding` count. No new port, no new script, no `gh` call outside the adapter.

**AN UNREACHABLE HOST MUST NOT MAKE WORK VANISH.** `plot-pr-merged.sh`'s rule is that silence answers *not merged*, so nothing is removed on a failed reading. Here the same silence must answer *outstanding* — a slice stays blocked rather than becoming spuriously eligible and handing an agent finished work. **Failing toward blocked is the safe direction, and it is the opposite of the reaper's.** Say so in the code.

**THE COST IS A HOST CALL PER BRANCH PER TICK, AND IT MUST BE BOUNDED.** The tick already asks the host once per agent. A naive implementation asks once per branch across 470 held slices. Reuse the merged-PR list the scan already bundles, or cache per tick — `plot-fleet-scan.sh`'s `PLOT_TERMINAL_CACHE` is the precedent for asking about a terminal state once.

**Done when** a slice whose branches have all merged reads `complete`, the slices behind it read `eligible`, an unreachable host leaves them blocked rather than eligible, the eight measured slices dispatch, and the tick's host cost does not grow with the held count.

## Notes

### Why this was invisible until today — 2026-09-06

The queue's hold reasons were counted for the first time this morning (`the-supervisor-says-why-it-handed-nothing`). Before that a tick reported `handed=0 queued=480` and nothing else, so a slice held for this reason was indistinguishable from a slice nobody had briefed.

**The fix that made it visible found it within the hour.** `not-claimable=470` against eight slices the board calls eligible is a contradiction a reader can act on; `queued=480` is not.
