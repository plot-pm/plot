# A dead desk gets a fixer or a restart

> `endingAction` gains two answers: `restart` for a dead desk that wrote no ending, and `start-fixer` for a desk with no pull request whose fresh session also ended. fleetd applies both in its tick, so neither desk waits for a person.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #2906
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- fleetd restarts a desk whose worker exited without an ending, whose branch holds a commit beyond its claim and has no pull request. It restarts one slice once; a second death asks a person. A desk that a person stopped stays stopped.
- When a desk with no pull request ends a second time after its fresh session, fleetd starts the fixer role on its branch, up to two attempts, instead of asking a person.
- When a desk with a pull request ends a second time after its fresh session, fleetd writes no `PLOT-BLOCKED` marker. The pull request's own loop starts the fixer.

<!-- Board impact: none. The plan format, template and docs/plans layout do not change. A restarted desk shows its worker as `running` and a fixer run shows through the role-run liveness reading that #2898 builds; this plan adds no row state. -->

## Motivation

The spec's section *A dead or stuck desk* ([DESIGN-delivery-loop.md](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md), approved by jwloka on 2026-10-29) names two stops that still wait for a person. The story's goal 1 is that only the release waits for a person.

**The second failure.** `rules/fresh-agent.ts` decides nothing: `freshAgentAnswer` (`fresh-agent.ts:52`) only composes the fresh session's prompt, and `ports/fresh-agent-record.ts:4-18` records a start, never an outcome. The decision is `endingTableAnswer` in `packages/domain/src/rules/ending-action.ts:347-370`. It answers `priorFreshSessions > 0 ? 'needs-a-person' : 'start-fresh'` at `:351`, `:354` and `:361`. "The fresh session failed" is therefore derived: a new ending on a slice with `priorFreshSessions > 0`. Six endings reach that arm: `corrections-spent` and `turn-limit` (`FRESH_SESSION_ENDINGS`, `:162`), an after-prompt `holding-work`, and `bound`, `unreadable` and `quiet` with work on the branch. fleetd applies the verdict in `freshAgentDecisions` (`packages/fleet/src/server/entry/registryd.ts:1011`) and `applyFreshAgentDecisions` (`registryd.ts:1139`). The `needs-a-person` arm (`registryd.ts:1177-1178`) calls `askAPerson` (`registryd.ts:1208`), which writes a `PLOT-BLOCKED.md` marker (`registryd.ts:1216`).

**The dead desk.** `endingAction` already answers every manifest-less, plan-named desk on this machine (`freshAgentCandidateTrees`, `registryd.ts:660-663`): `release-claim`, `start-fresh`, `needs-a-person` or `leave`. A worker that exits non-zero without an ending gets `unreadable` from `killedWorkerEnding` (`ending-action.ts:632`), so that desk is already in the table. What falls through is a desk with no ending at all: a worker that exited 0 without one, or never left an exit record. The table answers `leave` for it (`ending-action.ts:366`), and that desk waits for a person. `restartWorker` refuses every unattended caller (`packages/domain/src/workflows/dispatch-verbs.ts:194`). `workflows/dispatch.ts:42` is only the comment on the `'unattended'` refusal member. Three entries read `PLOT_UNATTENDED` into that reading: `packages/board/src/server/restart.ts:68`, `packages/fleet/src/server/entry/restart-command.ts:89` and `restart-stopped-command.ts:103`.

**Why two parallel rules fail.** The panel ran the real `endingAction`, `restartWorker` and `restartOffered` on dead-desk readings. A separate restart rule beside `endingAction` answers `restart` for desks the table answers `release-claim` or `start-fresh` for, so one tick can release a claim and restart the branch, or start two writers on one branch. It also restarts a desk that a person stopped: a worker stopped with exit 143 and no PR reads `failed`, the `stopped` ending answers `leave`, and `restartWorker` with the refusal lifted answers `worker-start`. And it restarts the six `NEEDS_PERSON_ENDINGS` (`ending-action.ts:217-224`) every tick, bounded only by `Slice max runs` (12, `packages/domain/src/rules/run-limit.ts:13`). Both answers therefore become rows of `endingAction`.

**What the endings on this machine show.** `.plot/state/endings.jsonl` in this repository holds 209 endings, measured 2026-10-29: `checks-unanswered` 70, `blocked` 36, `unstarted` 6 (112 that ask a person outright); `unreadable` 31, `corrections-spent` 15, `holding-work` 12, `quiet` 8 (66 that earn a fresh session first); `unregistered` 31. The file records no date and no prior-session count, so the number that reached a second fresh session is not measured. The fixer arm reaches only part of the 66; the 112 outright endings stay with a person.

