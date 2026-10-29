# A dead desk reads unreadable, and a merged PR asks no one

> Two fixes to the ending table. A dead plan-named desk that the fleet launched, with work beyond its claim, no pull request and no ending, gets the `unreadable` ending, so the existing bound arm starts one fresh session and then asks a person. A worktree a person cut by hand carries no launch record and is never touched. The `holding-work` arm reads `prMerged` and asks no person after the pull request merged and the desk holds no uncommitted file.

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

- fleetd writes an `unreadable` ending for a dead desk that carries the fleet's launch record (`.plot-worker.pid`), whose worker exited 0 or left no exit record, whose branch holds a commit beyond its claim, and for which the host answers that no pull request exists. The desk then gets one fresh session, and a second ending asks a person. A worktree with no launch record gets no ending.
- A desk that ended `holding-work` asks no person when its pull request has merged and the desk holds no uncommitted file.

<!-- Board impact: none. The plan format, template and docs/plans layout do not change. A desk that gets the composed ending shows the `unreadable` reason the board already renders for an exit-non-zero desk; a merged `holding-work` desk shows no new state. -->

## Motivation

The spec's section *A dead or stuck desk* ([DESIGN-delivery-loop.md](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md), approved by jwloka on 2026-10-29) names two stops that wait for a person. The story's goal 1 is that only the release waits for a person.

**The measurement.** Round 2's measure juror (`.plot/panels/2026-10-29-a-dead-desk-gets-a-fixer/r2-measure.md`) joined `fresh-agents.tsv` (33 rows) with `ending-asks.tsv` (109 rows, one per `needs-a-person` ask with its `endingAt`) under the common git dir, over 2026-10-09 to 2026-10-28. 33 fresh sessions started, and the branch of every one of them had a pull request before the session started. 10 branches reached a second ending after their fresh session and asked a person: `blocked` 7, `checks-unanswered` 1, `unreadable` 1, `holding-work` 1. All 10 pull requests (#1959, #2356, #2358, #2367, #2464, #2468, #2591, #2711, #2737, #2752) merged later, each merged by jwloka. 0 of the 33 sessions and 0 of the 10 second endings were on a desk with no pull request.

**What the measurement removes.** Round 1 proposed two new `endingAction` verdicts: `restart` for a dead desk with no ending, and `start-fixer` for a desk with no pull request whose fresh session also ended. Both leave this plan. The fixer arm serves a desk with no pull request, and that population measured 0 of 33 and 0 of 10. The restart verdict needs a restart record, a refusal record, fleetd's typed caller from #2898 and a second route into `restartBranch`, for a population that also measured 0 on this machine. Round 2's seams juror found that neither verdict could fire as planned, because the tick does not deliver the readings they read (below). A desk with a pull request belongs to #2903's `feature/fleetd-starts-the-fixer`. The 7 `blocked` second endings are the fresh session asking a question, and that population is #2901's.

**The dead desk with no ending.** `endingAction` answers every manifest-less, plan-named desk on this machine (`freshAgentCandidateTrees`, `packages/fleet/src/server/entry/registryd.ts:660-663`). A worker that exits non-zero without an ending gets `unreadable` from `killedWorkerEnding` (`packages/domain/src/rules/ending-action.ts:632-635`), and the bound arm (`ending-action.ts:356-362`) gives it one fresh session. `killedWorkerEnding` answers `null` for an exit of 0 and for a missing exit record (`ending-action.ts:635`), so that desk keeps no ending, the table answers `leave` (`ending-action.ts:366`), and the desk waits for a person. The measure juror found 0 such desks among this machine's 30 worktrees and 178 branch-named endings, and names why the count is a floor: the desk writes no ending, so `endings.jsonl` cannot hold it, and a deleted branch with no reap pin leaves no trace.

