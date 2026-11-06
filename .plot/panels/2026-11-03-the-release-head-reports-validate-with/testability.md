# Testability juror: the release head reports validate with no person approving a run

Position: amend

Scope note: this plan is not in sprint `follow-ups-2-30-1`. It starts after release 2.30.1, because its first step is a measurement on the 2.30.1 release head. I read it against that schedule.

## Summary

The plan delegates its whole test design to #3070's `### CI Measurement`. That procedure cannot record an unambiguous answer once #3070 is delivered, and #3070 must be delivered before 2.30.1 is cut. Step 3 runs `plot-ask.mjs release-approve`, and #3070's checks slice makes that command refuse `checks-missing` before it asks GitHub to merge whenever `validate` is absent from the rollup. That is exactly the condition under test, so GitHub's answer is never recorded and Outcome A and Outcome B look identical. The plan needs its own measurement procedure, with a GitHub-side reading that does not pass through Plot's guard, and an amended Outcome A.

## Findings

1. **The measurement reads Plot's guard, not the ruleset.** `release-approve.ts:131-145` on origin/main calls `releaseApprove` (the domain checks) and only on a pass calls `mergeAt` (line 143). #3070's checks slice (`feature/the-release-checks-are-counted`, #3070 Changelog bullet 2 and Approach line 71) adds `checks-missing` to that domain rule, reading "what GitHub counts" as the PR's `statusCheckRollup` excluding `plot/review`. #3070's own Motivation records that the dispatched `validate` is absent from the rollup ("That check run is absent from the PR rollup"). So on the 2.30.1 head, with the held run unapproved, step 3 answers `checks-missing` and makes no merge call. The record then holds "Plot: checks-missing; GitHub: not asked", which answers neither A nor B. The plan's Approach (line 37) repeats this procedure unchanged.

2. **Outcome A is not "nothing to build".** Plan line 39 says Outcome A closes the slice as "Plot reads the dispatched check", "which #3070 owns". #3070's Notes say the opposite: "The CI mechanism is not a slice of this plan ... The measurement and the mechanism move to #3073". #3070's slices list no CI slice. So under Outcome A, `checks-missing` keeps refusing every release until someone widens the reading to the head's `validate` check runs from integration 15368 (#3070 Approach, first CI option). That widening is this plan's slice in Outcome A, and its test is already named in #3070 Tests line 140: "a head whose only validate is a dispatched check run passes the checks rule". The plan must own it.

3. **An admin token is a bypass actor, which can fake Outcome A.** Ruleset `24412719` (read with `gh api repos/plot-pm/plot/rulesets/24412719`) lists bypass actors RepositoryRole 5 (admin) and Integration 5173644, both `bypass_mode: always`. `gh api .../collaborators/jwloka/permission` answers `admin`. `plot-host.sh:4440` builds `gh pr merge` with no `--admin`, and 2.30.0's refusal at about 14:39Z shows that path did not bypass then. A manual merge, a `--admin` flag, or a REST merge call by the same person can still pass through bypass and read as "the ruleset accepts the dispatched check". The record must prove no bypass was used.

4. **The record has no named commands, no place and no owner.** "the PR's rollup at that moment" (#3070 line 101) names no command. "recorded here" names #3070's section, but #3070 will be delivered by then, and this plan says it "stays Draft until that record exists" (line 46) without saying who writes it, in which file, or through which PR. A second operator cannot reproduce the reading from the plan alone.

5. **The live proof of the chosen mechanism has no stated observation.** Line 42 says "`validate` appears in the PR's rollup on the pinned head with no `actions/runs/<id>/approve` call". "no approve call" is a negative that needs a source: the held run's `run_attempt`, its `triggering_actor`, and the absence of an approval in the run's history. #3070's `### Live proof` lists these fields; this plan should name them for its own slice.

6. **Local versus live split is not stated for this plan.** #3070 line 140 states it ("no local suite reads workflow files or the ruleset"). This plan states no test at all. Per mechanism the split is:
   - Plot reads the dispatched check: fully local. A domain test in `packages/domain/test/workflows-release-approve.test.ts` and `release-prepare.test.ts` fails before (rollup reading) and passes after (check-run reading), plus a `test/reconcile/host.test.mjs` case if a new `plot-host.sh` op reads check runs, with a Bitbucket case answering `unaskable`. One live confirmation on the next release head.
   - Status relay from `dispatch-ci`: workflow logic, not locally testable beyond `actionlint`-style lint and a contract test that the job has `statuses: write`, no checkout and a SHA-pinned `uses:`. The proof is live only: a commit status `validate` from integration 15368 on the head, written after the dispatched run completed, matching its conclusion. A failure case (dispatched `validate` red) is unprovable on a release head without forcing a red run; the plan must say whether that case is accepted as unproved.
   - Non-bypass token: live only, and #3070 says "whether an App-authored PR is still held is unmeasured". It needs its own pre-measurement before it can be chosen.
   - Controller approval: the `Build` port write and its refusals (`unaskable` on Bitbucket and Jenkins, pin to workflow/event/branch/SHA, provenance first) are locally testable with a fake port. The approval's effect is live only, and the 12 to 20 minute run makes the post-approval `checks-pending` refusal the expected first answer, which the test plan must name.

7. **Outcome B leaves a person decision without a recorded form.** Line 40 says the choice "goes into `### Decisions` before approval", but the plan has no `### Decisions` heading and no `### Tests` heading. An unattended Sonnet agent cannot build the slice until both exist.

## Amendments required

1. Replace step 3's reliance on `release-approve` with a GitHub-side reading that does not pass Plot's guard. Before any merge call, with `validate` green from the dispatched run and the held `pull_request` run unapproved, record:
   - `gh pr view <pr> --json headRefOid,mergeStateStatus,statusCheckRollup` (expect `BLOCKED` under B, `CLEAN` or `UNSTABLE` under A);
   - `gh api repos/plot-pm/plot/commits/<sha>/check-runs --jq '.check_runs[] | {name, app: .app.id, conclusion, check_suite: .check_suite.id}'` and `gh api repos/plot-pm/plot/commits/<sha>/status`;
   - `gh api repos/plot-pm/plot/actions/runs?head_sha=<sha> --jq '.workflow_runs[] | {id, event, status, conclusion, run_attempt, triggering_actor: .triggering_actor.login}'`.
   Then, if the merge is attempted, attempt it through a path with a head pin and no bypass, and record `gh api repos/plot-pm/plot/rulesets/rule-suites?ref=refs/heads/main` for that evaluation, which shows whether a bypass was applied. State that `plot-ask.mjs release-approve` answers `checks-missing` on this head after #3070, and that this answer is expected and is not the measurement.
2. Move the record into this plan as a `### CI Measurement` section with a `Record:` list (UTC timestamps, head SHA, each command's output, the merging identity and its bypass status), and name the person who runs it (jwloka) and the route (a docs commit to this plan on its idea branch before approval).
3. Rewrite Outcome A: this plan builds "Plot reads the dispatched check", widening #3070's checks rule to `validate` check runs from integration 15368 on the pinned head, with the domain test named in #3070 Tests line 140 and a Bitbucket `unaskable` case. Remove "which #3070 owns".
4. Add a third outcome: the reading is inconclusive (bypass applied, head moved, dispatched run not finished, or `mergeStateStatus` `UNKNOWN`). It ends in "measure again on the next release head", never in a mechanism choice.
5. Add `### Decisions` and `### Tests` headings now, with one `### Tests` block per mechanism stating what is local and what is live (finding 6), and the live-proof fields from #3070's `### Live proof` (non-person `triggering_actor`, `run_attempt` 1, `validate` on the head before `release-approve`).

## Decisions that need a person

- Whether the measurement may attempt a real merge of the 2.30.1 release PR, or reads `mergeStateStatus` and rule-suites only. A merge is irreversible, and under Outcome B the person must then approve the held run anyway to ship 2.30.1.
- Which mechanism to choose under Outcome B, and whether an unprovable red-path case (relay with a red dispatched `validate`) is accepted.
- Whether a ruleset change is in scope (plan Open Question 3); only an admin can make it.

## What I ran versus read

Ran (read-only): `gh issue view 3073`; `git show origin/main:docs/plans/2026-11-03-the-release-pr-needs-a-person.md`; `git show origin/main:packages/domain/src/workflows/release-approve.ts` (lines 105-160); `git grep` for `checks-missing` and `mergeAt` in `packages/domain/src`; `git show origin/main:skills/plot/scripts/plot-host.sh | grep` for the merge arm; `gh api repos/plot-pm/plot/rulesets/24412719`; `gh api repos/plot-pm/plot/collaborators/jwloka/permission`.

Read only: the plan file, the juror brief. I did not verify the rule-suites endpoint output or `mergeStateStatus` values on a live release head; the amendment names them as the sources to record, and their exact values on a held release PR are unmeasured.
