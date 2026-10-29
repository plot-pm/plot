# Juror verdict: safety

Position: amend

Evidence: Read the plan, issue #2907, DESIGN-delivery-loop.md, sibling plans #2898, #2899, #2900 and #2902, `packages/domain/src/workflows/merge.ts`, `workflows/release.ts`, `packages/board/src/server/entry/merge.ts`, `entry/main.ts:151-177` (`plot-ask.mjs merge`), `entry/gate.ts:620-700`, `entry/release-gate.ts`, `packages/board/src/server/release.ts`, `plot-host.sh:300-312` and `:4668-4685`, `ports/host.ts`, `ports/build.ts`, `ports/notifier.ts`, `.github/workflows/ci.yml:1-60`, and the plans `2026-10-01-the-release-pr-is-checked-before-it-merges` and `2026-10-28-parallel-release-calls-exhaust-their-push`. Ran these reads against the host: `gh pr list --head changeset-release/main` (the last 5 release PRs), `actions/runs?branch=changeset-release/main` (30 runs), check-runs and statuses on the v2.29.1 head `46a92390`, the `main` ruleset (`rulesets/24412719`), and `commits/860a0586a/pulls`. Ran a vitest probe (a temporary file under `packages/domain/test/`, removed afterwards; a copy is kept in the scratch dir) against the real `merge` and `release` functions. The probe ran 3 of 3 tests, all passing.

## (a) Problem statement

- **Correct as a description of the manual steps.** The v2.29.1 release shows each step. The `pull_request` run on head `46a92390` was created at 12:36:56 as `action_required` and its jobs started at 13:08 after a person approved it. The `plot/review` status was written at 13:30:20. PR #2810 merged at 13:30:42. The plan records `860a0586a`, `4ba64ed2c`, `21bae07b0` and `d06597a41` and the sprint close `c2349bd7c` are single-parent commits on `main`, and `commits/860a0586a/pulls` returns no PR.
- **Missing cause: why the run approval is needed at all.** `release.yml` already dispatches a pinned `validate` (`ci.yml:28-38`), and on `46a92390` it reported `success` at 12:50, before the approval. The approval is still needed because `plot-host.sh:4677-4679` folds `ACTION_REQUIRED` into `checks=failing`, so `merge.ts:111` refuses `checks-not-green` while the held run exists. The plan must state this. It is the only reason the step exists, and it decides what "green" means for the prepare rule.
- **Wrong premise: "`release` stays refused for every unattended caller".** The plan treats this refusal as existing behaviour. I found no such refusal. `release.ts` (board route) records a receipt and starts the script with no `PLOT_UNATTENDED` check. `workflows/release.ts:239` uses `unattended` only to turn the Should-Have prompt into a warning. The probe shows `release(..., { unattended: true })` answers `decided`. `entry/gate.ts:686` allows any call from a linked worktree. The refusal that the design's Calls-made list depends on is prose today. #2898 makes the same claim (its line 36).
- **Wrong premise: "No other route reaches `release`".** `plot-ask.mjs merge <pr> <sha>` (`entry/main.ts:151-177` → `entry/merge.ts:49`) merges any PR and has no unattended check and no release-PR check. The probe shows `merge` answers `decided` for a PR on `changeset-release/main`. A merged release PR publishes, because `release.yml` runs on the push to `main`. Today any master agent, worker, or the fleetd merger from #2902 with its lifted refusal can merge the release PR through the generic route.

## (b) Approach — the safety lens

**One merge in flight (anti-goal).** `merge.ts:117-130` refuses only `red` and `stale`. The probe shows a settled-green older commit with a pending head answers `decided`. The release merge is a merge into `main`, so it must wait for the in-flight mark that #2902 derives. That is the real dependency on #2902, and the plan does not name it. Step 3 must say "refuses while a merge is in flight" as well as "moved head".

