# A dead desk reads unreadable, and a merged PR asks no one

> Two fixes to the ending table. A dead plan-named desk with work beyond its claim, no pull request and no ending gets the `unreadable` ending, so the existing bound arm starts one fresh session and then asks a person. The `holding-work` arm reads `prMerged` and asks no person after the pull request merged.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #2906
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2

## Changelog

- fleetd writes an `unreadable` ending for a dead desk whose worker exited 0 or left no exit record, whose branch holds a commit beyond its claim, and for which the host answers that no pull request exists. The desk then gets one fresh session, and a second ending asks a person.
- A desk that ended `holding-work` asks no person when its pull request has merged.

<!-- Board impact: none. The plan format, template and docs/plans layout do not change. A desk that gets the composed ending shows the `unreadable` reason the board already renders for an exit-non-zero desk; a merged `holding-work` desk shows no new state. -->

## Motivation

The spec's section *A dead or stuck desk* ([DESIGN-delivery-loop.md](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md), approved by jwloka on 2026-10-29) names two stops that wait for a person. The story's goal 1 is that only the release waits for a person.

**The measurement.** Round 2's measure juror (`.plot/panels/2026-10-29-a-dead-desk-gets-a-fixer/r2-measure.md`) joined `fresh-agents.tsv` (33 rows) with `ending-asks.tsv` (109 rows, one per `needs-a-person` ask with its `endingAt`) under the common git dir, over 2026-10-09 to 2026-10-28. 33 fresh sessions started, and the branch of every one of them had a pull request before the session started. 10 branches reached a second ending after their fresh session and asked a person: `blocked` 7, `checks-unanswered` 1, `unreadable` 1, `holding-work` 1. All 10 pull requests (#1959, #2356, #2358, #2367, #2464, #2468, #2591, #2711, #2737, #2752) merged later, each merged by jwloka. 0 of the 33 sessions and 0 of the 10 second endings were on a desk with no pull request.

**What the measurement removes.** Round 1 proposed two new `endingAction` verdicts: `restart` for a dead desk with no ending, and `start-fixer` for a desk with no pull request whose fresh session also ended. Both leave this plan. The fixer arm serves a desk with no pull request, and that population measured 0 of 33 and 0 of 10. The restart verdict needs a restart record, a refusal record, fleetd's typed caller from #2898 and a second route into `restartBranch`, for a population that also measured 0 on this machine. Round 2's seams juror found that neither verdict could fire as planned, because the tick does not deliver the readings they read (below). A desk with a pull request belongs to #2903's `feature/fleetd-starts-the-fixer`. The 7 `blocked` second endings are the fresh session asking a question, and that population is #2901's.

**The dead desk with no ending.** `endingAction` answers every manifest-less, plan-named desk on this machine (`freshAgentCandidateTrees`, `packages/fleet/src/server/entry/registryd.ts:660-663`). A worker that exits non-zero without an ending gets `unreadable` from `killedWorkerEnding` (`packages/domain/src/rules/ending-action.ts:632-635`), and the bound arm (`ending-action.ts:356-362`) gives it one fresh session. `killedWorkerEnding` answers `null` for an exit of 0 and for a missing exit record (`ending-action.ts:635`), so that desk keeps no ending, the table answers `leave` (`ending-action.ts:366`), and the desk waits for a person. The measure juror found 0 such desks among this machine's 30 worktrees and 178 branch-named endings, and names why the count is a floor: the desk writes no ending, so `endings.jsonl` cannot hold it, and a deleted branch with no reap pin leaves no trace.

**The tick reads `prOpen` and `commitBeyondClaim` only for a bound ending.** The reader asks the host and git for these two values only where `isBoundEnding(ending)` holds (`registryd.ts:912-913`), and `freshAgentDecisions` passes `commitBeyondClaim: 'no'` and `prOpen: false` for every other ending (`registryd.ts:1023-1024`). A desk with `ending: null` therefore reaches `endingAction` with `commitBeyondClaim: 'no'`, so a rule that reads "a commit beyond its claim" from the table never holds for it. This plan adds no table row for that desk. It composes the `unreadable` ending before the reader runs, so the reader then reads the desk as a bound ending and asks the real values.

