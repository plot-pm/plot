# Panel: a-release-holds-merges-while-it-waits

Round 1, 2026-11-27. Subject: `docs/plans/2026-11-27-a-release-holds-merges-while-it-waits.md` on `origin/main` (Approved 2026-11-27; slice `bug/a-waiting-release-holds-merges` in progress). Lenses: estate, testability, user. Commitment: `Position: proceed|amend|reject`. The gate committed all three files.

**Reconciliation:** unanimous `amend` (estate, testability, user). No juror rejects.

## What each juror looked at

- **Estate** read the plan against the merge arm, the existing holds, `release.yml` and the GitHub activity of 2026-11-26, and counted what moved the release head.
- **Testability** asked which test proves each rule, and read the slice branch against the plan.
- **User** read the plan as the operator who waited, stopped the fleet and approved 9 h 21 min after the review.

All three read the plan, main and the 2026-11-26 timeline from the host. None ran the slice's code.

## Where the three agree

1. **The hold starts too late for the measured race.** #3738 merged at 20:33:37Z, after CI on `e150fd7c1` turned green at 20:30:57Z and before its review went `pending` at 20:34:34Z. A hold that starts on a `success` review (the plan) or a `pending` one (the slice branch) never fires there. It must start when the release head's CI is green, and a test must replay that window.
2. **The Motivation misreads the last 1 h 36 min.** Main got no commit after 20:36Z. `8e1373e0f` was green from 20:55:50Z, and its review started at 22:31:41Z, 15 s after the fleet stop. That wait came from a review that did not start, which a merge hold does not touch. The plan must name it and route it to `a-stale-pending-review-is-asked-again` or to a slice of its own.
3. **The bound does not fit an unattended night.** A per-head `Checks wait` bound (3600 s) expires, one merge lands, a new head needs CI and review, and a new hour starts. With nobody to approve, the fleet stays held about two thirds of the night and nothing is approved. The plan must cap the total hold across heads, or stop holding when no approver can act.
4. **Two writers of `release-hold.json`.** fleetd writes the hold and the board's lift route writes it too, so a lift can be lost. One writer, or a lift record that fleetd reads.

## Where they differ

- **Estate alone** counts the causes: 5 of the 14 heads came from merges and 9 from direct pushes to main, which a merge hold does not stop (dispatch's `book the brief`, `plot-open-pr`'s `record PR`). The plan must say whether the hold also holds those pushes, or state that it does not and why the remaining moves are acceptable.
- **Estate alone** finds that the plan says the hold binds `plot-ask.mjs merge` while no slice adds it there.
- **Testability alone** finds that `releaseHold` re-derives "ready" from the index row instead of reading `releaseStage`, so a release in `waiting-scope` or `release-head-foreign` still holds main. The decision must read `releaseStage`, and the `{head, since}` record rule must move from `auto-merge.ts` into a domain rule with unit tests.
- **User alone** asks for a hold the person starts ("hold merges, I am about to approve") beside the lift, the hold in *Waiting on you* and as a notification when it begins and ends, the passkey's `localhost` limit named next to the approve button, and the hold's display in the first slice rather than the second.

## A shared blind spot

All three read the problem as head movement. The measured cost on 2026-11-26/27 had three parts: head movement (about 2 h), a review that did not start (1 h 36 min), and an approval route that could not work on zio's board (no registered passkey, `localhost` only), which cost the rest of the 9 h 21 min. A merge hold addresses only the first. A person-started hold (the user juror's proposal) addresses the first two for the cases where a person is present, which is the only case where an approval can happen. The plan should say which of the three parts it fixes, and the passkey gap needs its own issue.

## Changes for the author, in order

1. Start the hold when the release head's CI is green; add the replay test of 20:30:57–20:34:34Z.
2. Decide readiness from `releaseStage`; move the record rule into the domain with unit tests.
3. Cap the total hold across heads, and add a person-started hold beside the lift; keep one writer of the hold file.
4. Name the direct pushes and the review that did not start in the Motivation, and say which the plan fixes.
5. Add the hold to `plot-ask.mjs merge` or remove the claim.
6. Show the hold in *Waiting on you* in the first slice; name the passkey's `localhost` limit at the approve button; file the zio passkey gap as an issue.
