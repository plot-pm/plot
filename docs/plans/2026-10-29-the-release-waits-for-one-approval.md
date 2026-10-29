# The release waits for one approval

> When every plan in the sprint is Delivered, fleetd prepares the release PR and a person approves it with one action that merges, waits for the tag, and records the release.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #2907
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2911 merged

## Changelog

- When every unstruck plan of the active sprint is Delivered, fleetd starts the review of the release PR's head and notifies the person: the version, the PR, its check and review state, and the changesets the head carries in two groups, the sprint's plans and outside work. Changesets from outside the sprint never hold the release; the person decides. fleetd notifies once when the release first becomes ready, and afterwards once per new head only when the head's changeset list differs from the list last sent.
- `plot-ask.mjs release-approve <pr> <sha>` and a board button approve the release. The approval refuses by name when the head moved (`head-moved`), when `plot/review` is not `success` on that head (`review-missing`), when the PR is not the changesets release PR (`not-release-pr`), and when the caller is unattended (`unattended`).
- After the merge, the approval waits for the version tag, then records every scope plan as Released (docs and infra plans included) and closes the sprint in one commit and one push. Running the approval again resumes an interrupted finish.
- `plot-ask.mjs merge` refuses the release PR and names `release-approve` instead.
- The board's release row shows the release stage (waiting for the scope, preparing, ready, merged, publishing, released, failed) and enables its button only when the release is ready.

Board impact: the existing `release` row kind (`packages/board/src/contract/schema.ts:1696`) gains a stage from a domain `releaseStage` value and an approval button; `RELEASE_BRANCH` moves into the domain and the board re-exports it.

## Motivation

The delivery loop in [DESIGN-delivery-loop.md](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md) (approved by jwloka, 2026-10-29) removes every stop except the release. Today a person or a master agent finds the release PR, approves its CI run, runs the review, merges, waits for publish, books the plans as Released and closes the sprint by hand. The 2.29.1 release shows each step: the sweep and sprint-close commits `860a0586a` and `c2349bd7c` went to `main` with no PR.

The panel (round 1) measured five facts that the first draft got wrong:

- **No unattended refusal on `release` exists.** `release(readings, { unattended: true })` answers `decided` with plan-phase, plan-record, commit and push writes; `unattended` only turns the Should-Have prompt into a `PLOT-UNASKED` line (`packages/domain/src/workflows/release.ts:239-245`). The booking path calls the transition with no unattended input (`packages/board/src/server/entry/deliver.ts:725`), and the controller gate is a Bash hook that never sees fleetd's in-process calls (`packages/board/src/server/entry/gate.ts:649-651`). #2898 builds the refusal (D1).
- **The generic merge reaches the release PR.** `plot-ask.mjs merge <pr> <sha>` (`packages/board/src/server/entry/main.ts:151-178`) merges any PR, and `merge()` never reads `plot/review` (`packages/domain/src/workflows/merge.ts:105-132`). A merged release PR publishes.
- **There is no sweep route.** `POST /api/release` takes one `slug` and one `version` (`packages/board/src/server/release.ts:148-158`) and starts `plot-deliver.sh --release <version> <slug>` with its own push (`:211`). N plans make N pushes to `main`. `release()` already books many plans in one commit and one push (`workflows/release.ts:337-343`), but it skips docs and infra plans (`:291-294`) and answers `decided` with no write for a plan whose tag does not resolve (`:295-298`).
- **`plot-sprint-state.sh` commits nothing** (`skills/plot/scripts/plot-sprint-state.sh:22-25`); the caller owns the commit and push.
- **The `action_required` approval may be unnecessary.** `release.yml`'s `dispatch-ci` job (`.github/workflows/release.yml:160-180`) already starts `ci.yml` on every release-PR head, and on recent heads that run reports `validate` success beside an `action_required` pull_request run. The merge refuses only because `plot-host.sh` folds `ACTION_REQUIRED` into `failing` (`skills/plot/scripts/plot-host.sh:4678`) and `merge()` then refuses `checks-not-green` (`workflows/merge.ts:111-112`).

The release PR also carries work from outside the scope: on 2026-10-29 its head changed 15 times in 6 hours. An approval means something only when it pins to the head the person saw and the notification shows what that head ships.

This plan depends on #2898 (unattended refusals and the reviewer role definition), #2899 (the run log), #2900 (the scope reader, the review record and `startReview`) and #2902 (the settled-main hold in `merge()`).

## Design

### Approach

**Approve (slice 1).** A domain workflow `releaseApprove(readings, input)` runs before `merge()` and refuses by name:

- `unattended` for every unattended caller, fleetd included, on the `caller` reading from #2898's `feature/unattended-callers-are-refused`.
- `not-release-pr` when the PR's branch does not match `RELEASE_BRANCH`, which moves from `packages/board/src/contract/schema.ts:2590` into `@plot-pm/domain`; the board re-exports it.
- `head-moved` when the host's head, re-read fresh, differs from the `<sha>` the person approved.
- `review-missing` when `plot/review`, re-read fresh through `host.prReview`, is not `success` on that head.