**The merged pull request.** The `holding-work` arm (`ending-action.ts:349-352`) reads no `prMerged`. #2591 merged at 18:35:00Z, and its `holding-work` ask followed at 18:35:46Z, 46 s later. #2367 merged at 07:25Z; its `unreadable` ending is from 15:12Z and its ask from 18:29Z, about 11 h after the merge. Both asks were noise for a person.

**Siblings.** #2900 builds `deskDead` (`rules/desk-dead.ts`), the one reading for a dead desk; a desk with a `PLOT-BLOCKED` marker reads `waiting`, not dead. #2903 owns every fixer start on a desk with a pull request. #2901 answers an agent's own `PLOT-BLOCKED` question. #2899 owns the run log; this plan adds no step, because the fresh session it reaches already writes its own record.

## Design

### Approach

**Slice 1: the dead desk reads `unreadable`.** `killedWorkerEnding` gains a second arm. Today it composes `unreadable` for a desk with no ending file, a non-zero exit record and no live loop. The new arm composes the same `unreadable` ending, actor `supervisor`, for a desk where every reading holds:

- the ending file is absent (`read: 'absent'`); an unparseable ending, a person's `stopped` ending and every other written ending stay as they are;
- the exit record holds `0`, or there is no exit record;
- the desk is dead: `deskDead` answers `{ dead: true }`, so a live loop, a `PLOT-BLOCKED` marker (`waiting`), a desk on another machine (`elsewhere`) and a failed read (`unread`) compose nothing;
- the desk names a branch, and the desk is plan-named (`freshAgentCandidateTrees` already filters for this);
- `commitBeyondClaim` answers `yes` from `Trees.commitBeyondClaim`, the git read `registryd-main.ts:1800-1803` already makes; `no` and `unanswerable` compose nothing;
- the host's `prState` for the branch answers `null`, which means no pull request in any state; the same `hostShell(context).prState` read `registryd-main.ts:1804-1807` makes. An open, merged or closed pull request composes nothing, and a failed host call composes nothing.

**What this slice reads instead of the index.** The "no pull request" condition is the host's `prState` answer at the tick, never the PR index. The index can say a pull request merged, but it can never say that no pull request exists (*A Decision Reads The Index*). An absent row, an old index, a failed decode or a failed host call all compose no ending, and the desk keeps today's `leave`.

**The host is asked only where its answer can change the verdict.** `killedWorkerEndings` (`registryd.ts:794-809`) reads the ending file and the exit record first. It asks `deskDead`, then git, then the host, only for a desk with no ending file and an exit of 0 or no exit record, in that order, and stops at the first reading that composes nothing. `killedWorkerEndings` becomes async and takes these reads as ports. The non-zero arm reads exactly what it reads today.

**What the bound arm does next.** The tick writes the ending to the desk (`registryd-main.ts:1856-1863`) before `readFreshAgentCandidates` runs. The reader then sees a bound ending and asks `prMerged`, `commitBeyondClaim` and `prOpen` from the host and git (`registryd.ts:903-913`). The bound arm answers `start-fresh` for a slice with no fresh session yet, and `needs-a-person` after one (`ending-action.ts:361`). The fresh session's record in `fresh-agents.tsv` is the bound of one. No new verdict, record or route is built, and fleetd calls no `restart`, so this slice needs nothing from #2898.

**Slice 2: `holding-work` reads the merge.** The `holding-work` arm (`ending-action.ts:349-352`) answers `leave` where `prMerged` reads `merged`, after the take-up refusal check and before the `priorFreshSessions` answer. The reader asks `prMerged` for a `holding-work` ending too: the condition at `registryd.ts:903-906` adds `ending === 'holding-work'`. `prMerged: 'unanswerable'` takes the `not-merged` arm, as every other row does, so a failed host call still reaches a person.

**Vocabulary.** The code says Agent for the actor and Slice for a branch, and it adds nothing to the `Wave` defect. The ending is an agent fact read from the desk; the worker's exit stays a process fact.

### Decisions