**A hand-cut worktree is not a dead desk.** `killedWorkerEnding` refuses a desk with no exit record on purpose: *"A desk with no exit record was never run by a worker, for example a desk a person cut by hand"* (`ending-action.ts:622-623`). A worktree that a person or the master session cuts on a slice branch is plan-named (`registryd-main.ts:639`), has no manifest, no ending, no exit record and no loop, and `commitBeyondClaim` counts its real commits. Without a further reading it passes every condition, and fleetd starts a second writer in that person's folder. The reading that tells the two apart is the fleet's launch record `.plot-worker.pid`. Only a fleet launch writes it: the dispatch wrapper writes the agent's pid to `PLOT_PID_FILE` (`skills/plot/scripts/plot-dispatch.sh:1503-1507`), a continuation writes it after its spawn (`packages/fleet/src/shared/continuation.ts:1407`), and a hop moves it to the new desk (`packages/domain/src/adapters/desk/desk-fs.ts:42`). Git never carries it into a new worktree, because `.gitignore:63` ignores it. The reap already reads the same file as its proof of a dispatch tree (`packages/board/src/server/entry/reap.ts:870-871`).

**The tick reads `prOpen` and `commitBeyondClaim` only for a bound ending.** The reader asks the host and git for these two values only where `isBoundEnding(ending)` holds (`registryd.ts:912-913`), and `freshAgentDecisions` passes `commitBeyondClaim: 'no'` and `prOpen: false` for every other ending (`registryd.ts:1023-1024`). A desk with `ending: null` therefore reaches `endingAction` with `commitBeyondClaim: 'no'`, so a rule that reads "a commit beyond its claim" from the table never holds for it. This plan adds no table row for that desk. It composes the `unreadable` ending before the reader runs, so the reader then reads the desk as a bound ending and asks the real values.

**The merged pull request.** The `holding-work` arm (`ending-action.ts:349-352`) reads no `prMerged`. #2591 merged at 18:35:00Z, and its `holding-work` ask followed at 18:35:46Z, 46 s later. #2367 merged at 07:25Z; its `unreadable` ending is from 15:12Z and its ask from 18:29Z, about 11 h after the merge. Both asks were noise for a person.

**Siblings.** #2900 builds `deskDead` (`rules/desk-dead.ts`), the one reading for a dead desk; a desk with a `PLOT-BLOCKED` marker reads `waiting`, not dead. #2903 owns every fixer start on a desk with a pull request. #2901 answers an agent's own `PLOT-BLOCKED` question. #2899 owns the run log; this plan adds no step, because the fresh session it reaches already writes its own record.

## Design

### Approach

**Slice 1: the dead desk reads `unreadable`.** `killedWorkerEnding` gains a second arm. Today it composes `unreadable` for a desk with no ending file, a non-zero exit record and no live loop. The new arm composes the same `unreadable` ending, actor `supervisor`, for a desk where every reading holds:

- the desk carries the fleet's launch record: `.plot-worker.pid` is present and holds a positive integer, read through the same `deskFile` port `killedWorkerEndings` already takes (`registryd.ts:794-809`). A desk without it composes nothing, whatever every other reading says, and the tick asks no git and no host question about it. A worktree a person or the master session cut by hand on a slice branch is therefore never touched;
- the ending file is absent (`read: 'absent'`); an unparseable ending, a person's `stopped` ending and every other written ending stay as they are;
- the exit record holds `0`, or there is no exit record. The launch record is what makes "no exit record" safe: with it, the record's absence means the wrapper died with the agent (a group kill or a reboot), and not that no worker ever ran;
- the desk is dead: `deskDead` answers `{ dead: true }`, so a live loop, a `PLOT-BLOCKED` marker (`waiting`), a desk on another machine (`elsewhere`) and a failed read (`unread`) compose nothing;
- the desk names a branch, and the desk is plan-named (`freshAgentCandidateTrees` already filters for this);
- `commitBeyondClaim` answers `yes` from `Trees.commitBeyondClaim`, the git read `registryd-main.ts:1800-1803` already makes; `no` and `unanswerable` compose nothing;
- the host's `prState` for the branch answers `null`, which means no pull request in any state; the same `hostShell(context).prState` read `registryd-main.ts:1804-1807` makes. An open, merged or closed pull request composes nothing, and a failed host call composes nothing.

**The ending's text names what the tick read.** The existing arm's `detail` says `the worker exited ${code} and wrote no ending` (`ending-action.ts:640`), which reads as a crash and names a code the new arm may not have. The new arm writes `the worker exited 0 and wrote no ending; its branch holds work and no pull request` for an exit of 0, and `the worker left no exit record and no ending; its branch holds work and no pull request` for a missing record. The tick log and the ask marker show this text.

