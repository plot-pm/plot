# Panel: the-release-head-reports-validate-with, round 1

Outcome: unanimous amend (layering, safety, seams, testability).

## Shared findings

Each finding below was checked against `origin/main` (`a518552f1`) and ruleset `24412719` before the plan adopted it:

- **The measurement cannot reach GitHub (safety, seams, testability).** The procedure inherited from #3070's `### CI Measurement` runs `plot-ask.mjs release-approve`. After #3070's checks slice, that command refuses `checks-missing` before it calls `mergeAt`, because the dispatched `validate` is absent from the rollup. Outcome A and Outcome B then read the same. Plan: `### Measurement` reads GitHub directly and merges nothing (Decision 1), and the `checks-missing` answer is named as expected and not the measurement.
- **Nobody owns Outcome A (four of four).** The plan said #3070 owns "Plot reads the dispatched check"; #3070's Notes move it here, and no #3070 slice builds it. Plan: Decision 3 and the Outcome A candidate slice, with #3070's test.
- **The comment corrections and the live proof are orphaned (layering, safety, seams).** #3070 assigns `ci.yml:30-33`, `release.yml:141-159` and the live proof to a CI slice it no longer has. Plan: Decision 4, `### Docs and comments`, `### Live proof` gating delivery.
- **The plan drops #3070's per-mechanism constraints (layering, safety, seams).** Plan: `### Candidate mechanisms` table and the constraint paragraphs for (a) and (b), plus the invariants in `### Scope`.
- **`dispatch-ci` cannot relay (layering, seams).** It runs `gh workflow run` and exits (`release.yml:160-180`). Plan: the relay is a new job, a final `ci.yml` job or a `workflow_run` workflow.
- **The relay must write as integration 15368 (layering, safety).** Ruleset `24412719` pins `validate` to 15368; `Host.commitStatus` writes as 5317669. Plan: the relay uses `GITHUB_TOKEN` and never `Host.commitStatus`.
- **The merging identity is a bypass actor (safety, seams, testability).** RepositoryRole 5 (admin) and integration 5173644 bypass `always`; jwloka is admin. Plan: the measurement merges nothing, the record names the reading identity, and `### Live proof` reads the merge's rule-suite for `pass`, not `bypass`.
- **No scope line, no tests, no `### Decisions` (four of four).** Plan: `### Scope` (GitHub only), `### Tests`, `### Decisions`.
- **The proof cannot ride in the slice PR (layering, testability).** A workflow change takes effect only after merge to `main`. Plan: `### Live proof` gates delivery, not the slice.

## Where jurors differed

- **The measurement route.** Seams offered three routes: measure before #3070's checks slice merges, read `mergeStateStatus` only, or a person-only `release-approve` mode. Safety and testability preferred a read that merges nothing; testability also allowed a pinned non-bypass merge. The person chose the read-only route.
- **The third candidate.** Layering placed "a controller approves the held run" on the `Build` port; safety rated its exposure HIGH (F6), because the held run reads `ci.yml` from the unprotected `changeset-release/main` with the `plot-build` key in the repository secrets, and the plan's own verification line excluded it (F4). The person dropped it.
- **What makes Outcome B.** Seams alone named `require_extra_approval_for_unattributed_changes: true` as a possible blocker that no CI mechanism removes (S4). Testability added an inconclusive outcome. The plan adopts both: a second reading after the approved run separates a `validate` block from another rule's block, and an inconclusive record chooses no mechanism.
- **The non-bypass token.** Layering read it as reversing `release.yml:46-49`; safety (F7) showed it needs a job split and that the new token must push the branch so every regenerated head starts a run. The plan carries the split and the push constraint.
- **The relay on a cancelled run.** Only seams raised it (S6). The plan states that a cancelled run is not a result and the relay writes nothing for it.
- **The duplicate Changelog line.** Only seams named #3070's Changelog bullet 4 (S3). It is a correction to #3070 and not to this plan.

## What each juror ran versus read

| Juror | Ran (read-only) | Read only |
|---|---|---|
| layering | `gh issue view 3073`; ruleset `24412719`; check runs and Actions runs on `14d28a09`; `gh pr view 2934` | `release.yml`, `ci.yml`, `plot-host.sh`, `ports/host.ts`, `ports/build.ts`, `release-approve.ts`, `merge.ts`, `release-tick.ts`, `plot-commit-status.mjs`, #3070 |
| safety | ruleset `24412719`; branch protection on `changeset-release/main` (404); workflow permissions; jwloka's permission; secret list; environments; `plot-config.sh get "Merger app"` | the workflows, `release-approve.ts`, `merge.ts:195-210`, `plot-host.sh:4436-4445`, `docs/review-status-rollout.md:134-160`, #3070 |
| seams | ruleset `24412719`; open release PRs (none); `gh pr view 3076` | #3070, `release.yml`, `ci.yml`, `plot-host.sh` `pr-merge` and `pr-state`, `release-approve.ts`, the sprint file, `fleetd-merges-no-slice-pr-while`, `check-plan-headings.sh` |
| testability | ruleset `24412719`; jwloka's permission; `git grep` for `checks-missing` and `mergeAt` | `release-approve.ts:105-160`, the `plot-host.sh` merge arm, #3070 |

No juror ran a test, a merge attempt or a host write.

## Shared blind spot

No juror measured whether `mergeStateStatus` reads `BLOCKED` for a viewer with bypass `always`, and the measurement reads it as jwloka, an admin. The plan keeps this as an open question and checks it against reading 2, after the approved run. No juror read the rule-suites endpoint on a past release merge; the live proof names it as the bypass reading.

## Decisions taken by the person

jwloka, 2026-11-03:

1. The measurement reads and merges nothing. On the 2.30.1 head, before the held run is approved, jwloka records the PR's merge state and rollup, the head's check runs, its commit statuses and the workflow runs. The release then proceeds as today, with one held-run approval recorded in the sprint notes as an intervention. Three outcomes: A, B and inconclusive.
2. Drop the controller-approval candidate. Keep (a) a status relay from a new job writing with `GITHUB_TOKEN`, and (b) a non-bypass token with the `release` job split. The choice for Outcome B waits for the measurement.
3. This plan owns Outcome A: a slice that widens #3070's `checks-missing` reading to a `validate` check run from integration 15368 on the pinned head. The measurement record comes first; then exactly one build slice, for the outcome measured. The plan stays Draft until the record exists.
4. This plan takes over the comment corrections, the CI tests and the live proof of #3070's removed CI slice. GitHub only.