Decided 2026-10-29 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-29-a-dead-desk-gets-a-fixer/panel.md`):

- [x] D2: every HIGH goes to a fixer, two attempts per pull request, then the ticket. A desk with a pull request belongs to #2903's PR loop. The desk loop is unchanged.
- [x] A person's stop stays a stop: a `stopped`, `spent` or `limited` ending is never overwritten and answers `leave` as today.
- [x] An `elsewhere` desk cannot reach either fix: the tick reads only this machine's worktrees (`registryd.ts:660-663`), and `deskDead` answers `elsewhere`.

Decided 2026-10-29 by Jan Wloka after panel round 2 (`r2-measure.md`, `r2-seams.md`), decision C4:

- [x] The plan shrinks to two fixes. The `restart` verdict and the no-PR `start-fixer` verdict leave the plan, because 0 of 33 fresh sessions and 0 of 10 second endings were on a desk with no pull request (2026-10-09 to 2026-10-28).
- [x] The dead desk reuses the existing bound arm through `killedWorkerEnding`. No new verdict, no restart record, and no wait on #2898.
- [x] "No pull request" is the host's `prState` answer, never the PR index.
- [x] The `holding-work` arm reads `prMerged`.
- [x] Round 1's open questions on the no-PR fixer (where it runs, whether `holding-work` gets it) and on the run log leave with the fixer. The second-ending count is measured above.

### Open Questions

- [ ] #2367's ask came from the bound arm, which already reads `prMerged` (`ending-action.ts:358`), 11 h after the merge. The records do not say what the host answered at that tick. Recommendation: slice 2's fleet test feeds the bound arm `prMerged: 'unanswerable'` and asserts the ask stands, because a failed read never points toward `leave`; a host that answered `not-merged` for a merged pull request is a host-adapter defect for its own issue.
- [ ] Slice 1 reads `deskDead`, which #2900's `feature/fleetd-reviews-slice-prs` builds, so slice 1 carries a `waits:` annotation the slice map does not list. Recommendation: keep the wait and record it in the slice map; the alternative is to read `loopAlive` and the marker directly, which defines a second copy of the dead-desk reading.

## Slices

### The dead desk reads unreadable

- `feature/a-dead-desk-reads-unreadable` — `killedWorkerEnding` composes `unreadable` for a desk with no ending file, an exit of 0 or no exit record, `deskDead` dead, `commitBeyondClaim` `yes` and the host's `prState` answering `null`; `killedWorkerEndings` asks `deskDead`, git and the host only for that desk and stops at the first reading that composes nothing; tests: domain unit rows in `rules-ending-action.test.ts` for exit 0 and an absent exit with each reading flipped, the existing rows that a `stopped` ending and an unparseable ending are never overwritten; fleet unit in `fresh-agent-tick.test.ts`: a dead desk with work and no PR gets the ending and `start-fresh` in one tick, a second ending after the fresh session asks a person, and a host answer of OPEN, MERGED or a failed call writes no ending <!-- builds: a second arm of killedWorkerEnding --> <!-- waits: feature/fleetd-reviews-slice-prs -->

### Holding-work reads the merge

- `feature/holding-work-reads-the-merge` — the `holding-work` arm answers `leave` where `prMerged` reads `merged`; the reader asks `prMerged` for `holding-work`; tests: domain unit rows for `holding-work` with `merged`, `not-merged` and `unanswerable` at `priorFreshSessions` 0 and 1, a fixture of the 10 measured second-ending readings asserting which answers change (#2591's only); fleet unit: a `holding-work` desk whose host answers merged writes no marker <!-- builds: a prMerged read on the holding-work arm -->

## Notes

- Raised from issue #2906. The issue is the problem statement; the spec binds the design, and the decisions above correct it where they differ.
- The two slices change `ending-action.ts`, `rules-ending-action.test.ts`, `registryd.ts` and `fresh-agent-tick.test.ts`, so they run in sequence.
- Neither slice changes the contract `fresh-agent-tick.test.ts:410` pins: a second fresh-session ending on a desk whose pull request has not merged still answers `needs-a-person` with a marker.
- Owned elsewhere and not built here: `deskDead` (#2900, `feature/fleetd-reviews-slice-prs`); every fixer start on a desk with a pull request (#2903, `feature/fleetd-starts-the-fixer`); answering an agent's own question (#2901, `feature/fleetd-answers-a-question`); the run log (#2899, `feature/the-loop-keeps-a-run-log`).
