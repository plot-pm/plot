## Implementation brief — the-release-pr-needs-a-person (wave 2: Release guard)

- **Plan (canonical):** docs/plans/2026-11-03-the-release-pr-needs-a-person.md on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3070 merged
- **Branch:** `feature/the-release-checks-are-counted` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** PR review per repo convention (`plot/review` is required on main)

Wave 2 of 2. Wave 1 (`feature/the-release-review-is-switched-on`, PR #3175) is merged. The sibling in this wave, `feature/the-release-head-is-the-version-step`, owns `release-head-foreign` and touches the same files; the two branches share one wave and have no ordering between them.

### What to build

Release PR #2934 (release 2.30.0, head `14d28a09`) passed `plot-ask.mjs release-approve` while its `statusCheckRollup` held only `plot/review: success`. GitHub then refused the merge ("the base branch policy prohibits the merge"), because ruleset `24412719` requires `validate` and the held `pull_request` run had reported nothing. The same hold occurred on 2.29.1 (#2810) and 2.29.0 (#2452): 3 of the last 3 releases. The rollup folds `plot/review` alone to `green` (`plot-host.sh:709`, `workflows/merge.ts:203`), so no Plot rule saw the gap.

Build one domain rule, *the required `validate` check has a success on the pinned head in what GitHub counts*, and make two callers read it:

1. `releaseApprove` (`packages/domain/src/workflows/release-approve.ts`) refuses a new reason, `checks-missing`, before it calls `mergeAt`. Add it to `ReleaseApproveRefusal` and name the head and the reading in the detail text, as the sibling refusals do.
2. `releaseStage` (`packages/domain/src/rules/release-prepare.ts:211-222`) answers `ready` only when the same rule passes. A head whose only CI success is outside what GitHub counts reads `preparing`, so the board's release row never shows `ready` while the merge refuses.

"What GitHub counts" is, until plan #3076 measures otherwise, the PR's `statusCheckRollup` on the head with `plot/review` excluded. That reading already exists as `ci_checks_of` (`plot-host.sh:709`) and reaches `PrIndexRow.ciChecks` through `pr-list --rich` (`plot-host.sh:4783`). It does not reach `releaseApproveAt`: that function asks `host.prState` (`plot-host.sh:4071` GraphQL and the REST arm, `rest_pr_to_state`), whose payload carries `checks` and no `ciChecks`, and `prOf` in `adapters/host/host-shell.ts:100-118` maps no such field onto `Pr`. The slice must carry the CI-only reading through `pr-state`, `host-shell.ts` and the `Pr` entity (`entities/pr.ts`), or through a new narrow reading in `ReleaseApproveReadings`. Pick one and state it in the PR. Whichever you pick, a Bitbucket or Jenkins `pr-state` answers `unaskable` for the new reading and `release-approve` keeps its current behaviour there (plan, Scope).

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive

- **Two check questions, two readings.** *Was the head tested?* is `requiredChecks` (`release-prepare.ts:179-187`): any `CI` run on the head succeeded, including the dispatched `workflow_dispatch` run. The review start keeps that reading. *Will the merge count the check?* is the new rule. Do not replace the first with the second: the review waits on a tested head and the plan's guard tests assert it ("the release review is not started while the required workflow reads pending"; "the release review starts on a head whose dispatched CI run succeeded").
- **Do not decide whether a dispatched `validate` alone satisfies the ruleset.** The plan measured it as unknown: no merge was attempted between 14:47:21Z (dispatched run green) and 14:47:31Z (held run approved). Plan #3076 (issue #3073) measures it on the 2.30.1 head and picks the CI mechanism. This slice builds Plot's guard on the rollup only. Do not read the dispatched check run's own check suite (`112877067409`; both suites on the head report `pull_requests: []`) to make the rule pass.
- **No controller approves the held run.** The plan dropped that option (Decision 2). Do not add `gh api .../actions/runs/<id>/approve`.
- **Do not edit `.github/workflows/ci.yml` or `release.yml`.** Their comments that claim the dispatched run makes the required check report are corrected by plan #3076 with the measured outcome.
- **Where the required check names come from is this slice's call.** The plan's open question: the ruleset's required status checks read through `plot-host.sh`, or a config key. A ruleset read is a new connector op and pays the shell-lines ratchet. A name constant or config key in the domain rule costs no shell. State the choice in the PR description. Note that `ci_checks_of` folds every non-`plot/review` item to one word, so `ciChecks: green` does not name `validate`; if the rule must name it, the reading needs the item names, not only the colour.
- **Absent is not green.** A `none`, `unknown` or missing CI-only reading refuses `checks-missing` (or `unaskable` where the host did not answer), never passes. A reading that cannot be read is not a pass.
- **Facts are measured, not guessed:** cite the plan's figures (2.30.0 head `14d28a09`, 2.29.1 `46a92390`, 2.29.0 `d7c65b08`) in the commit message; do not re-measure them.

### Done when

The plan's `## Design` tests for this slice are the specification. Each fails before the change and passes after, except the controls and guards:

- `packages/domain/test/workflows-release-approve.test.ts`: "a release PR whose rollup holds only plot/review success refuses checks-missing" (passes `merge.ts:203` today); control: "a release PR whose required validate succeeded on the pinned head passes the checks rule".
- `packages/domain/test/release-prepare.test.ts`: "a head whose only CI success is outside what GitHub counts reads preparing, not ready" (reads `ready` today); guards: "the release review is not started while the required workflow reads pending" and "the release review starts on a head whose dispatched CI run succeeded".
- `test/reconcile/host.test.mjs`, only if `pr-state` gains the rollup's CI checks: "pr-state reports the rollup's checks without plot/review", with a Bitbucket case that keeps its current answer.

A naive implementation that adds the refusal in `releaseApprove` and leaves `releaseStage` unchanged passes the first pair and fails only the `release-prepare` test, so that test is the one that proves the board and the merge cannot disagree. A naive implementation that makes `releaseStage` read the new rule for the review start too passes the stage test and fails the two guards.

Plus: a changeset for `plot` with the description first and the `bumps:` block last (`./scripts/check-changeset-packages.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. If the slice touches `plot-host.sh`, `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base: pay for growth in the same change, by removing shell elsewhere or by writing the rule in the domain. The gate counts commands, not lines, and has no override. If you change `plot-host.sh`, the contract tests and `scripts/check-host-cli-callers.sh` apply.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). When it exists, append `→ #<number>` to this branch's line under `## Slices` in the plan. Push the first real commit as soon as it exists. The functions you write are arrows. A TSDoc block states what an export does, takes, returns and how it fails; the reasoning goes in the commit message.

### Scope guard

Owns: `packages/domain/src/workflows/release-approve.ts`, `packages/domain/src/rules/release-prepare.ts` (the `releaseStage` rule only), the `pr-state` reading path if you choose to carry the CI-only checks through it (`skills/plot/scripts/plot-host.sh`, `packages/domain/src/adapters/host/host-shell.ts`, `packages/domain/src/entities/pr.ts`), the board's release-stage reader if it needs the new reading, their tests, and one changeset.

The sibling branch `feature/the-release-head-is-the-version-step` (not yet started; `git ls-remote` finds no ref for it at brief time) edits the same two domain files for `release-head-foreign`. Keep your edit to the checks rule so a rebase onto the sibling is a small conflict. Do not add `release-head-foreign` here. Do not touch `release-tick.ts`, `registryd-main.ts`, `CLAUDE.md` or `AGENTS.md`: wave 1 owned them and it is merged.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
