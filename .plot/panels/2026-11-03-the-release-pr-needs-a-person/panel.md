# Panel: the-release-pr-needs-a-person, round 1

Outcome: unanimous amend (layering, safety, seams, testability).

## Shared findings

Each finding below was checked against `origin/main` (`a518552f1`) before the plan adopted it:

- **The review gap is `Auto-review` off (four of four).** `registryd-main.ts:3070` passes `readAutoReview(boardOpts).autoReview` to the release arm; `release-tick.ts:118` starts a review only `if (step.step === 'review' && reviewEnabled)`; `auto-review.ts:55-57` reads an absent key as off; `CLAUDE.md` has `Auto-verify` and `Auto-design` but no `Auto-review`. The skipped branch writes no run-log line, and the fleetd line still reads `release preparing: review` (35 to 53 lines, depending on which log files a juror read). Plan: Decision 1, the first slice, two tests.
- **The dispatched run does write `validate` on the head (four of four).** Check suite `112877067409` on `14d28a09`, `success` at 14:47:21Z, app `github-actions` (integration 15368). The PR rollup omits it; both suites report `pull_requests: []`. The plan's sentence "reports no `validate` check to the PR" was true for the rollup and false for the commit. Plan: Motivation rewritten from the measurement on record.
- **Whether the ruleset accepts the dispatched check alone is unmeasured (four of four).** No release attempted a merge after the dispatched `validate` finished and before a person approved the held run. Plan: CI Measurement as the CI slice's first step, run by a person.
- **The plan missed its predecessor (layering, seams, testability).** `2026-10-29-the-release-waits-for-one-approval.md:41` named Plot's fold as a cause, and `:70` required the same measurement; delivery recorded none. Plan: cited in Motivation.
- **Two readers disagree on "the checks are green" (four of four).** `requiredChecks` (`release-prepare.ts:179-187`) calls the head green when any `CI` run succeeded; `mergeAt` (`merge.ts:203`) reads the rollup, which folds `plot/review` alone to `green` (`plot-host.sh:709`). Plan: one domain rule, `checks-missing`, read by `releaseApprove` and `releaseStage`.
- **The review waits on CI (layering, safety).** `release-prepare.ts:256-260` returns `none('checks-…')` before the review question. Plan: stated as a constraint, and the live check names a head whose `CI` run succeeded; the review start keeps the "was the head tested" reading.
- **"Board impact: none" is false (layering, seams).** Plan: Board impact rewritten.
- **No test plan (four of four).** Plan: a Tests section per slice, each test failing before its change, guards marked.

## Where jurors differed

- **Who answers "what GitHub counts".** Layering and seams expected the fix to be Plot's reader if the ruleset accepts the dispatched check; safety rated Plot's `green`-without-CI reading HIGH and wanted a refusal now regardless; testability wanted the reading to gain an `event` field. The person decided: build Plot's guard now on the rollup reading, and widen it only if the measurement shows the ruleset counts the dispatched check.
- **The fix for the review gap.** Testability and seams offered two options (set `Auto-review: true`, or start the release review independently of the switch). Layering offered a release-only key. The person chose `Auto-review: true` for this repository.
- **Provenance.** Only safety raised a foreign head on the unprotected `changeset-release/main` (F3, F7). The person decided a `release-head-foreign` refusal with no branch protection change. The plan also holds the review start on a foreign head, because the review becomes unattended under Decision 1.
- **Mechanism 1.** Layering called it a forgery unless it waits for the run, and possibly redundant; safety and seams specified how it must wait, find its run and write. The plan keeps it as an option with all three jurors' constraints.
- **Mechanism 3.** Layering placed it in `releaseApproveAt` behind the `Build` port with a `checks-pending` refusal; safety asked whose token it spends; seams measured its cost (12 to 20 minutes per head). The plan states all three.
- **Open question 4 (2.29.1).** Safety answered it from run `40874720456`; the others used 2.29.1 as evidence only. The plan marks it answered.

## What each juror ran versus read

| Juror | Ran (read-only) | Read only |
|---|---|---|
| layering | `gh` reads of runs, check runs and the ruleset on three release heads; `plot-config.sh get Auto-review`; the `release-approve` receipt | `release.yml`, `ci.yml`, the domain rules and workflows, `release-tick.ts`, `registryd-main.ts`, `plot-host.sh:4640-4700` |
| safety | `gh` reads of runs, suites, statuses and the ruleset on two heads; `/apps/github-actions`, `/apps/plot-review` | the workflows, `release-approve.ts`, `merge.ts`, `release-prepare.ts`, `release-tick.ts`; not `plot-review.mjs` or `reviewPr` |
| seams | `gh` reads on four release heads and the ruleset; a grep of fleetd logs; a read of the session transcript for the 2.29.1 and 2.30.0 command results and timestamps | every code path |
| testability | `gh` reads on four release heads, run attempts and `triggering_actor`; a grep of fleetd logs | `release-prepare.ts`, `release-tick.ts`, `release-world.ts`, `review-run.ts`, `auto-review.ts`, `pr-index.ts` |

No juror ran a test, a merge attempt or a host write. Only seams recovered the host's refusal text and the 2.29.1 `checks-not-green` refusal, from the session transcript.

## Shared blind spot

No juror measured whether GitHub's ruleset counts a check run from a suite with no PR association. All four inferred it from approval timing, and the only refusal recorded came while the dispatched run was still in progress. The CI slice's choice rests on that measurement, and the plan makes it the slice's first step. No juror checked the provenance file set against past release commits; the moderation did, against `14d28a097` and `fbe76191e`.

## Decisions taken by the person

jwloka, 2026-11-03:

1. Set `Auto-review: true` in this repository's `## Plot Config`, and name a skipped release review as skipped in the log and the run log, with a test.
2. Measure first for CI. Build Plot's own guard now; choose the CI mechanism from the measurement on the next release head. Keep each option's costs and the jurors' safety constraints in the plan.
3. `release-approve` refuses `release-head-foreign` when the head changes more than the changesets version step writes. No branch protection change.
