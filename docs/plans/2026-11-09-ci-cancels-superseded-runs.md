# CI cancels a pull request's superseded run

> A push to a pull request cancels that pull request's CI run on the older head, so the runners go to the newest head and a sprint PR's checks no longer wait behind runs nobody reads.

## Status

- **State:** Draft
- **Type:** infra
- **Story:** nothing-changed-nothing-runs
- **Review:** pr
- **Impl:** own branches

## Changelog

- A new push to a pull request cancels CI still running on its older head. Runs on `main` and the release dispatch keep their current behaviour.

Board impact: none. The board reads check results per head SHA, and this plan changes no plan format, template, helper script or `docs/plans` layout.

## Motivation

On 2026-11-09 the sprint PR #3277 took eight pushes in about 40 minutes: five delivery commits, the sprint close and three story edits. Each push started a full CI run, and none of the eight was cancelled when the next push superseded it. The run on the current head (42602121182) then sat with `checks`, `corpus`, `helper-contracts` and `board-integration` queued until a person cancelled the eight older runs by hand. A full run holds about seven runners for about 25 minutes (the census halves run 12.5 minutes each after `checks`).

`ci.yml:57-68` gives every non-dispatched run its own concurrency group (`github.run_id`), on purpose: "a `main` push run and a pull request run are never cancelled. A group keyed on `github.ref` would cancel pull request runs against each other". `test/reconcile/release-pr-ci.test.mjs` holds that decision in two rows ("isolates every other run", "no concurrency group in ci.yml is keyed on the ref"), added by #1227 on 2026-10-03.

For a pull request, `github.ref` is `refs/pull/<n>/merge`, so a ref-keyed group would only group runs of the same pull request. The release PR is the case the comment protects: `changeset-release/main` gets a `pull_request` run and a dispatched run (`ci.yml:20-50`), and the `pull_request` run's `validate` is the one the ruleset counts once a person approves (2.31.0, #3080). This plan keeps that run whole.

## Design

### Approach

- **One group per pull request, for `pull_request` runs only.** The group becomes `ci-${{ github.event_name == 'workflow_dispatch' && 'release-dispatch' || github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || github.run_id }}`, with `cancel-in-progress: true`. A push to `main` keeps its own group (`github.run_id`) and is never cancelled; every dispatched run keeps sharing `release-dispatch`.
- **The release PR is not grouped.** Its `pull_request` run stays isolated (a group on `github.run_id` when `github.head_ref` is `changeset-release/main`), so a regeneration push never cancels the run whose `validate` the ruleset counts. Whether the release PR needs this exception is Open Question 1.
- **No group names the ref.** The group keys on the pull request number, not `github.ref`, so the existing row "no concurrency group in ci.yml is keyed on the ref" stays as it is.
- **The contract test changes with the decision.** The row "isolates every other run" becomes three rows: a `main` push run gets its own group; a `pull_request` run shares one group per pull request number; the release PR's `pull_request` run gets its own group. A copy of `ci.yml` that drops any of the three is refused. The comment at `ci.yml:57-65` is rewritten to state the new rule and why the release PR stays out.
- **A cancelled superseded run must not read as a timeout.** `runWasTimedOut` (`packages/domain/src/rules/checks-verdict.ts`) reads a `cancelled` job that ran 5 minutes or more (`MIN_TIMEOUT_MS`) as a `timeout-minutes` cap. A superseded run is now cancelled at any age, up to about 25 minutes. The slice checks which callers read runs of a head other than the pull request's current head, and states the result. Open Question 2.

### Open Questions

- [ ] Does the release PR need its own exception, or does its `pull_request` run never receive a second push while a person approves it? `release.yml` force-pushes `changeset-release/main` on every regeneration, so a regeneration during approval would cancel the run the ruleset counts.
- [ ] Does any reader of check results (`checks-verdict.ts`, the fixer, the merge arm, `plot-ask merge`) read a run on a head other than the pull request's current head? If one does, a superseded run cancelled after 5 minutes reads as a timeout there. The slice either shows no reader does, or makes `runWasTimedOut` tell a superseded run from a capped one (for example by the run's head SHA against the pull request's head).

## Done when

| Claim | Check | Slice |
|---|---|---|
| A second push to a pull request cancels the run on the older head | `release-pr-ci.test.mjs`: the group for a `pull_request` run is keyed on the pull request number with `cancel-in-progress: true` | Cancel |
| A `main` push run is never cancelled | the same test: a `push` run's group is `github.run_id` | Cancel |
| The release PR's counted run is never cancelled | the same test: a `pull_request` run on `changeset-release/main` gets its own group | Cancel |
| No group is keyed on the ref | the existing row stays green | Cancel |
| A superseded run does not read as a timeout | a `checks-verdict` row: a run cancelled 20 minutes in, on a head other than the PR's head, reads as superseded | Cancel |

## Slices

### Cancel

- `infra/ci-cancels-superseded-runs` — the per-PR concurrency group in `.github/workflows/ci.yml` with the release-PR exception, the rewritten comment, the contract rows in `test/reconcile/release-pr-ci.test.mjs`, and the timeout reading in `checks-verdict.ts` if Open Question 2 needs it <!-- builds: a per-pull-request CI concurrency group -->

## Notes

- Found on 2026-11-09 while merging sprint PR #3277: eight superseded runs (42598470064 through 42599385716) held the runners until cancelled by hand.
- Definition of Done: docs/definition-of-done.md.
