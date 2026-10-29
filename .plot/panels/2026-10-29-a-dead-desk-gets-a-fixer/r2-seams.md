# Juror verdict: seams (round 2)

Position: amend

Evidence: Read the amended plan (worktree at `a955a0a28`), round 1's `panel.md` and `seams.md`, `loop-decisions.md`, and the Design and Slices sections of #2903, #2901, #2898 and #2899 (plus grep of #2900 and #2902). Read `packages/domain/src/rules/ending-action.ts` (table, `killedWorkerEnding`), `rules/dead-claim.ts`, `rules/claim.ts:77`, `workflows/agent-loop.ts:500-510,815-845`, `workflows/dispatch-verbs.ts:190-200`, `workflows/dispatch.ts:40-44`, `fleet/src/server/entry/registryd.ts:640-1230,1264-1500`, `registryd-main.ts:1835-1880,1957-1965,2000-2035`, `fleet/src/shared/restart-command.ts`, `shared/continue-lock.ts`, `shared/continuation.ts:850-870`, `fleet/test/unit/fresh-agent-tick.test.ts:400-420`, and the three restart entrances. Ran three esbuild-bundled probes under Node 24 from `juror-r2-2906-seams/` against the worktree's real sources: (1) `endingAction` over the plan's target readings; (2) `freshAgentDecisions` and `nothingDoneDecisions` with an esbuild plugin that wraps `endingAction` and records the readings the tick actually passes in; (3) marker handling on a second fresh-session ending. Also counted `.git/.plot/state/fresh-agents.tsv` joined with `ending-asks.tsv` on this machine and ran ten read-only `gh pr list --head` calls. Nothing was written to the worktree except this file.

## Executed results

- P1: `endingAction` with no ending, `commitBeyondClaim: 'yes'`, no PR, no marker answers `leave`; with `prOpen: true` also `leave`. This is the row the restart arm replaces (`ending-action.ts:366`).
- P2: all six fresh-session endings with `priorFreshSessions: 1` answer `needs-a-person` with `prOpen` false and true alike. Today the table does not read `prOpen` for them.
- P3: `stopped`, `spent`, `limited` and `unregistered` answer `leave`.
- **P4 (probe 2, the main finding):** the tick read `prOpen: true` and `commitBeyondClaim: 'yes'`. For `ending: null`, `corrections-spent`, `turn-limit` and `holding-work`, `endingAction` received `prOpen: false`, `commitBeyondClaim: 'no'`, `blockedMarker: false`. Only `bound` received the real values. The cause is `registryd.ts:1023-1024` (`commitBeyondClaim: bound ? … : 'no'`, `prOpen: bound ? … : false`). Before that, `readFreshAgentCandidates` asks the host and git only for bound endings (`registryd.ts:912-913` in the reader, `isBoundEnding(ending) && !endingAsked ? … : 'unanswerable'`).
- P4b: the nothing-done step calls `endingAction` a second time for the same desk in the same tick. It passes `prOpen` and `commitBeyondClaim` as `'unanswerable'`, `blockedMarker: false` and the real `priorFreshSessions` (`registryd.ts:1402-1431`). Its applier acts on `release-claim` only (`registryd.ts:1469`).
- P6: with `blockedMarker: true` and `priorFreshSessions: 1`, `corrections-spent`, `turn-limit` and `holding-work` still answer `needs-a-person`. Only `bound` answers `leave`. The table does not read the marker for those three (`ending-action.ts:349-355`).
- P7: on a second `corrections-spent` with the loop's marker already on the desk, `freshAgentDecisions` gives `escalate: false`. `askAPerson` writes no new marker (`registryd.ts:1213-1218`).
- P5: `CONTINUE_LOCK_BOUND_MS` = 60000. `continue-lock.ts` states that `continueOnDesk` "holds the lock only across one `await`-chain inside one request".
- Count: 33 slices on this machine have a fresh-session row. For 10 of them, an ask was recorded with an ending time later than the fresh session's start. All 10 branches now carry a MERGED PR (`gh`, read-only).

## (a) Did the amendment fold round 1 correctly?

Folded correctly:
- The plan names the right rule (`ending-action.ts:347-370`), the applier and the marker writer.
- Both answers are now verdicts of `endingAction`.
- The restart reads the ending, has a bound of one, and records refusals.
- A person's stop is left alone.
- The PR desk is handed to #2903.
- D1 attribution goes to #2898. The `ORPHANED_CLAIM_AGE_MS` bound is used. `restartBranch` is the route, with fleetd's own prompt.
- The red-build hold is fixed, and #2901 and #2899 are named.

