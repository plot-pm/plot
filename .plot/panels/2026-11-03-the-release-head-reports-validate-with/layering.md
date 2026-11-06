# Layering juror: the-release-head-reports-validate-with

Position: amend

Scope note: this plan is not in sprint `follow-ups-2-30-1`. It starts after release 2.30.1, because its first step is the measurement on the 2.30.1 release head. I judged it against that schedule, and against the sprint goal of zero interventions only as the end state it serves.

## Summary

The plan keeps the measurement apart from the build in one respect: the record lives in #3070's `### CI Measurement`, and this plan stays Draft until the record exists (plan:46, plan:59). That separation is correct. But the plan names the three candidate mechanisms only by the parent's labels and never says where each one lives. A live read of the `main` ruleset shows that this is not a free choice. The required `validate` context is pinned to one integration. That fact rules out one placement, and the plan must record it before a person chooses. Two ownership hand-offs between this plan and #3070 also point at each other, and the result is that nobody owns "Plot reads the dispatched check" or the comment corrections.

## Findings

1. **The ruleset pins `validate` to the GitHub Actions app, so a relayed status must come from a workflow, never from Plot.** `gh api repos/{owner}/{repo}/rulesets/24412719` returns `required_status_checks: [{context: "validate", integration_id: 15368}, {context: "plot/review", integration_id: 5317669}]`. Plot's only status write, `plot-host.sh commit-status` (`plot-host.sh:6043-6058`), goes through `plot-commit-status.mjs`, which writes as the Review App installation (5317669). A `validate` status written through `Host.commitStatus` (`ports/host.ts:395`) therefore does not satisfy the ruleset. Mechanism 1 can live only in a workflow that writes with `GITHUB_TOKEN` (integration 15368). The plan does not state this, and an unattended agent that reads "a status relayed" next to Plot's existing `commitStatus` port is likely to choose the wrong layer.

2. **"Relayed from the `dispatch-ci` job" names a job that cannot relay.** `release.yml:160-180`: `dispatch-ci` runs `gh workflow run ci.yml` and exits. It does not wait for the dispatched run, so it holds no result to relay. A relay needs either a final job in `ci.yml` on the `workflow_dispatch` event, or a `workflow_run`-triggered workflow. Both need `statuses: write`. `ci.yml:50` pins `permissions: contents: read`, and its comment says "neither writes anything back". The plan copies the parent's label (plan:27) and does not name the job, the event or the permission change.

3. **The non-bypass token reverses a recorded decision in `release.yml`.** `release.yml:46-49` says the `release` job is "UNCHANGED, and deliberately without `actions: write` ... widening it was the rejected alternative", because that job runs `changesets/action`, `pnpm install` and `create-release.sh` and publishes to npm. Mechanism 2 puts a second credential (a PAT or an App token) into exactly that job (`release.yml:113-121`, `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`). The plan lists the token without this cost. #3070 says it "names three candidate mechanisms with their costs", but this plan does not carry the costs over, and the person who chooses reads this plan.

4. **A controller that approves the held run is a CI-system write, and it belongs on the `Build` connector, not on `plot-host.sh`.** `ports/build.ts:20-35` says "A CI SYSTEM IS NOT A GIT HOST" and "EVERY IMPLEMENTATION IS A CONNECTOR"; the port has three read operations today. `plot-host.sh`'s `runs` arm (`plot-host.sh:4985-5020`) dispatches on `CI`, not on `Git host`. `POST /repos/{owner}/{repo}/actions/runs/{id}/approve` is a GitHub Actions call. If mechanism 3 is chosen, it adds the first write to `Build`, with its own refusal for a CI system that has no held-run concept (Jenkins), and it pays the shell-lines ratchet (`scripts/check-shell-lines.sh`) if it lands as a `plot-host.sh` arm. It also changes `releaseApprove` (`workflows/release-approve.ts`) from one pinned act into a wait of up to the `validate` run's 25-minute ceiling (`ci.yml` concurrency comment), or it moves the approval to fleetd's release tick (`packages/fleet/src/shared/release-tick.ts`). The plan names none of this. Also note: approving the held run is the person act the issue asks to remove. A controller that does it on the person's `release-approve` call keeps one person act. A fleetd tick that does it unattended moves an approval of a bot-authored run to an unattended caller, and `releaseApprove` refuses `unattended` (`release-approve.ts:71-73`). That is a decision for a person, not for the slice agent.