**The launch record does not cover a person who works in a fleet desk.** A person or the master session that takes over a desk the fleet launched, after its worker died, works in a folder that carries `.plot-worker.pid`. The existing non-zero arm has the same exposure today. `deskDead` and the `PLOT-BLOCKED` marker are the readings that hold that desk back; a person who takes over a desk writes a marker or stops it with `--stop`, which writes a `stopped` ending.

**What this slice reads instead of the index.** The "no pull request" condition is the host's `prState` answer at the tick, never the PR index. The index can say a pull request merged, but it can never say that no pull request exists (*A Decision Reads The Index*). An absent row, an old index, a failed decode or a failed host call all compose no ending, and the desk keeps today's `leave`.

**The host is asked only where its answer can change the verdict.** `killedWorkerEndings` (`registryd.ts:794-809`) reads the ending file, the exit record and the launch record first. It asks `deskDead`, then git, then the host, only for a desk with a launch record, no ending file and an exit of 0 or no exit record, in that order, and stops at the first reading that composes nothing. `killedWorkerEndings` becomes async and takes these reads as ports. The non-zero arm reads exactly what it reads today.

**A pull request that exists is asked about once.** Once a branch has a pull request in any state, `prState` never answers `null` for it again, so "a pull request exists" is a terminal answer for this arm. fleetd keeps an in-process set keyed by the worktree path and the text of its `.plot-worker.pid`. A host answer of OPEN, MERGED or CLOSED adds the key, and the tick asks the host no more for that key. A new launch writes a new pid, which makes a new key. A failed host call adds nothing, so the next tick asks again. A fleetd restart empties the set and asks once per desk. A `MERGED` row in the PR index also answers that a pull request exists, with no host call; the index is never read as "no pull request".

**What the bound arm does next.** The tick writes the ending to the desk (`registryd-main.ts:1856-1863`) before `readFreshAgentCandidates` runs. The reader then sees a bound ending and asks `prMerged`, `commitBeyondClaim` and `prOpen` from the host and git (`registryd.ts:903-913`). The bound arm answers `start-fresh` for a slice with no fresh session yet, and `needs-a-person` after one (`ending-action.ts:361`). The fresh session's record in `fresh-agents.tsv` is the bound of one. No new verdict, record or route is built, and fleetd calls no `restart`, so this slice needs nothing from #2898.

**Slice 2: `holding-work` reads the merge.** The `holding-work` arm (`ending-action.ts:349-352`) answers `leave` where `prMerged` reads `merged` and `dirtyTree` reads `no`, after the take-up refusal check and before the `priorFreshSessions` answer. A `holding-work` ending says the desk holds work, and a merged pull request does not prove that work landed: the agent can edit after the merge. So a desk whose held files are not empty, or whose held-files read failed, keeps today's answer, a fresh session or a person. The reader asks `prMerged` for a `holding-work` ending too: the condition at `registryd.ts:903-906` adds `ending === 'holding-work'`. The tick already reads `heldFiles` for every candidate (`registryd.ts:907`), and `freshAgentDecisions` passes `dirtyTreeReading(reading.heldFiles)` for a `holding-work` ending as well as a bound one (`registryd.ts:1025`); `dirtyTreeReading` answers `yes` for a failed read (`registryd.ts:811-823`). `prMerged: 'unanswerable'` takes the `not-merged` arm, as every other row does, so a failed host call still reaches a person.

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

Decided after the plot-review of PR #2915, 2026-10-29 (#2925):

- [x] Slice 1 acts only on a desk the fleet launched. It composes nothing for a desk without `.plot-worker.pid`, the record only a fleet launch writes (`plot-dispatch.sh:1503-1507`, `continuation.ts:1407`) and git never carries (`.gitignore:63`). A hand-cut worktree on a slice branch is never touched, and a test proves it.
- [x] Slice 2 answers `leave` for a merged `holding-work` desk only where its held files read empty; a desk with held files, or a failed read, keeps today's answer.
- [x] Slice 1 asks the host about a branch once a pull request exists for it no more, keyed by worktree and pid record, in fleetd's memory.
- [x] The composed ending's `detail` names an exit of 0 or a missing exit record, and never a crash code it did not read.

### Open Questions