It then delegates to `merge()` through the existing `mergeAt` path (`packages/board/src/server/entry/merge.ts:48`), so the pinned merge, the check refusals and #2902's `default-branch-unsettled` hold apply unchanged. No second merge rule exists. The generic `merge()` refuses a `RELEASE_BRANCH` PR and names `release-approve`. `release-approve` joins `ControllerAction` (`packages/domain/src/rules/controller-gate.ts:12`) with a receipt like `merge`'s, and CLAUDE.md's list of board-free actions.

**Finish (slice 1, D7).** The person's approval runs the finish as that person, after the merge:

1. Wait for the tag of the version read from the release branch's `package.json`, bounded by `Checks wait`. A publish that fails reports `tag-absent` (`workflows/release.ts:275-279`) by name, writes nothing, and never re-runs publish.
2. Book every scope plan as Released in one commit and one push, docs and infra plans included, with the sprint close in the same commit. A scope plan that cannot be booked stops the finish before the push and is named.
3. `release-approve` on an already-merged release PR skips the merge and resumes the finish. `already-released` and `tag-absent` make a re-run safe. A release PR a person merged in the GitHub UI finishes the same way.

fleetd never runs the finish. The board button starts the finish detached, as `POST /api/release` does today, so the single-threaded server never blocks.

**Prepare (slice 2).** A domain rule over readings selects one next step: wait for the scope, start the reviewer, notify, or nothing. Its readings are #2900's `sprintScope` answer from `feature/the-scope-is-read-from-git` (D3) with each plan's phase, the release PR's index row with its `plotReview` and `plotReviewSha` fields, the required checks read by name, and the run-log lines for this release. A scope that reads `none` holds, never an empty scope that is vacuously delivered. Every failed reading answers `unaskable` and holds; the index never says "no release PR".

- The rule reads the ruleset's required checks by name, not the folded rollup. The slice first measures whether a green dispatched `validate` alone lets the release PR merge. If it does, the `action_required` approval write is not built. If it is needed, it is a Build-port write in a TypeScript connector, pinned to workflow `CI`, event `pull_request`, branch `changeset-release/main`, the base repository and the head SHA, with `unaskable` on Bitbucket and Jenkins.
- fleetd starts the review of the release PR's head through #2900's `startReview` from `feature/fleetd-reviews-slice-prs`, the detached `plot-review.mjs` start that every PR's review goes through. `startReview` refuses `review-in-flight`, `at-capacity` and `start-failed`, and #2900's review run lock keeps one `plot/review` writer per head. Only `reviewPr` writes the `plot/review` status (`packages/board/src/server/entry/review.ts:395`, the write at `:512-515`). A bare role start runs the reviewer and writes no status, so the approval would refuse `review-missing` on every head; this plan never starts the reviewer as a role.
- The notification goes through `ports/notifier.ts:41`. It lists the head's changesets in two groups: the sprint's plans, and outside work (a changeset from a plan outside the scope, or from no plan). The approval pins to that head. Outside work never holds the release: when every scope plan is Delivered, the release is ready and the person decides.
- fleetd sends one notification when the release first becomes ready. Afterwards it sends one per new head only when the head's changeset list differs from the list last sent. A head that only the changesets bot's version bump moved, with an unchanged list, sends nothing.
- The record of what fleetd did (review started at head X, notified at head X with changeset list L) is a run-log line from #2899. The rule compares a head's changeset list with the list on the last notification line. The record never holds "ready"; the approval re-derives readiness from the host.
- A domain `releaseStage` value (`waiting-scope`, `preparing`, `ready`, `merged`, `publishing`, `released`, `failed`) drives the release row and the button's disabled state.

**The release PR stays outside the slice-loop arms.** #2900's review arm, #2902's merge arm and #2903's fixer act only on slice PRs; `slicePrNext`'s guard answers `none` for a branch outside the scope. A HIGH on the release PR notifies the person, and the approval refuses `review-missing` until `plot/review` reads `success` on the head.

The controller follows the layering rule: controller → domain → port ← adapter. New behaviour goes into TypeScript, not into `plot-*.sh`, because of the shell line ratchet.

### Decisions