**Siblings.** This plan reads #2898 (the `caller` reading that `restart` accepts from fleetd, the `fixer` role and its detached start) and #2903 (the fixer attempts record, the fixer start on a desk with a pull request, and the continue lock that start takes). #2901 answers `PLOT-BLOCKED` questions and skips fleet-written markers, so the markers this plan still writes are not answered by the unblocker. #2899 builds the run log and the idle-slice notification.

## Design

### Approach

**One table.** Both answers are new verdicts of `endingAction` (`ending-action.ts:154`, `EndingActionVerdict`), so one rule answers each dead desk once. A `rules-ending-action.test.ts` property test over ending × `priorFreshSessions` × fixer attempts × restarts × PR × marker × worker state asserts exactly one verdict per reading, and asserts that no `NEEDS_PERSON_ENDINGS` row and no `stopped`, `spent` or `limited` row answers `restart` or `start-fixer`. The tick in `packages/fleet` reads the records and calls the controllers. The rules stay pure and read values; no new shell, so the line ratchet in `scripts/check-shell-lines.sh` holds.

**The `restart` arm.** It replaces the `leave` answer for a desk with no ending (`ending-action.ts:366`). It answers `restart` only where every reading holds:

- no ending is recorded, and `killedWorkerEnding` wrote none;
- no manifest names the desk (`hasManifest` false) and no loop is alive;
- the worker reads `failed`, `ended` or `none`; `stalled` stays with a person, because its tree holds uncommitted or unpushed work;
- the newest claim commit is older than `ORPHANED_CLAIM_AGE_MS` (60 s, `packages/domain/src/rules/claim.ts:77`), the launch-window bound `deadClaim` already uses;
- the branch holds a commit beyond its claim; a branch with only claim commits is a dead claim (`rules/dead-claim.ts:31`), and the release wins;
- the PR index holds no OPEN or MERGED row for the branch, and no `PLOT-BLOCKED` marker is on the desk;
- fewer restarts than the bound (one per slice) are recorded, and no earlier restart of this slice was refused.

A desk past the restart bound answers `needs-a-person`, and the marker names the restart that also died. fleetd calls `restartBranch` in process (`packages/fleet/src/shared/restart-command.ts:114`) with its typed caller from #2898, not the board's HTTP route. `restartBranch` re-asks the host for the PR state (`restart-command.ts:67`) and starts through `continueOnDesk`, which takes the desk's continue lock (`packages/fleet/src/shared/continuation.ts:857`). A refused restart (`reached-review`, `pr-unanswerable`, `loop-alive`) is recorded, so the next tick asks the host nothing for that slice until a person or a new ending clears it. The restart record is appended before the start, and a failed append starts nothing. fleetd's restart passes its own prompt; `RESTART_ANSWER` (`restart-command.ts:19-20`) says "A person restarted this worker" and stays the text for a person's restart.

**The `start-fixer` arm.** It replaces the `needs-a-person` answer at `:351`, `:354` and `:361` for a desk with no pull request. For a desk with an open pull request, the same arms answer `leave` and write no marker; #2903's PR loop starts that fixer. The arm answers `start-fixer` where the desk has no OPEN or MERGED row, `priorFreshSessions > 0`, and fewer than two fixer attempts are recorded for the plan and branch. At two attempts it answers `needs-a-person`, and the marker names both attempts. fleetd starts the fixer through the role start that #2903's `feature/fleetd-starts-the-fixer` uses, under the same per-desk continue lock, so a person's `restart`, this plan's restart, or #2901's unblocker cannot start a second writer. The attempt is appended before the start to the record #2903's `feature/the-fixer-attempts-record` creates, keyed by plan and branch for a desk with no pull request; a failed append starts nothing, as `beforeStart` does for the fresh session (`registryd.ts:1151`).

**A red build after the attempts.** A failed fresh session is a red build, not a HIGH finding. After both fixer attempts, a red build holds and notifies; it never takes the merge arm. For a desk with a pull request that rule is #2903's and #2902's; for a desk with no pull request there is nothing to merge.

**Vocabulary.** The code says Agent for the actor and Slice for a branch. It adds nothing to the `Wave` defect. The verdicts are agent facts read from the desk; the worker states stay process facts.

### Decisions

