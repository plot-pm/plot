# Estate juror — a-release-holds-merges-while-it-waits

Position: amend

## Motivation facts

- True: `releaseApprovable` is at `packages/domain/src/rules/release-approvable.ts:65`, `HoldReason` at `slice-pr-next.ts:162`, `mergeArm` at `slice-pr-next.ts:481`. No hold on main reads the release PR (`git grep release-waiting origin/main` finds only the brief).
- True: #3719 got 14 force-pushed heads from 14:33:17Z to 20:37:05Z on 2026-11-26 (GraphQL `HeadRefForcePushedEvent`). The five named heads and their times match. On `e150fd7c1`, `validate` succeeded at 20:30:57Z, `plot/review` went pending at 20:34:34Z and success at 20:36:00Z, and `a232b0959` arrived at 20:34:34Z. `.plot/state/fleet-stopped.json` reads `at: 2026-11-26T22:31:26.076Z`. #3719 merged at 07:52:00Z as `a55df0f41`.
- False: "each fleet merge gives the release PR a new head" understates the cause. Matching each head to the first-parent push before it on `origin/main`: 5 of 14 heads follow a PR merge (#3733, #3711, #3695, #3737, #3738, all merged by `app/plot-merger`). 9 follow a direct push: 3 `plot: deliver`, 2 `plot: build the board artifact`, 2 `plot: book the brief and plan start`, 2 `plot: record PR`, plus `defer` and `sprint: ... targets 2.38.0`. `release.yml:26-28` runs on every push to main, not only on merges.
- Misleading: "With no merges, `8e1373e0f` kept its head". Main received no push from 20:36:09Z (`6c639d891`) to 07:51Z, with the fleet still running for 1 h 55 min of that. `8e1373e0f` had `validate` success at 20:55:50Z and no `plot/review` until 22:31:41Z, 15 s after the stop. The 1 h 36 min wait on a stable, green head was the review not starting, which no merge hold addresses.
- "The fleet merged nothing for 9 hours" counts from the stop (22:31Z) to the release merge (07:52Z); the last fleet merge was #3738 at 20:33:37Z, so it was 11 h 18 min, and the release was approvable from 22:31:49Z with no person present.

## Does the design solve the measured case

- No, as written. The hold starts only on green CI and a trusted `success` review on the head. `e150fd7c1` never reached that state while it was the head: #3738 merged at 20:33:37Z, after CI green (20:30:57Z) and before the review started (20:34:34Z). The rule answers `none` at that moment, so #3738 merges and the head moves exactly as measured. The open-question variant (`pending` or `success`) also fails: the review was absent at 20:33Z.
- The window that needs protection is head creation to review success: 23 min on `e150fd7c1` (20:13:12Z to 20:36:00Z), of which CI took 17 min. The hold must start at green CI with the review absent, or at the head itself, to cover it.
- Even then, 4 of 14 heads came from pushes no merge hold stops: `book the brief` (dispatch) and `record PR` (`plot-open-pr.sh`) at 19:16Z, 19:21Z, 19:40Z and 19:46Z. Deliveries and artifact builds follow merges and stop with them; dispatch bookings do not. The plan names none of these writers.

## New failures

- Starvation: "a new head starts a new hold once green and reviewed" with a fresh `Checks wait` per head. With no person present, the cycle is: bound expires, fleetd merges one PR, Changesets pushes a new head, about 25 min of CI and review, then another 60 min hold. Overnight that caps the fleet at about one merge per 85 min for as long as nobody approves (on 2026-11-26 that was 22:31Z to 07:52Z). The bound must cap the hold per release episode or per period, not per head.
- Second writer: the Board slice's `POST /api/release-hold-lift` writes `liftedBy` into `.plot/state/release-hold.json`, the file fleetd rewrites on every new head. Two writers race read-fold-write exactly as CLAUDE.md "One writer" describes for the PR index. The lift needs its own file, or one writer.
- Repair PR and sprint bases: the exemptions are correct. `repairAdmitted` (`slice-pr-next.ts:507-515`) is in scope where the hold is placed, and `holdsApply` sends a `sprint/` base down the other branch (`:489`).

## Duplication and contradiction

- No existing hold reads the release PR; `fleetScopeRow` already classes it `release-pr` (`fleet-scope.ts:114`), so fleetd never merges it. No duplicate found (`plot-deliverable-search.sh "release holds merges"`).
- Contradiction: `[question-person-merge]` says the hold binds "fleetd and `plot-ask.mjs merge`", but `mergeAt` (`workflows/merge.ts`) does not call `mergeArm`, and neither slice adds the hold to `mergeAt`. Either a slice adds it or the plan says it binds fleetd only.
- `release-hold.json` stores `since`, an observation, and `liftedBy`, a person's act. That is a record, like `repair-record.json`, not a verdict; the plan should say so where CLAUDE.md calls `default-branch.json` "not a precedent".

## Slices

- Slice 1's tests are checkable and the branch already carries them (`origin/bug/a-waiting-release-holds-merges`, `4e6287cf2`, `9d3a7daa9`). None of them is the measured case: CI green, review absent, a slice PR ready.
- Slice 2's tests are checkable. The order is right: the board reads the record that slice 1 writes.

## Required changes

1. Correct the Motivation: 5 of 14 heads followed a PR merge and 9 a direct push; the head was stable from 20:37Z and the 1 h 36 min delay on `8e1373e0f` was the review not starting.
2. Start the hold at green CI on the head with the review absent, pending or success, and add the 20:33Z case as a slice 1 test: CI green, no review, a slice PR into main holds.
3. Name the direct pushes that still move the head (dispatch bookings, `plot-open-pr.sh` records) and either hold them, batch them, or state that the plan accepts them.
4. Bound the hold per release episode, not per head, so an absent person cannot hold the fleet to one merge per hold cycle indefinitely.
5. Give the lift its own file or route it through fleetd, so `release-hold.json` keeps one writer.
6. Decide whether `plot-ask.mjs merge` honours the hold; add it to a slice or remove it from `[question-person-merge]`.
7. Add the CLAUDE.md paragraph the brief asks for, stating that the record holds observations and a lift, never a verdict.
