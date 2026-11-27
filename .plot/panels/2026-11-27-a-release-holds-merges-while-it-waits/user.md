# User juror: a-release-holds-merges-while-it-waits

Position: amend

Lens: the operator who releases. The plan holds the fleet on a machine clock, but the measured wait was on the operator's clock. A 1 h hold that starts without the operator does not cover the night of 2026-11-26, and it repeats while nobody is there to use it.

## Facts checked

- True: #3719 got 14 new heads on 2026-11-26 between 14:33:17 and 20:37:05 UTC, including `879e6d7`, `b967bc4`, `e150fd7`, `a232b09` and `8e1373e` (GraphQL `HeadRefForcePushedEvent` on #3719).
- True: on `e150fd7c1`, `validate` success 20:30:57, `plot/review` pending 20:34:34 and success 20:36:00; `a232b0959` became the head at 20:34:34 (commit statuses API).
- True: `.plot/state/fleet-stopped.json` reads `at: 2026-11-26T22:31:26.076Z`; `plot/review` success on `8e1373e0f` at 22:31:49; #3719 merged 2026-11-27T07:52:00Z as `a55df0f41` (`gh pr view 3719`).
- True: `releaseApprovable` is at `release-approvable.ts:65`, `HoldReason` at `slice-pr-next.ts:162`, `mergeArm` at `slice-pr-next.ts:481`. No `release-waiting`, `releaseHold` or `release-hold` exists in `packages/domain/src` (git grep), so nothing duplicates.
- Misleading: "With no merges, `8e1373e0f` kept its head" implies the stop made the head stable. `git log origin/main --first-parent` shows no commit on main between `6c639d891` (20:36 UTC) and `a55df0f41` (07:51 UTC). The head was stable for 1 h 54 min before the stop. `validate` passed on it at 20:55:50, and the review did not start until 22:31:41, 15 s after the stop.
- So the last 1 h 36 min of the wait came from a review that did not run on a stable green head, not from a moving head. The plan does not name this, and a hold that begins only after a `success` review (Approach bullet 1) does nothing for it.

## Findings from the operator's seat

- F1, the bound does not cover the real wait. The review passed at 22:31 and the operator approved at 07:52, 9 h 21 min later. With a `Checks wait` hold (3600 s), the hold ends at 23:31, the fleet merges overnight, and the morning finds a new head with no review. The measured case fails at the moment the operator arrives.
- F2, the hold repeats with nobody present. "A new head starts a new hold only once it is green and reviewed" means every merge, CI run and review cycle buys another 1 h hold. With a cycle of about 20 to 30 min (`validate` 20:30 to review 20:36 on `e150fd7`), the fleet is held about two thirds of every night a release PR is open, and nobody approves in that time. The hold costs more than the problem when the operator is asleep.
- F3, the operator learns of the hold only on the Delivery tab. The plan adds row text and a Status word. It does not say whether the board's attention list (*Waiting on you*) shows "a release waits for your passkey", or whether the operator gets any signal when the hold begins or expires. A hold that nobody sees is the silent-degrade case that `~/.claude/CLAUDE.md` names.
- F4, the passkey works on `localhost` only, and the plan does not say so. On 2026-11-26/27 the operator approved twice on zio's board, which has no passkey. A hold that the remote board shows, with a button that cannot finish the release, sends the operator to the wrong board again. The row must name where the approval works.
- F5, the lift is the wrong control for the operator. The operator who is present wants the reverse: "hold merges now, I am about to approve". The plan gives only "Lift the hold". A person-started hold, bounded by `Checks wait` from the press, would solve F1 and F2 together, and the lift is only its cancel.
- F6, the "Lift the hold" button must show at all times, disabled with its reason when no hold is active (repository rule: controls are never hidden). The plan says the row "carries" the button but names no disabled state.
- F7, the repair exception and the `sprint/` exception are correct, and they keep main repairable (Approach bullet 3). No new failure there.
- F8, Open Question `[question-hold-before-review]` matters more than the plan says: per the fact above, the review is the slow step. The recommendation (start at green CI with the review `pending` or `success`) still does not start a hold when no review is running at all, which is the measured 20:55 to 22:31 state.

## Slice order and done-when

- The Hold slice's tests are checkable as unit tests over `releaseHold` and `mergeArm`. The order puts the hold before the board, so for one slice a hold runs that the operator cannot see or lift, except by stopping the fleet. Ship the display in the first slice, or keep the first slice behind no hold until the second lands.
- The Board slice's done-when names no test for the disabled button, no test for a hold shown in the attention list, and no test for the row naming the passkey's board.

## Required changes

1. Correct the Motivation: state that main received no commit after 20:36 UTC, that `8e1373e0f` was stable and green from 20:55:50, and that its review started 15 s after the stop. Name the late review as a second cause, or remove the claim that the stop kept the head.
2. Make the hold start on a person's action ("Hold merges for the release" on the board, and `plot-ask.mjs release-hold <sha>`), bounded by `Checks wait` from that press, and keep the automatic start only if a measurement shows it is needed. Otherwise state why an automatic hold that expires before the operator wakes still pays for itself.
3. If the automatic start stays, cap repeated holds: at most one automatic hold per release PR per operator absence (for example, none after an expired hold until a person acts), so the fleet is not held about two thirds of a night.
4. Put a waiting release, and an active hold with its end time, in the board's attention list, with a domain property and a unit test for each.
5. Name on the release row that the passkey approval works only on the operator's `localhost` board, and show this as the disabled reason on a board that has no passkey.
6. Show the hold button at all times, disabled with its reason when no hold applies, and add that case to the Board slice's tests.
7. Resolve `[question-hold-before-review]` before the second slice starts, and state what triggers a review on a stable green release head that has none.
8. Move the row text into the first slice, or state in the plan how the operator sees a hold while only the first slice is merged.