Dropped or wrong:
1. **The disjointness with #2903 rests on a reading the tick does not deliver (P4).** The plan splits the second reach into `start-fixer` (no PR) and `leave` (PR, #2903's arm). For `corrections-spent`, `turn-limit` and after-prompt `holding-work`, `endingAction` sees `prOpen: false` whatever the host says. If slice 2 changes only the table, every PR desk among those three answers `start-fixer`. #2903's arm 2 ("CI red, desk dead or corrections spent") then fires on the same desk in the same tick, which gives two fixers on one branch. The same fault makes the restart arm dead code: `ending: null` reaches the table with `commitBeyondClaim: 'no'`, so "a commit beyond its claim" never holds. Neither slice names the reader change (`registryd.ts` reader and `:1023-1024`) or a test that the real readings arrive.
2. **"Under the same per-desk continue lock" does not hold a running fixer (P5).** The lock serializes a start and expires after 60 s. It is not held for the run. The `start-fixer` readings list has no "no fixer in flight" condition. #2903 has one (its arm 3, and an in-flight mark in its record). At the 60 s tick, tick 2 sees attempts = 1 < 2 with the same ending and starts attempt 2 while attempt 1 still runs. Open question 2's claim that the lock makes `restartWorker` and `plot-reap.sh` "read the desk as held" fails for the same reason. A person's `restart` reads the desk loop (`restart-command.ts:128-132`), not a role run, so it starts a second writer beside a running fixer.
3. **The #2901 seam is stated for markers this plan writes, and not for markers already on the desk (P6, P7).** `turn-limit` is decided before the loop's row 10 "agent wrote its own marker" (`agent-loop.ts:822` before `:838`). So a `turn-limit` ending can carry an agent-authored question. On the second reach without a PR, the plan answers `start-fixer`. In the same tick, #2901's `unblockerDue` answers `start`: it is the agent's own question, no loop is live, and no fixer is live yet. That gives two writers, and no rule states precedence. `corrections-spent` always carries a loop-written marker (`agent-loop.ts:504-508`). The `start-fixer` arm leaves that marker on the desk. Then "at two attempts … the marker names both attempts" cannot happen: `escalate` is false while a marker exists (P7), so no new text is written.
4. **The internal contradiction on slice 1's wait.** The slice line carries `<!-- waits: feature/unattended-callers-are-refused -->`. The Notes say "The slice map gives slice 1 no `waits:` annotation; until that branch merges, fleetd's restart is refused `unattended`." The annotation is right; the Notes sentence is stale. The deviation from `loop-decisions.md` (which gives #2906 slice 1 no wait) should be reported to the slice map, not hidden.
5. **#2903's start cannot serve a no-PR desk as written.** The plan says fleetd starts the no-PR fixer "through the role start that #2903's `feature/fleetd-starts-the-fixer` uses". That start "re-asks the host for the PR's state and head and refuses by name (`pr-not-open`, `head-moved`)" (#2903 Approach, *The fixer start*). A no-PR desk always reads `pr-not-open`. The attempts record is "per-PR" in #2903's slice line. No slice builds the plan-and-branch key that this plan appends to. With two keys, a desk gets two no-PR attempts and then two more after a PR appears.

## (b) Cited file:line facts

All checked, and all right. Checked lines: `ending-action.ts:154,162,217-224,347-370,351,354,361,366,632`; `fresh-agent.ts:52`; `registryd.ts:660-663,1011,1139,1151,1177-1178,1208,1216`; `dispatch-verbs.ts:194`; `dispatch.ts:42` (comment); `board/.../restart.ts:68`; `fleet/.../entry/restart-command.ts:89`; `restart-stopped-command.ts:103`; `shared/restart-command.ts:19-20,67,114`; `continuation.ts:857`; `claim.ts:77`; `dead-claim.ts:31`; `run-limit.ts:13`; `plot-reconcile-scan.sh:374`; `fresh-agent-tick.test.ts:410`.

The plan's text has two faults:
- It says "the PR index holds no OPEN or MERGED row". This repository's rule is that the index never says no (CLAUDE.md, *A Decision Reads The Index*). For the restart, `restartBranch` re-asks the host (`restart-command.ts:127`), so the fault does no harm. For `start-fixer`, nothing named re-asks the host for "no PR". A PR opened after the index's `at` reads as absent.
- `restartBranch` hard-codes `answer: RESTART_ANSWER` (`restart-command.ts:150`, the `continueOnDesk` call). "fleetd passes its own prompt" needs a new input field. The slice should say so.

## (c) Slices

