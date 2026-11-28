# Panel: a-release-holds-merges-while-it-waits, round 2

Round 2, 2026-11-28. Subject: `docs/plans/2026-11-27-a-release-holds-merges-while-it-waits.md` on `origin/main` (Approved, `Rounds: 1`, amended by PR #3751), after PR #3754 merged. Slice 1 is draft PR #3746, built before the amendment. Lenses: estate, testability, user. Commitment: `Position: proceed|amend|reject`. The gate committed all three files (`r2-estate.md`, `r2-testability.md`, `r2-user.md`).

**Reconciliation:** unanimous `amend` (estate, testability, user). No juror rejects.

## What each juror looked at

- **Estate** read the plan against the merge arm, the release tick, `release-prepare.ts` and `release-approvable.ts` on main after #3754.
- **Testability** asked which test proves each rule, and read PR #3746's tests.
- **User** read the plan as the operator of 2026-11-26/27, and counted the stages in fleetd's local log.

All three read main and `gh pr diff 3746`. None ran the code.

## Where the three agree

1. **The amended hold does not fire in the measured case.** `releaseStage` answers `waiting-scope` (`release-prepare.ts:228-229`) before it reads checks or the review, and the plan holds nothing in `waiting-scope`. On 2026-11-26 both `e150fd7c1` and `8e1373e0f` read `waiting-scope`, so the plan's own replay test fails. This answers `[question-stage-on-2026-11-26]`.
2. **The hold must read what the approve button reads, not the stage.** `releaseApprovable` (`release-approvable.ts:65`) reads CI and the review only, which is why 2.37.0 was approved in `waiting-scope`. The hold holds an open release row into main whose head is clean, whose required workflow is green on the head, and whose trusted review is absent, `pending` or `success` on the head. Only `merged`, `publishing`, `released`, `failed` and `release-head-foreign` end it. Export the readiness check from `release-prepare.ts`, beside the review check #3754 shares, so the hold, the review start and the button cannot drift.
3. **PR #3746 must be reworked before it leaves draft.** It starts the hold only on a `pending` or `success` review, bounds it per head, keeps the record decision in `auto-merge.ts` and records `liftedBy`. The amended plan asks for an absent review to hold, one budget per release PR, the decision in `advanceReleaseHold`, and the replay, boundary, cap and revert-PR tests.

## Where they differ

- **Estate alone** finds that the readings the plan names do not reach the merge arm: `releaseTick` builds them in its own pass (`release-tick.ts:129-144`) and stores no readiness, and the merge pass runs separately (`auto-writes.ts:127`). The hold must read the PR index row, as #3746 does, which is a decision from a non-terminal answer and needs its own paragraph under "A Decision Reads The Index" in `CLAUDE.md`. The replay must use the index row as it stood in the 2 min 40 s before #3738 merged.
- **Testability alone** finds `spentMs` undefined: a wall-clock count spends the budget while fleetd is stopped. It also finds that #3746's bound test cannot tell `>` from `>=`.
- **User alone** finds that the automatic hold now covers the wrong hours. Since #3754, green CI to a passed review took about 5 min on `e150fd7c1`, and a one-hour budget per release PR is spent on the 14 afternoon heads while nobody approves, so nothing is left at 22:31. The person-started hold covers the moment of approval and should ship in slice 1. It also finds that plan:30 still sends the late review to another plan, which #3754 made out of date, and that in `waiting-scope` the operator gets no notice that the release can be approved, because `releasePrepareNext` notifies only in `ready`.
- **Estate and user** both find the passkey's `localhost` limit (#3750) still unnamed at the approve and "Hold merges" buttons.

## A shared blind spot

All three keep the automatic hold and ask how to make it fire. The user juror's numbers question whether it should run at all: with #3754 a ready head exists within minutes of green CI, and the cost was a head that moved again before a person came. A person-started hold, taken when the person opens the board to approve, holds exactly the minutes that matter and spends nothing overnight. The plan should decide whether the automatic hold stays, and with what default, before slice 1 is reworked.

## Changes for the author, in order

1. Decide whether the automatic hold stays; recommended: ship the person-started hold in slice 1, and keep the automatic hold off by default behind a config key.
2. Read readiness as the approve button does, through one check exported from `release-prepare.ts`; end the hold only on the five named stages.
3. Read the PR index row in the merge arm, and add its paragraph under "A Decision Reads The Index".
4. Define `spentMs` as time held while fleetd runs, one budget per release PR.
5. Remove plan:30's pointer for the late review, and say what #3754 already fixed.
6. Notify the operator when a release can be approved in `waiting-scope`, or state why not.
7. Name the passkey's `localhost` limit (#3750) at the approve and "Hold merges" buttons.
8. Rework PR #3746 to the plan, with the replay, boundary, cap and revert-PR tests.
