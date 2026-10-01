# Round 1 — CI and supply-chain security

Executed: `git fetch origin main`; read the plan, `release.yml` and `ci.yml` from origin/main; `gh issue view 1040 --comments`; `gh api` (read-only) on `branches/main/protection`, `branches/changeset-release%2Fmain/protection`, `rulesets`, `actions/permissions/workflow`.

Position: amend

## 1. Does it fix #1040?

Yes, for the mechanism: `GITHUB_TOKEN` events start no workflow except `workflow_dispatch`/`repository_dispatch`, so a dispatched run is the one route that reports without a person. It misses the security consequences below.

## 2. Claims checked

- `ci.yml:21` — `branches: [main, changeset-release/main]`. True.
- `release.yml:101-108` — `uses: changesets/action@a45c4d59… # v1.9.0` with `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. True.
- `ci.yml:960-961` — `name: Check for changeset` / `if: github.event_name == 'pull_request'`. True.
- `release.yml:42-45` — `contents: write`, `pull-requests: write`, `id-token: write`. Adding `actions: write` here is the actual proposal.
- `ci.yml` has no `permissions:` block. The repo default is `"default_workflow_permissions":"read"`.

## 3. Done-when

The ci-scheme case fails today and passes after. Item 1 needs a release and the plan says so. None passes today.

## 4. Security findings

- **Least privilege.** `actions: write` on the `release` job also gives that token to `changesets/action`, `pnpm install` (third-party code) and `create-release.sh`, and that job already holds `contents: write` and `id-token: write` (npm OIDC publish). With `actions: write`, a compromised dependency can also cancel, re-run or dispatch workflows and delete caches. Required: put the dispatch in a separate job, `needs: release`, with `permissions: { actions: write }` only, no checkout, and the PR number passed through job outputs.
- **TOCTOU on `--ref`.** `changeset-release/main` is unprotected (404, no rulesets). Required checks are `strict: false` with `required_approving_review_count: 0`. Any writer can push between the changesets force-push and the dispatch, and the dispatched `validate` then reports green on their commit. Required: pass the expected head SHA as a `workflow_dispatch` input, and make `validate` fail when `github.sha` differs from it.
- **The dispatch must not cover other branches.** Required context `validate` is bound to `app_id 15368` (GitHub Actions), so a dispatched run on any branch reports a `validate` on that branch's head. That run tests the head alone and never the merge ref. Required: restrict dispatched runs to `refs/heads/changeset-release/main`, and fail or skip on any other ref.
- **The approval goes away.** The `action_required` approval is today's only per-run human touch, and every release bypasses it with `--admin`. The plan replaces that bypass with no human step before the check goes green, while the merge stays a human act. The plan must state this.
- **Permissions in the CI workflow.** Dispatched runs inherit the repo default (`read` today). Required: add top-level `permissions: contents: read` to `ci.yml`, so a settings change cannot widen bot-ref runs.
- **Pins kept.** Name it in Done-when: every `uses:` stays SHA-pinned and no new action is added (`gh` is preinstalled).
- **Unspecified.** The step needs `env: GH_TOKEN` (or `GITHUB_TOKEN`). `gh` reads it and the plan names neither. The plan also does not say which `validate` wins when the `action_required` pull_request run and the dispatch both sit on one SHA.