Decided 2026-10-29 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-29-the-release-waits-for-one-approval/panel.md`):

- [x] D1: `release` refuses every unattended caller, fleetd included; #2898's `feature/unattended-callers-are-refused` builds the `caller` reading and the refusal. `release-approve` refuses `unattended` on that reading. The claim "no other route reaches `release`" becomes "no unattended route reaches `release`": `POST /api/release` and `plot-deliver.sh --release` stay for a person.
- [x] D2: every HIGH on a slice PR goes to a fixer. The release PR has no desk and no plan, so a HIGH on it notifies the person and blocks the approval; no fixer starts.
- [x] D3: the scope is the active sprint file read from git at its latest commit, struck items excluded. Prepare reads it through #2900's scope reader and builds no second one.
- [x] D4: fleetd never merges the release PR, so the `Merger app` rule does not reach it. The person's approval merges it.
- [x] D5: the reviewer on the release PR is #2898's reviewer role, loaded from the default branch's copy. fleetd starts the release PR's review through #2900's `startReview`, the detached `plot-review.mjs` start, and never through a bare role start; `reviewPr` runs the reviewer and writes `plot/review`.
- [x] D7: the person's approval runs the finish as that person: merge pinned to the approved head, wait for the tag, one commit and one push that records every scope plan as Released (docs and infra plans included) and closes the sprint. fleetd never runs the finish. Re-running the approval resumes it.
- [x] The approval takes `<pr> <sha>` and refuses `head-moved`, `review-missing`, `not-release-pr` and `unattended` by name; the generic merge refuses the release PR.
- [x] `RELEASE_BRANCH` moves into the domain in slice 1.
- [x] Prepare measures whether the `action_required` approval is needed before it builds the write.
- [x] The prepared state is actions taken, recorded as run-log lines; the approval re-reads the host. (Open question 1 of the first draft.)
- [x] The publish wait is bounded by `Checks wait`, and `tag-absent` guards the booking. (Open question 2.)
- [x] The finish runs in the person's call and is resumed only by the person. (Open question 3.)
- [x] The board shows a domain `releaseStage` on the existing `release` row. (Open question 4.)
- [x] The finish's push goes to `main` as the person's identity, as the 2.29.1 release did (D7).

Decided 2026-10-29 by Jan Wloka in a challenge:

- [x] Outside work: when every scope plan is Delivered and the release PR's head carries changesets from outside the scope, the fleet notifies and the person decides. The notification lists the head's changesets in two groups, the sprint's plans and outside work, and the approval pins to that head. The fleet never holds the release for outside work. (Open question 1 of the amended plan.)
- [x] Notification bound: one notification when the release first becomes ready; afterwards one per new head only when the head's changeset list differs from the list last sent. A head moved only by the changesets bot's version bump with an unchanged list sends nothing. The record of actions holds the last list sent. (Open question 2 of the amended plan.)

### Open Questions

- [x] What does Prepare do when a head's changesets include a plan outside the scope: notify and let the person decide, or hold the release as not ready? Answered: notify; the person decides (2026-10-29, outside work).
- [x] Is there a bound on how many notifications one release sends while its head keeps moving? Answered: one when ready, then one per changed changeset list (2026-10-29, notification bound).

## Slices

### Release approval

- `feature/the-release-is-approved-once` — `release-approve <pr> <sha>` as a domain workflow before `merge()`, with refusals `head-moved`, `review-missing`, `not-release-pr` and `unattended`; the generic merge refuses the release PR; `RELEASE_BRANCH` moves into the domain; the D7 finish (tag wait, one booking commit and push for every scope plan with the sprint close, resumable) <!-- builds: releaseApprove, the release-approve entry and gate receipt, the batched release booking --> <!-- waits: feature/unattended-callers-are-refused --> <!-- waits: feature/merge-waits-for-a-settled-main -->

### Release preparation

- `feature/fleetd-prepares-the-release` — when every scope plan is Delivered: read the required checks by name (measure whether the `action_required` approval is needed first), start the review through #2900's `startReview` (never a bare role start, which writes no `plot/review` status), notify with the head's changesets grouped as the sprint's plans and outside work, once when ready and then only when the list changes, record the actions taken with the last list sent; a domain `releaseStage` for the board button <!-- builds: releasePrepareNext, releaseStage, the release row's stage and button --> <!-- waits: feature/fleetd-reviews-slice-prs --> <!-- waits: feature/the-loop-keeps-a-run-log -->

## Notes

- Created from tracker issue #2907. The plan's `Issue:` field is the only link; nothing was written to the tracker.
- Owned elsewhere, not built here: the `release`, `merge` and `continue` unattended refusals — #2898 `feature/unattended-callers-are-refused`; the reviewer role definition — #2898 `feature/role-agent-definitions`; the run log — #2899 `feature/the-loop-keeps-a-run-log`; the scope reader — #2900 `feature/the-scope-is-read-from-git`; the review record in the PR index — #2900 `feature/the-index-records-the-review`; `startReview`, the detached `plot-review.mjs` start, and its guard — #2900 `feature/fleetd-reviews-slice-prs`; the settled-main hold in `merge()` — #2902 `feature/merge-waits-for-a-settled-main`.
- Overlap check: `done-holds-the-release-scope` is Released and answers another question. `the-release-pr-is-checked-before-it-merges` (Released) added `dispatch-ci`, which Prepare measures before it builds a run approval.
- Deliverable search for `release-approve` found no existing artifact.
- Amended 2026-10-29 after panel round 1.
- Amended 2026-10-29 after a challenge by Jan Wloka (outside work, notification bound) and the round-2 seams juror on #2900 (the release review starts through `plot-review.mjs`).
