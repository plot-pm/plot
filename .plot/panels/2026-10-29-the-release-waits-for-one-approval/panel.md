# Panel moderation: the-release-waits-for-one-approval

Reconcile: **unanimous amend** (layering, safety, testability, seams). Executed evidence: layering, safety and testability ran vitest probes against the real `release()` and `merge()`; testability ran 248 domain, 29 board and 75 fleet tests; layering and safety read release PR #2810's runs, the v2.29.1 head's checks and the `main` ruleset read-only. Seams only read.

## Agreed by all four

1. **No unattended refusal on `release` exists.** Executed by three: `release(readings, { unattended: true })` returns `decided` with plan-phase, record, commit and push writes; `unattended` only turns the Should-Have prompt into a `PLOT-UNASKED` line (`workflows/release.ts:236-243`). `/api/release` passes no unattended flag (`entry/deliver.ts:725`); the controller gate is a Bash hook that never sees fleetd's in-process calls (`entry/gate.ts:649,686`). The plan and #2898 call it a refusal that "stays"; it must be built, as a domain refusal, mutation-tested. "No other route reaches release" is false while `POST /api/release` and `plot-deliver.sh --release` stay.
2. **fleetd never runs the finish.** Open question 3 (fleetd resumes the sweep after a restart) makes fleetd the unattended caller the design forbids. The finish follows the person's approval; re-running `release-approve` resumes it. `release()` already makes that safe: a rerun answers `already-released` with 0 writes, a run before the tag refuses `tag-absent`.
3. **Wrong dependencies.** The plan uses #2900's scope reader (Prepare step 1 would build a second one) and review record, #2898's role runner (the release PR is not a slice PR, so this plan starts the reviewer itself), and #2899's run log ("notified at head X" instead of a new state file). From #2902 it needs only the one-merge-in-flight hold.
4. **New host operations are unnamed.** The Build port is read-only (`ports/build.ts:53-155`); approving an `action_required` run is a new GitHub-only write. In `plot-host.sh` it grows the shipped shell; the plan says where it lives and what it answers on Bitbucket.

## Executed findings that narrow the approval

- **`release-approve <pr>` is pinned to nothing the person saw** (testability, safety): `merge()` merged a release PR with no `plot/review` at all; `mergeAt` never reads `prReview`; `plot-ask.mjs merge` accepts a `changeset-release/main` PR from an unattended caller. The approval takes `<pr> <sha>` (or pins to the prepared record's head) and refuses by name: `head-moved`, `review-missing`, `not-release-pr`, `unattended`. The generic merge refuses the release PR.
- **The release PR carries work from outside the scope**: its head changed 15 times in 6 hours on 2026-10-29 (safety). The notification lists the head's changesets.
- **The release merge waits for #2902's in-flight mark**: `merge()` allows a merge while main's newest commit is pending (safety, executed).

## Measure before building

- **The `action_required` approval may be unnecessary.** `release.yml:144-175` (`dispatch-ci`, from the Released plan `the-release-pr-is-checked-before-it-merges`) already gives the release PR a green `validate` under the app the ruleset requires; on #2810 and recent heads an `action_required` pull_request run sits beside a `success` dispatch run. The merge refuses only because `plot-host.sh:4677-4679` counts `ACTION_REQUIRED` as `failing`. Reading the required checks by name may replace the approval write. If the write stays, pin it to workflow, event, branch, same repository and head SHA, or fleetd can approve a held fork-PR run (safety).

## The sweep

- There is no sweep route: `/api/release` books one plan per call with one push each (`server/release.ts:89-97`), so N plans make N main CI runs against one-merge-in-flight; `21bae07b0` shows parallel calls broke once. `release()` can book all plans in one commit and one push (layering).
- The sweep pushes straight to main through the ruleset's admin bypass: the 2.29.1 sweep commits (`860a0586a`, `c2349bd7c`) have no PR (safety).
- `release.ts:304` skips docs and infra plans, against the standing rule that they also get a `Released` record; the sweep can also answer `decided` with zero writes when a plan's tag does not resolve (testability).
- `plot-sprint-state.sh` commits nothing; the finish owns the commit and push of the sprint close, under a named push lock (testability, seams).
- `RELEASE_BRANCH` lives in the board package (`contract/schema.ts:2590`); it moves into the domain (seams).

## Settled

- Q1: the prepared record holds actions taken (run approved, reviewer started, notified at which head), never "ready"; the approval re-reads the host (layering).
- Q2: guarded by `tag-absent` (layering).
- Q4: a domain `releaseStage` value the board button shows (layering).
- Keep the release PR out of the fixer and merger arms of the sibling plans (safety).

## Shared blind spot

All four accept that one approval covers the release. None asked what the person is approving: a PR whose head moved 15 times in a day, carrying changesets from plans outside the sprint. If the approval is to mean something, the notification must make the difference between "the sprint's plans" and "what this release ships" visible, and the approval pins to that head.

## For the person

- The finish's sweep and sprint close push to main as the person's own identity through the admin bypass, as 2.29.1 did. Keep that (the approval is a person's act), or route the sweep through a PR?
