# Seams juror: the-release-head-reports-validate-with

Position: amend

Lens: the edges between this plan and GitHub's rule for bot-triggered runs, `workflow_dispatch` versus `pull_request` check reporting, ruleset `24412719`, plan #3070's `checks-missing` and `release-head-foreign`, and the release skill and docs. Context given by the caller: this plan is not a sprint `follow-ups-2-30-1` item; it starts after release 2.30.1, because its first step is a measurement on the 2.30.1 release head.

## Findings

### S1 (HIGH): #3070's own guard blocks the measurement this plan depends on

The plan's Approach (line 37) adopts #3070's procedure: wait for the dispatched `validate`, do not approve the held run, run `plot-ask.mjs release-approve`, and record Plot's answer and GitHub's answer.

#3070 (origin/main, `docs/plans/2026-11-03-the-release-pr-needs-a-person.md`, Approach "Two check questions") makes `releaseApprove` refuse `checks-missing` **before it calls `mergeAt`** when `validate` has no success in the PR's `statusCheckRollup` excluding `plot/review`. On 2.30.0, the dispatched check run was absent from the rollup: both check suites reported `pull_requests: []`, and `validate` appeared only after the held run was approved (#3070 Motivation). The plan's own line 31 says that 2.30.1 cannot be cut while #3070 is unfinished, so `feature/the-release-checks-are-counted` is on main when the measurement runs.

The result: on the 2.30.1 head, step 3 refuses `checks-missing` inside Plot, and GitHub is never asked. The procedure cannot tell Outcome A from Outcome B. The record will hold Plot's refusal and no GitHub answer, and line 46's Open Question cannot be closed.

No sanctioned route asks GitHub to merge the release PR. `plot-ask.mjs merge` refuses a release PR with `release-pr` (CLAUDE.md, "The Master Agent Uses The Controllers"). A bare `gh pr merge` passes the gate only with `--match-head-commit`, and the controller rule forbids it in any case.

### S2 (HIGH): nobody owns Outcome A

Line 39: "the slice closes as 'Plot reads the dispatched check', which #3070 owns." #3070's Notes on origin/main say the opposite: "The CI mechanism is not a slice of this plan … The measurement and the mechanism move to #3073." #3070's Slices hold no CI slice. Its only CI test, "a head whose only validate is a dispatched check run passes the checks rule", sits under "The CI slice", which #3070 no longer has.

So on Outcome A, the ruleset accepts the dispatched check, but #3070's `checks-missing` keeps refusing it, because #3070 reads only the rollup. Every release then refuses inside Plot until someone widens the reader. That widening is a domain change to the rule `releaseApprove` and `releaseStage` share. It needs the test above. It also needs one host read of the head's check runs by name and integration, which is a `plot-host.sh` op and pays the shell-lines ratchet. This plan must own it.

### S3 (MEDIUM): duties that #3070 gave to "the CI slice" have no owner

#3070 still assigns three items to a CI slice that it moved here. This plan names none of them:

- `.github/workflows/ci.yml:30-33` says that the dispatched run "creates its check runs under the job name `validate`, which is the context the branch protection requires, so the required check reports". 2.30.0 contradicts the "reports" half. #3070's "Docs and comments" says that the CI slice corrects it.
- `.github/workflows/release.yml:141-159`, the `dispatch-ci` header comment, states the same belief. Same owner.
- #3070's "Live proof" ends: "The CI slice is delivered only after this record exists." The plan does not inherit this check.

#3070's Changelog bullet 4 still claims "The release PR reports `validate` on its head with no person approving a CI run". This plan's Changelog (line 17) claims the same outcome. One release note would then ship twice, or ship in 2.30.1 before the mechanism exists. One of the two plans must drop the line, and it must be #3070's.

### S4 (MEDIUM): a GitHub refusal does not prove Outcome B

Ruleset `24412719` (read with `gh api repos/plot-pm/plot/rulesets/24412719`) has more than the two required checks:

