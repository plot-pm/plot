# Moderation — the-release-pr-is-checked-before-it-merges, round 1

Subject: `docs/plans/2026-10-01-the-release-pr-is-checked-before-it-merges.md` at `4fe88a8d` (#1040, Draft), read on `origin/main` `385d6d7d`.

Gate: `unanimous amend skeptic,security,operator`. Each of the three verdict files names exactly one position, `amend`.

## What each juror executed and read

| Juror | Executed (read-only) | Read |
|---|---|---|
| skeptic | `gh run list` on the branch; the Actions runs API with `event=push` (0), `event=workflow_dispatch` (0) and 100 runs grouped by event; `branches/main/protection`; check-runs on heads `3141b813` and `83df5e92`; `gh run view 36867809129`; `gh pr list --head changeset-release/main` | the plan, `ci.yml`, `release.yml`, `ci-scheme.test.mjs`, #1040 |
| security | `gh api` on `branches/main/protection`, `branches/changeset-release%2Fmain/protection` (404), `rulesets`, `actions/permissions/workflow` (`default_workflow_permissions: read`) | the plan, `ci.yml`, `release.yml`, #1040 |
| operator | the Actions runs API (100 runs), check-suites for `83df5e92`, the required-status-checks API, `gh pr list --head changeset-release/main` | the plan, `ci.yml`, `release.yml`, `plot-release/SKILL.md`, #1040 |

## Agreed

- The mechanism is right: a `GITHUB_TOKEN` push starts no workflow, and `workflow_dispatch` is the documented exception. All three confirm 0 push runs on the branch.
- The required check is `validate`, bound to app 15368 (GitHub Actions), `strict: false`, so a dispatched run on the head SHA can satisfy it.
- The dispatch step must name its token for `gh` (skeptic, security, operator).
- The Done-when proof can only exist after a merge; the plan must say what happens when it fails (skeptic, operator).

## Required changes, by juror

- skeptic: move the test out of `ci-scheme.test.mjs` into a new file and say how it reads YAML; fail the job when the dispatch fails; name a fallback if the dispatched run is also held; drop or explain the "2 ended failure" line.
- security: a separate dispatch job with `actions: write` only and no checkout; pin the expected head SHA as a dispatch input; accept dispatched runs only on `refs/heads/changeset-release/main`; top-level `permissions: contents: read` in `ci.yml`; keep every action SHA-pinned; state that the per-run approval goes away.
- operator: a `concurrency:` group that cancels superseded release runs and never cancels `main` push runs; rewrite the last Done-when as a post-merge action that reopens #1040; write the operator's release step in one named place; print the dispatched SHA.

## Disagreements

None in substance. Two places offer a choice, and the amendment settles each toward the safer form:

- **Fallback.** The skeptic offers a PAT or App token, or gating the tag. The amendment picks gating the tag, because it adds no stored credential with write scope.
- **Token placement.** The skeptic accepts `actions: write` beside the release job's three permissions; security requires a separate job. The amendment takes the separate job.

## Shared blind spot

No juror asked how the dispatch job learns the head SHA without a checkout. The amendment answers it: the release job reads the SHA from the local ref `changesets/action` committed and pushed, and passes it through a job output. No juror measured whether a bot-actor `workflow_dispatch` run is itself held; that stays the open risk the fallback covers.

## What an amendment changes

The plan gains a second job in `release.yml`, an SHA-and-ref guard and a `concurrency:` group in `ci.yml`, a top-level read-only permission, a new test file, a written operator release step in `RELEASING.md`, and a post-merge Done-when that reopens #1040 on failure. The slice stays one branch.
