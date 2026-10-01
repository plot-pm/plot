# Round 1 — skeptic who measures

Executed (read-only): `git fetch origin main`; read the plan, `.github/workflows/ci.yml`, `release.yml` and `test/reconcile/ci-scheme.test.mjs` from `origin/main`; `gh issue view 1040 --comments`; `gh run list --branch changeset-release/main --limit 15`; `actions/runs?branch=changeset-release/main` with `event=push`, `event=workflow_dispatch` and per_page=100 grouped by event; `branches/main/protection`; check-runs on heads `3141b813` and `83df5e92`; `gh run view 36867809129`; `gh pr list --head changeset-release/main`.

Position: amend

## 1. Does it fix the issue

Yes. #1040 lists `repository_dispatch` among its candidates; `workflow_dispatch` is the same documented exception to the GITHUB_TOKEN no-recursion rule. It also answers the issue's request to rewrite the `ci.yml` comment. It does not address the issue's drift point (a release branch behind main), but a check on the tip covers that.

## 2. Claims checked

- `ci.yml:21` reads `branches: [main, changeset-release/main]`. True.
- `ci.yml:960-961`: `Check for changeset` / `if: github.event_name == 'pull_request'`. True. It is the only event-dependent expression in the file, so a dispatched run takes the same path as a push run.
- `release.yml:99-108` is the changesets step with `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. True.
- Runs on the branch: 100 of the last 100 are `pull_request`. `event=push` total_count 0. `event=workflow_dispatch` total_count 0. True.
- Protection: `checks: [{context: "validate", app_id: 15368}]`, the GitHub Actions app, with `enforce_admins: false`. The job has no `name:`, so its check-run name is `validate`. A dispatched run's check run is created by app 15368 on the head SHA, so it matches.
- No conflicting check: head `3141b813` (action_required) carries 0 check runs, and the `failure` run on `83df5e92` has 0 jobs. Nothing older can shadow a dispatched `validate`.
- `pullRequestNumber` is set on updates as well as on creation: PRs #1160, #1135, #1121 and #1047 all carry the assignee that the step gated on the same output adds.

## 3. Done-when

Items 2 and 3 fail today and pass after the fix. Item 1 can be proven only by the next release. Item 4 covers that honestly.

## 4. Required changes

1. **The test has the wrong home.** `test/reconcile/ci-scheme.test.mjs` tests `ci_scheme`/`ci_instance` parsing of the `CI:` config key, and its header says it is a separate file so that it stays scoped to that slice. Name a new file, e.g. `test/reconcile/release-pr-ci.test.mjs`. Say how it reads YAML: a text match, or a named parser that is already a dependency.
2. **Name the token for `gh`.** The step needs `env: GH_TOKEN: ${{ github.token }}` (or `GITHUB_TOKEN`, as `release.yml:114` does). The job-level `permissions` block replaces the defaults, so `actions: write` must be added beside the existing three. The plan says this, but the test should assert both the env and the permission.
3. **State the failure behaviour.** If `gh workflow run` fails, the release PR is already updated. Say whether the step fails the job (preferred: it is the only signal) or warns.
4. **Name the fallback when the dispatched run is also held.** Bot-actor approval gating on `workflow_dispatch` has not been measured on this repo. Item 4 records a reason but names no next step. Name one: a PAT/App token, or the issue's "gate the tag" option.
5. Explain or drop the "2 ended `failure`" line. Both are 0-job runs on heads of merged PRs, so they are not CI failures.