5. **Outcome A hands the work to #3070, and #3070 hands it back.** Plan:39 says Outcome A "closes as 'Plot reads the dispatched check', which #3070 owns". #3070 on origin/main, `## Slices`: "The CI mechanism is not a slice of this plan ... The measurement and the mechanism move to #3073". #3070:140 still lists the test "a head whose only validate is a dispatched check run passes the checks rule" under "The CI slice", and #3070:157 says "The CI slice is delivered only after this record exists". No slice in #3070 builds it. In Outcome A, this plan's one slice has nothing to build and a branch with no change cannot open a PR.

6. **The comment corrections are orphaned.** #3070 assigns `ci.yml:30-33` ("so the required check reports") and `release.yml:141-159` (the `dispatch-ci` header comment) to "the CI slice". Both line ranges are correct on origin/main. That slice now lives here, and this plan does not list them. Both comments state a belief the measurement tests, so they are part of whichever mechanism lands, Outcome A included.

7. **The slice mixes the build with the proof.** Plan:54 says the slice is "proved on a live release head". A change to `release.yml` or `ci.yml` takes effect only after it merges to `main`, and a live release head exists only at the next release. The slice PR cannot carry that proof. #3070 already models this correctly as a `### Live proof` that gates delivery, not the slice. This plan should do the same, so that the slice agent builds and tests what a local suite can test and the person records the live proof after merge.

8. **The 2.30.0 head is consistent with the plan's facts.** Read on `14d28a09` (PR #2934): two `validate` check runs from app `github-actions`, one at 14:47:18Z (the `workflow_dispatch` run 41655186640, `triggering_actor: github-actions[bot]`) and one at 14:59:56Z (the `pull_request` run 41655170108, `run_attempt: 2`, `triggering_actor: jwloka`). The merge followed at 15:00:24Z by jwloka. This matches "showed `validate` only after a person approved the held run" (plan:23). Both check runs carry integration 15368, so the open question is not which app wrote `validate` but whether GitHub counts a check run from a dispatched suite for the PR. The measurement answers that; the plan is right not to guess.

9. **The measurement is itself the release merge.** Step 3 runs `plot-ask.mjs release-approve`, which merges through `mergeAt` on a pass. In Outcome A the measurement merges 2.30.1. In Outcome B, 2.30.1 still needs the held-run approval by a person to merge. The plan should say both, so the person knows the measurement does not cost a second release.

## Amendments required

1. Add a `### Where each mechanism lives` table to `## Design`, one row per candidate: the file and job (or port and adapter), the credential, the permission change, and the cost. Relay: a job in a workflow writing with `GITHUB_TOKEN`, `statuses: write` added to that one job, never `Host.commitStatus`. Token: a secret in `release.yml`'s `release` job, which reverses `release.yml:46-49`. Approval: a write on the `Build` port and its GitHub Actions connector, not a `Host` or `plot-host.sh` git-host op, with a named refusal for a CI system that has no held run.
2. State the ruleset fact in `## Motivation` or `## Design`: `validate` is required from integration 15368 and `plot/review` from 5317669, read on 2026-11-03 from ruleset 24412719.
3. Fix Outcome A's owner. Either this plan owns "Plot reads the dispatched check" and its test (moved from #3070:140), or #3070 gains a slice for it. Name one. Then file the matching correction to #3070's `### Tests`, `### Docs and comments` and `### Live proof` lines that still say "the CI slice".
4. List `ci.yml:30-33` and `release.yml:141-159` in this plan's slice for every outcome.
5. Move "proved on a live release head" from the slice line to a `### Live proof` subsection that gates delivery, as #3070 does.
6. Say in `### Approach` that the measurement merges 2.30.1 in Outcome A, and that 2.30.1 waits for a person's held-run approval in Outcome B.

## Decisions for a person

- Which mechanism to build (plan Open Question 2), with the costs in amendment 1 in front of them.
- For mechanism 3: whether the run approval is made on the person's `release-approve` call or by fleetd unattended. The second moves approval of a bot-authored run to an unattended caller.
- For mechanism 2: whether to reverse the `release.yml:46-49` decision and put a second credential in the npm-publishing job.
- Whether a ruleset change is needed (plan Open Question 3); only a repository admin can make it, and finding 1 shows the integration pin is part of that change.

## Ran versus read

Ran (read-only): `gh issue view 3073`; `git show origin/main:` for `release.yml`, `ci.yml`, `plot-host.sh`, `ports/host.ts`, `ports/build.ts`, `workflows/release-approve.ts`, `workflows/merge.ts`, `release-tick.ts`, `plot-commit-status.mjs` and the #3070 plan; `gh pr view 2934 --json statusCheckRollup`; `gh api` for ruleset 24412719, the check runs on `14d28a09`, and the Actions runs for that head. No host write, no fleet or board command, no test suite.

Read only: the slice's eventual code, which does not exist yet. I did not verify whether GitHub counts a dispatched suite's check run for a PR; that is the measurement's job.