- `pull_request` with `require_extra_approval_for_unattributed_changes: true`. The plan does not name this parameter, and no doc in the repo names it (git grep finds no hit outside unrelated panel prose). The release PR's commits are pushed by `github-actions[bot]` through `GITHUB_TOKEN` (`release.yml:116-123`), so this rule may well apply to it.
- `required_status_checks` for `validate` (integration 15368) and `plot/review` (integration 5317669), with `strict_required_status_checks_policy: false`.
- Bypass actors: RepositoryRole 5 (admin), `always`; Integration 5173644 (`plot-build`), `always`.

GitHub's 2.30.0 refusal, "the base branch policy prohibits the merge", does not say which rule failed. If the extra-approval rule refuses, the measurement reads Outcome B, and the person then builds a relay, a token or an approval controller that cannot fix it. The record must hold the host's full refusal text, or the `mergeStateStatus` with the rule violations listed. Outcome B counts only when `validate` is the named cause.

### S5 (MEDIUM): the merging identity changes inside the same sprint

`plot-host.sh pr-merge` (origin/main `:4418-4440`) merges as the `Merger app` when one is declared. Without one, it merges as the signed-in `gh` identity. Plan `fleetd-merges-no-slice-pr-while` (#3063, same sprint) declares a non-bypass Merger App. So 2.30.1's `release-approve` may merge as that App, or as jwloka, who is an admin and therefore a bypass actor. The two identities can get different answers from the ruleset: GitHub's `gh pr merge` without `--admin` refuses a bypass actor until requirements hold, while the App never bypasses. The record must name the identity, and the result holds only for that identity.

### S6 (LOW): candidate details that the plan inherits by reference and does not restate

The plan names the three mechanisms in one line each (lines 27-29) and relies on #3070's text for their constraints. Two seams in that text remain open:

- **Relay:** `release.yml` has `concurrency: cancel-in-progress: false` for each ref. A relay job that waits 12 to 20 minutes for the dispatched run therefore delays the next `main` push's release run, which also does the stable publish. `ci.yml`'s `release-dispatch` group cancels a superseded dispatched run, and #3070 does not say what the relay writes for a cancelled run: a timeout writes nothing, but a cancellation is not a timeout. Whether a commit status made with `GITHUB_TOKEN` matches a required check pinned to integration 15368 is also unmeasured.
- **Non-bypass token:** the plan does not say whether an App-authored PR is held at `action_required`. #3070 calls this unmeasured. It is a second measurement and not a choice.

### S7 (LOW): host scope is unstated

The plan names no host. #3070's Scope says "GitHub only", and that a Bitbucket repository's release PR gets no change. The Changelog line (17) is generic. A Bitbucket reader cannot tell whether this change touches its arm.

### Rubric answers

1. **Fixes the defect, moves the sprint?** In intent, yes: the person approval of the held run is one of the three interventions per release that the sprint counts. As written, the plan cannot reach either outcome (S1). On Outcome A it builds nothing, and the release still refuses (S2). A reader verifies the fix with #3070's Live proof: no `pull_request` run has a person-started `run_attempt` above 1, and `validate` is in the rollup on the pinned head before `release-approve`.
2. **Claims true?** Line 23 ("GitHub does not count the dispatched run's `validate` check run in the PR's rollup") is true for the rollup. The ruleset's view is unmeasured, and the plan says so correctly. Line 39 ("which #3070 owns") is false against #3070's Notes (S2). Line 31 is true.
3. **What it breaks or leaves half done:** the comment corrections in `ci.yml` and `release.yml`, the Live proof check, and the duplicate Changelog bullet (S3). On Outcome A: the shared `releaseApprove` / `releaseStage` rule, a `plot-host.sh` read and the shell-lines ratchet (S2). Bash 3.2 and the Bitbucket arm are untouched until a mechanism is chosen.
4. **Failure modes:** a Plot refusal that masks GitHub's answer (S1); a GitHub refusal from a rule other than `validate` that reads as Outcome B (S4); an identity-specific result (S5). None of these ends in a named refusal today. Each one ends in a wrong record.
5. **Can unattended Sonnet build it?** No, and the plan says so: the slice is unscoped until a person chooses. That is correct for a Draft. Decisions that belong to a person: the measurement route (S1), the mechanism on Outcome B, and any ruleset change.
6. **Test plan:** none. On Outcome A, the plan needs #3070's orphaned test. On B, it needs a recorded live measurement for each mechanism, because no local suite reads workflow files or the ruleset.

## Amendments required

1. **Give the measurement a route to GitHub's answer that #3070's guard does not intercept.** A person picks one of these routes:
   (a) run the measurement on a `changeset-release/main` head before `feature/the-release-checks-are-counted` merges. The measurement then does not wait for 2.30.1, and the plan's start condition changes to "before #3070's checks slice merges".
   (b) as a read that merges nothing, record `plot-host.sh pr-state <pr>`'s `mergeStateStatus` (already read at `plot-host.sh:4087`) after the dispatched `validate` succeeds and `plot/review` is present, then record GitHub's merge-rule violations for the head. This needs a check that `mergeStateStatus` is not computed for a bypass viewer.
   (c) give `release-approve` a person-only measurement mode that skips `checks-missing` and is refused under `PLOT_UNATTENDED=1`. This mode is a new controller surface and needs its own decision.
   State the route in Approach, and state which Plot code is on main at the time.
2. **Own Outcome A.** Replace "which #3070 owns" with a slice in this plan, with this scope: widen "what GitHub counts" to the head's check runs named `validate` from integration 15368, in the one rule that `releaseApprove` and `releaseStage` share. Carry the test "a head whose only validate is a dispatched check run passes the checks rule". Name the `plot-host.sh` read and its shell-lines cost.
3. **Take over #3070's orphaned duties**, under a `### Docs and comments` heading and a `### Live proof` heading: the `ci.yml:30-33` and `release.yml:141-159` corrections and the Live proof delivery check. Amend #3070 to drop its Changelog bullet 4 and its "CI slice" references, so that one plan claims the outcome.
4. **Define what counts as Outcome B.** The record holds the host's full refusal text, or the rule violations, and the merging identity (Merger App or person). Outcome B counts only when `validate` is the named violation. Any other violation (for example `require_extra_approval_for_unattributed_changes`) is its own finding and not a reason to choose a mechanism.
5. **State the scope:** GitHub only. A Bitbucket release PR gets no change, as in #3070.
6. The plan's Approach refers to a `### Decisions` heading that does not exist. Add the heading, empty, so that the later edit has a place to go.

## Decisions that need a person

- The measurement route in amendment 1. Route (c) adds a controller surface. Route (a) changes when this plan starts.
- The mechanism on Outcome B, and whether it needs a ruleset change. Only a repository admin can change ruleset `24412719`.
- Whether `require_extra_approval_for_unattributed_changes` stays on. If it applies to the bot-pushed release PR, no CI mechanism removes the person.

## Ran versus read

Ran (read-only):

- `gh issue view 3073`
- `gh api repos/plot-pm/plot/rulesets/24412719`: enforcement, bypass actors, rules
- `gh pr list --head changeset-release/main --state open`: no open release PR now
- `gh pr view 3076`: the plan PR holds the plan file and its active symlink only
- `git show` / `git grep` on origin/main: #3070's plan, `.github/workflows/release.yml`, `.github/workflows/ci.yml`, `plot-host.sh` `pr-merge` (`:4418-4440`) and `pr-state` (`:4087`), `release-approve.ts`, the sprint file, the `fleetd-merges-no-slice-pr-while` plan, `scripts/check-plan-headings.sh`

Only read, not executed: the GitHub semantics of `require_extra_approval_for_unattributed_changes`; whether a ruleset accepts a check run whose suite carries `pull_requests: []`; whether `mergeStateStatus` respects bypass; whether a `GITHUB_TOKEN` commit status matches integration 15368. Each one is an open question for the live measurement, and this juror did not measure it.