**A person acts at the same time.** A person can merge the release PR in the GitHub UI, or through `plot-ask.mjs merge`. Then step 4 (Finish) never runs, because the plan chains it to the approval controller. Finish must derive from host state and not from the controller call: the release PR is MERGED at the prepared head, and the tag for that version exists. `release-approve` on an already-merged release PR must continue to Finish and must not refuse `pr-not-open`. `release.ts:299-302` already makes the sweep idempotent: the probe's rerun answers `already-released` with 0 writes. `release.ts:275` refuses `tag-absent` before publish, so a sweep that runs too early writes nothing.

**fleetd crashes mid-step.**
- If fleetd crashes between the merge and the sweep, the design forbids an unattended resume, because `release` never runs unattended. Open question 3 therefore has one safe answer: fleetd does not resume the sweep. It notifies that the release merged and the sweep is pending. The person reruns `release-approve <pr>`, which is idempotent as above. The plan must state this answer, because the other option ("a step the fleet resumes") is an unattended release.
- If fleetd crashes between the approval of the CI run and the notification, the "once per head" record decides whether the person gets a duplicate or no notification. Write the record after the send. A duplicate notification is harmless and a lost one is not.

**Two ticks start the same step twice.**
- Approving an already-approved run returns an error from the host. The adapter must read that error as done and not as a failure that retries or escalates.
- Starting the reviewer twice on one head gives two writers of `plot/review`. The plan must reuse #2900's start guard and not add a second one.

**Host call fails or answers partially.**
- Every prepare reading that fails must answer `unaskable` and hold. The index may never say "no release PR" (CLAUDE.md, *The index never says no*).
- The plan does not say what the controller reports when publish fails after the merge (open question 2). `main` then carries the version bump with no tag. `release.ts:275` already refuses `tag-absent`, and the controller must report that refusal by name and stop. It must never re-run publish.

**Approving the wrong run.** `BuildPort` (`ports/build.ts:47`) and `Host` (`ports/host.ts`) have no verb to approve a run, so this is a new connector write. A selector that approves "the `action_required` run" without a pin can approve a held run from a fork PR. GitHub holds that run so that a person decides whether untrusted code runs. The approval must pin all of these: workflow `CI`, event `pull_request`, head branch `changeset-release/main`, head repository equal to the base repository, and `head_sha` equal to the release PR's current head. `ci.yml:34-38` records that `changeset-release/main` has no ruleset, so any writer can push to it. The selector must refuse a head that was not written by `release.yml`. The `expected_sha` of the dispatched run gives that proof.

**No bypass rights.** The `main` ruleset (`24412719`) lists bypass actors RepositoryRole 5 (admin, `always`) and Integration 5173644 (`always`). The release sweep and `plot-sprint-state.sh` push straight to `main`: the five commits above have no PR, so they used the admin bypass. This is acceptable when a person's approval runs the sweep with that person's credentials. If fleetd runs it unattended, a fleet process bypasses the ruleset, which the design forbids ("No fleet merge bypasses the ruleset"). This is another reason to keep Finish in the person's call.

**The loop arms must exclude the release PR.** #2904's fixer and #2902's merger evaluate "slice PRs of the scope". The release PR reads `checks=failing` while its run is held (`plot-host.sh:4683`). A fixer must never push to `changeset-release/main`, and the merger must never merge it. A HIGH finding on the release PR must notify the person: no fixer starts, and no ticket-and-merge follows.

**Release content and scope differ.** The release PR carries every changeset on `main`, not only the frozen scope's. The design dispatches plans approved during the run "as today", so their slices keep merging. Then the notification's "N plans" understates the content, and a release can ship half of a plan that is not in scope. The release PR head also keeps moving: on 2026-10-29 it held 15 heads between 06:42 and 12:37, and 9 of 15 dispatched runs were cancelled. The notification must list the changesets on the prepared head and name any that belong to a plan outside the scope or not Delivered.

## (c) Slices