- The cut and the order are right. Both slices edit `ending-action.ts`, `registryd.ts` and `fresh-agent-tick.test.ts`, so sequencing them is correct.
- Slice 1: the `waits: feature/unattended-callers-are-refused` annotation is correct. Fix the Notes line.
- Slice 2 also needs these waits:
  - `feature/the-fixer-attempts-record` (#2903 slice 1), which must grow the plan-and-branch key, or this plan builds that key itself.
  - `feature/role-agents-start-detached` (#2898), which carries the role-run liveness reading. That reading is the only real "fixer in flight" signal for `restartWorker`, `unblockerDue` and this arm.
  - Today the second dependency arrives only through #2903's slice 2.
- Both slices modify `applyFreshAgentDecisions`, which #2899 slice 1 instruments (`registryd.ts:1146-1153`, cited in #2899). #2899 expects #2906 to add its steps to the run-log enum (#2899 lines 37, 117). Add `waits: feature/the-loop-keeps-a-run-log` to slice 1, or name the conflict.

## (d) Open questions

- OQ1 (`holding-work` gets no fixer): agree. The same reasoning covers any desk whose `heldFiles` is non-empty or whose commits are unpushed, so make the condition `dirtyTree: 'no'` and "no unpushed commit", not the ending name.
- OQ2 (where the fixer runs):
  - The recommendation conflicts with #2898's role table ("fixer — a worktree on the PR's branch, created by fleetd") and with #2903 D5 ("fleetd creates the fixer's worktree itself").
  - #2903 meets the same `git worktree add` refusal for a dead PR desk, so this is one open question for two plans. Settle it once, in #2903's slice, and cite it here.
  - Either way, the lock does not mark the desk as held (P5). The guard is #2898's role-run liveness reading. `restartWorker`, `plot-reap.sh`, `unblockerDue` and this arm must all read it.
- OQ3 (run log): yes. #2899 lines 37 and 117 expect #2906's steps in the enum. No decision reads the log (#2899 line 49), so it adds no precedence seam. The only cost is the shared function edit noted under (c).
- OQ4 (how many reach a second fresh-session ending): measured on this machine. 33 slices had a fresh session, and 10 had an ask recorded after it. All 10 branches now hold a merged PR. `corrections-spent` implies a PR, because its marker reads "checks failed … against PR" (`agent-loop.ts:505`). So the no-PR `start-fixer` population is at most a few desks, from `turn-limit` and bound endings.
- New: what does a no-PR fixer leave behind? The fixer role "commits on the PR's branch" (#2898 role table). With the desk loop dead, no one opens the PR. The next tick reads the same ending and starts attempt 2 even after a good fix, then asks a person. The fixer must open the slice PR through `plot-open-pr.sh` (the controller CLAUDE.md names), or the arm should end in `restart` of the desk loop instead.
- New: what precedence holds between `start-fixer` and #2901's unblocker on a desk with an agent-authored marker? Proposal: `start-fixer` requires no agent-authored marker. That marker belongs to #2901, or to a person before #2901 lands. The loop's own `corrections-spent` marker is cleared or superseded by the fixer start, so the final ask writes its text.

## (e) Tests

The planned property test ("exactly one verdict per reading") proves nothing: a function returns one value. These tests are what proves the seams:

- Domain (`rules-ending-action.test.ts`):
  - the table as planned, plus `start-fixer` never answers with a fixer in flight;
  - `start-fixer` never answers with an agent-authored marker;
  - `restart` never answers for `ending: null` when the ending file exists but is unparseable or names another branch. `registryd.ts:872-873` maps both to `null`, and the plan's "no ending is recorded" must not include them.
- Fleet (`fresh-agent-tick.test.ts`):
  - the readings `endingAction` receives carry the host's `prOpen` and git's `commitBeyondClaim` for `ending: null` and the three fresh-session endings. This is probe 2's wrap, as a test that fails today.
  - a two-tick test: `start-fixer` on tick 1, the fixer still live on tick 2, and no second start;
  - `restart` on tick 1 and refused `reached-review`, then no host call on tick 2.
- A seam test at the tick level over shared fixtures. For each desk reading, at most one of these acts: `endingAction`'s applied verdict, #2903's fixer arms, #2901's `unblockerDue`, and `deadClaim`. It lands with whichever slice comes last of #2903 slice 2, #2901 slice 2 and this slice 2.

## Amendments

1. Both slices widen `readFreshAgentCandidates` and `freshAgentDecisions` (`registryd.ts:1023-1024` and the reader) so that `ending: null` and the three non-bound fresh-session endings carry the real `prOpen`, `commitBeyondClaim`, `dirtyTree` and marker readings. Add a tick test that fails today.
2. Add "no fixer in flight" (the #2903 in-flight mark or the #2898 role-run liveness reading) to the `start-fixer` conditions. Drop the claim that the continue lock holds the desk for the run.
3. Add "no agent-authored `PLOT-BLOCKED` marker" to the `start-fixer` conditions, and state the precedence: #2901 owns an agent's question. State what happens to the loop's own `corrections-spent` marker, so the final ask can name both attempts.
4. Name the no-PR fixer start: re-ask the host and refuse when a PR now exists, rather than reuse #2903's `pr-not-open` refusal. Name who builds the plan-and-branch key in the attempts record, and how attempts carry over when a PR appears.
5. Say what a successful no-PR fixer leaves: it opens the slice PR through `plot-open-pr.sh`, or the arm hands the desk to `restart`.
6. Delete the stale Notes sentence on slice 1's wait. Report the deviation to `loop-decisions.md`. Add slice 2's waits on `feature/the-fixer-attempts-record` and `feature/role-agents-start-detached`, and slice 1's wait on `feature/the-loop-keeps-a-run-log` or a named conflict.
7. Replace "the PR index holds no OPEN or MERGED row" with a host re-ask for the no-PR condition before any start. Name the `answer` input that `restartBranch` gains.
8. Settle open question 2 jointly with #2903, against #2898's role table.