- [ ] #2367's ask came from the bound arm, which already reads `prMerged` (`ending-action.ts:358`), 11 h after the merge. The records do not say what the host answered at that tick. Recommendation: slice 2's fleet test feeds the bound arm `prMerged: 'unanswerable'` and asserts the ask stands, because a failed read never points toward `leave`; a host that answered `not-merged` for a merged pull request is a host-adapter defect for its own issue.
- [ ] Slice 1 reads `deskDead`, which #2900's `feature/fleetd-reviews-slice-prs` builds, so slice 1 carries a `waits:` annotation the slice map does not list. Recommendation: keep the wait and record it in the slice map; the alternative is to read `loopAlive` and the marker directly, which defines a second copy of the dead-desk reading.

## Slices

### The dead desk reads unreadable

- `feature/a-dead-desk-reads-unreadable` — `killedWorkerEnding` composes `unreadable` for a desk with a `.plot-worker.pid` launch record, no ending file, an exit of 0 or no exit record, `deskDead` dead, `commitBeyondClaim` `yes` and the host's `prState` answering `null`, with a `detail` that names the exit 0 or the missing record; `killedWorkerEndings` reads the launch record first and asks `deskDead`, git and the host only for that desk, stops at the first reading that composes nothing, and asks the host no more for a worktree and pid record whose branch has a pull request; tests: domain unit rows in `rules-ending-action.test.ts` for exit 0 and an absent exit with each reading flipped, a row with every other reading set to compose and no launch record that answers `null`, the existing rows that a `stopped` ending and an unparseable ending are never overwritten; fleet unit in `fresh-agent-tick.test.ts`: a hand-cut worktree on a plan-named slice branch with commits beyond its claim, no `.plot-worker.*` file, no exit record and no pull request gets no ending, no fresh session, verdict `leave`, and no `deskDead`, git or host call; a dead desk with a launch record, work and no PR gets the ending and `start-fresh` in one tick; a second ending after the fresh session asks a person; a host answer of OPEN, MERGED or a failed call writes no ending; an OPEN answer is asked once across two ticks and a failed call is asked again <!-- builds: a second arm of killedWorkerEnding --> <!-- waits: feature/fleetd-reviews-slice-prs -->

### Holding-work reads the merge

- `feature/holding-work-reads-the-merge` — the `holding-work` arm answers `leave` where `prMerged` reads `merged` and `dirtyTree` reads `no`; the reader asks `prMerged` for `holding-work`, and `freshAgentDecisions` passes the held-files reading for `holding-work`; tests: domain unit rows for `holding-work` with `merged`, `not-merged` and `unanswerable` at `priorFreshSessions` 0 and 1, each with `dirtyTree` `no` and `yes`, a fixture of the 10 measured second-ending readings asserting which answers change (#2591's only, where its held files read empty); fleet unit: a `holding-work` desk whose host answers merged and whose tree is clean writes no marker, and the same desk with a held file or a failed held-files read keeps today's answer <!-- builds: a prMerged read on the holding-work arm -->

## Notes

- Raised from issue #2906. The issue is the problem statement; the spec binds the design, and the decisions above correct it where they differ.
- The two slices change `ending-action.ts`, `rules-ending-action.test.ts`, `registryd.ts` and `fresh-agent-tick.test.ts`, so they run in sequence.
- Neither slice changes the contract `fresh-agent-tick.test.ts:410` pins: a second fresh-session ending on a desk whose pull request has not merged still answers `needs-a-person` with a marker.
- The file name and slug `a-dead-desk-gets-a-fixer` no longer match the title, because the fixer left the plan in round 2 (#2925, LOW). The plan keeps them: a rename moves the `active/` link, the idea branch and PR #2915, and that change is larger than this fix.
- #2591's held files at its merge are not in the records, so the fixture's answer for it assumes a clean tree; the slice's fleet test, not the fixture, proves the held-files guard.
- Owned elsewhere and not built here: `deskDead` (#2900, `feature/fleetd-reviews-slice-prs`); every fixer start on a desk with a pull request (#2903, `feature/fleetd-starts-the-fixer`); answering an agent's own question (#2901, `feature/fleetd-answers-a-question`); the run log (#2899, `feature/the-loop-keeps-a-run-log`).