Decided 2026-10-29 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-29-a-dead-desk-gets-a-fixer/panel.md`):

- [x] D1: `restart` keeps refusing every unattended caller (`dispatch-verbs.ts:194`). The caller is a typed domain reading built by #2898's `feature/unattended-callers-are-refused`, and fleetd's in-process caller is accepted by `restart`. This plan builds no lift; it calls `restartBranch` with fleetd's caller.
- [x] D2: every HIGH goes to a fixer, two attempts per PR, then the ticket. A desk with a pull request belongs to #2903's PR loop; this plan's fixer covers only a desk with no pull request, keyed by plan and branch, with the same two attempts. The desk loop is unchanged.
- [x] D5: the `fixer` role is `.claude/agents/fixer.md` loaded from the default branch's copy through `--agents <file>`, with its per-role settings file, both built by #2898. fleetd creates any worktree itself and does not rely on `isolation` in frontmatter.
- [x] Both answers are verdicts of `endingAction`, not rules beside it, with one exhaustive table and one property test.
- [x] A restart is not a fixer attempt. Restarts carry their own record and a bound of one per slice.
- [x] The restart's launch-window bound is `ORPHANED_CLAIM_AGE_MS` with the `hasManifest` reading. `Claim stale after` (24 h) is read only by `skills/plot/scripts/plot-reconcile-scan.sh:374` and is not used.
- [x] An `elsewhere` desk cannot reach either arm: the tick reads only this machine's worktrees (`registryd.ts:660-663`).
- [x] `restart` never follows a person's stop: a `stopped`, `spent` or `limited` ending answers `leave` as today.

### Open Questions

- [ ] Does an after-prompt `holding-work` desk with no pull request get the fixer? Its work is uncommitted in the desk's tree, which a fixer in another worktree cannot read. Recommendation: no; it keeps `needs-a-person`.
- [ ] Where does the fixer run on a desk with no pull request? The desk's worktree has the branch checked out, so `git worktree add` refuses a second checkout. Recommendation: the fixer runs in the desk's worktree under the continue lock, so `restartWorker` and `plot-reap.sh` read the desk as held.
- [ ] Do the restart and the fixer start write a line to #2899's run log (`feature/the-loop-keeps-a-run-log`), and does slice 2 wait for it? #2899's idle-slice rule reads only open slice PRs, so a no-PR desk is invisible to it either way.
- [ ] How many desks reach a second fresh-session ending? `endings.jsonl` carries no date and no prior-session count. Count them from `fresh-agents.tsv` joined with the endings before slice 2 starts.

## Slices

### Dead-desk restart

- `feature/ending-action-restarts-a-desk` — `restart` as an `endingAction` answer for a desk with no ending, no manifest, a commit beyond its claim and no pull request; never after a person's stop or a `NEEDS_PERSON_ENDINGS` ending; a restart record with a bound of one, appended before the start; recorded refusals; fleetd calls `restartBranch` in process with its own prompt <!-- builds: a restart verdict in endingAction, a per-slice restart record --> <!-- waits: feature/unattended-callers-are-refused -->

### No-PR desk fixer

- `feature/ending-action-starts-a-fixer` — `start-fixer` as an `endingAction` answer for a dead desk with no pull request whose fresh session also ended, keyed by plan and branch, two attempts, appended before the start, under the continue lock; a desk with a pull request answers `leave` with no marker and goes to #2903 <!-- builds: a start-fixer verdict in endingAction --> <!-- waits: feature/fleetd-starts-the-fixer -->

## Notes

- Raised from issue #2906. The issue is the problem statement; the spec binds the design, and the decisions above correct it where they differ.
- The two slices change `ending-action.ts`, `rules-ending-action.test.ts`, `registryd.ts` and `fresh-agent-tick.test.ts`, so they run in sequence. Slice 2 changes the contract `fresh-agent-tick.test.ts:410` pins: the second reach of the six endings no longer answers `needs-a-person` with a marker where the desk has no pull request or has one.
- Slice 1 calls `restartBranch` with fleetd's typed caller, which #2898's `feature/unattended-callers-are-refused` builds. The slice map gives slice 1 no `waits:` annotation; until that branch merges, fleetd's restart is refused `unattended`.
- Owned elsewhere and not built here: the `caller` reading and the refusals (#2898, `feature/unattended-callers-are-refused`); `fixer.md` and its settings (#2898, `feature/role-agent-definitions`); the detached role start (#2898, `feature/role-agents-start-detached`); the fixer attempts record (#2903, `feature/the-fixer-attempts-record`); the fixer start on a desk with a pull request (#2903, `feature/fleetd-starts-the-fixer`); the run log (#2899, `feature/the-loop-keeps-a-run-log`); answering an agent's own question (#2901, `feature/fleetd-answers-a-question`).