- The cut is right: Prepare, Approve and Finish, in that order, one branch each.
- **Missing slice, or part of Approve:** the release refusals, built as a gate. This means `merge` refuses a `changeset-release/*` head unless the caller is `release-approve`, and `release-approve` and the sweep refuse `PLOT_UNATTENDED=1` for every caller, fleetd's declared identity included. Without it, "nothing else reaches release" is a rule (CLAUDE.md, *Gates Over Rules*).
- Finish must not be a fleet-resumed step (see b). Keep it in the controller, re-runnable by the person.
- The run-approval connector verb belongs to Prepare and must be named, with its pin, in the slice line.

## (d) Open questions

1. *What records "prepared"?* A state file under `.plot/state/` that holds the PR, the head SHA, the version, the review status SHA, the changeset list and `notifiedAt`. `release-approve` refuses when the host's head, re-read fresh, differs from it. The file is a record of bought answers, not a verdict (CLAUDE.md, *Answers, never verdicts*), so the verdict `ready` is re-derived on every read.
2. *How long does the wait for publish last, and what happens on failure?* Bound it by `Checks wait`. On failure, report `tag-absent` from `release.ts:275`, write nothing, and notify. Never re-run publish.
3. *Is the sweep in the same call?* Yes, in the person's call. It is resumable only by rerunning `release-approve`, never by fleetd (see b).
4. *Board states:* no safety answer.

New questions the plan must carry:

- What does Prepare do when the release head moves after the notification? Re-prepare, and notify once per head, with a bound on how many notifications one release sends.
- Does the release merge wait for the in-flight mark from #2902?
- What happens to a release PR whose changesets include a plan outside the scope or one that is not Delivered?
- Which host write approves the run, and through which port (`BuildPort` or `Host`)?
- Dependencies: the plan also needs #2898 (the caller identity, so that fleetd can approve the run and start the reviewer) and #2899 (the notification and the run log). It names only #2900 and #2902.

## (e) Tests

- **Prepare (domain unit, vitest):** `releasePrepare` holds when any scope plan is not Delivered, when a reading is `unaskable`, or when no release PR is found. It answers approve-run only for a held run whose head is the PR head on the same repository and branch. It answers notify once per head.
- **Approval gate (domain unit):** `merge` refuses a release-branch PR for a non-`release-approve` caller. `release-approve` refuses under `PLOT_UNATTENDED=1` with the fleetd identity set. It refuses `head-moved`, in-flight, red and stale. It continues to Finish on a PR that is MERGED at the prepared head.
- **Entry (board unit, `--project parallel`):** `plot-ask.mjs merge <release-pr>` refuses by name. Make it a mutation test: removing the refusal must fail the test.
- **Finish (domain unit):** a sweep rerun answers `already-released` with 0 writes, which the probe here showed. Before the tag exists, it refuses `tag-absent`.
- **Adapter (contract test with a stubbed `gh`):** approving an already-approved run is read as done, and a fork run is never approved.

## Amendments

1. State the real cause of the approval step: `plot-host.sh:4677-4679` folds `ACTION_REQUIRED` into `failing`, and `merge.ts:111` then refuses.
2. Correct the premise. No unattended refusal for `release` exists, and `plot-ask.mjs merge` reaches the release PR today. Build both refusals as a gate in the Approve slice, with a mutation-tested unit test.
3. Pin the run approval to workflow, event, branch, same repository and head SHA. Name the new connector verb.
4. Make the release merge wait for #2902's in-flight mark, and name that dependency.
5. Derive Finish from host state, so that a release PR merged by a person still finishes, and make `release-approve` idempotent on a merged PR. fleetd never resumes the sweep; it notifies.
6. Keep Finish in the person's call, because the sweep pushes to `main` through the admin bypass.
7. Exclude the release PR from every slice-loop arm (fixer, merger, HIGH ticket). A HIGH finding on the release PR notifies the person.
8. List the changesets on the prepared head in the notification, and flag any that belong to a plan outside the scope or not Delivered.
9. Add #2898 and #2899 to the dependencies.
