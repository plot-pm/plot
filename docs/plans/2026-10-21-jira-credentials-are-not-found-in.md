# Jira credentials are not found in a worktree or fleet desk

> The `.env` lookup stops at the worktree root, so every fleet desk refuses Jira with exit 3 while the operator's `.env` sits one directory up in the main checkout.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Issue:** #2250
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2253 merged
- **Started:** 2026-10-21, Jan Wloka, `bug/jira-credentials-are-not-found-in`

## Changelog

- A git worktree or fleet desk with no `.env` of its own reads `JIRA_EMAIL` and `JIRA_API_TOKEN` from the main checkout's `.env`. Jira calls there used to refuse with exit 3 until the operator exported both variables or copied `.env` in.

<!-- Board impact: none. No plan format, template, layout or board payload changes. -->

## Motivation

`jira_load_env_file` in `skills/plot/scripts/plot-host.sh` resolves the repository root with `git rev-parse --show-toplevel` and reads `$root/.env`. In a worktree, `--show-toplevel` returns the worktree, which has no `.env` because `.env` is untracked. Every desk under the `Worktree root` is such a worktree.

Measured 2026-10-21 on ewz-kus-portal with plot main `be96cdfe4`, read-only: in a worktree, `issue-list` refused with exit 3 and named both variables. After copying `.env` in, it listed EWZKUS tickets.

## Design

### Approach

When the worktree root holds no readable `.env`, the lookup reads `.env` from the main checkout: the parent of `git rev-parse --git-common-dir`. The worktree's own `.env` wins where it exists. The existing rules stay: environment variables win outright, both values or neither, no upward walk past the checkout, the value is never printed, and the refusal stays when neither file has both variables.

Two other readers share the defect and share the lookup:

- `plot-host.sh` Jenkins branch (`JENKINS_USER`, `JENKINS_API_TOKEN`), which builds `$(git rev-parse --show-toplevel)/.env` inline.
- `skills/plot/scripts/plot-bitbucket-commit-status.mjs` `loadEnvFile` (`BITBUCKET_REVIEW_USER`, `BITBUCKET_REVIEW_APP_PASSWORD`), which joins `repoRoot()` and `.env`.

One resolver for "the `.env` file for this checkout" in each language replaces three copies of the path logic. The stderr line that names the source says which file was read, so an operator can tell a worktree `.env` from the main checkout's.

Layering: this is shell on the adapter side of the host port. No domain rule changes, and no new script, so `skills/plot/scripts/README.md` gains no row.

### Open Questions

- [ ] Does a bare clone or a `--git-common-dir` that does not end in `.git` (a separate-git-dir checkout) give the right parent? The fix must fall back to "no main checkout `.env`" and keep the refusal, never guess.
- [ ] Do the Jenkins and Bitbucket review readers belong in this plan, or in a second slice? The recommendation is one slice: the resolver is the change, and the three callers are one line each.

## Slices

### Resolve .env from the main checkout

- `bug/jira-credentials-are-not-found-in` — a worktree falls back to the main checkout's `.env` for the Jira, Jenkins and Bitbucket review credentials

## Notes

Tests belong in `test/reconcile/host.test.mjs` (Jira, Jenkins) and `host-commit-status.test.mjs` (Bitbucket review): a worktree with no `.env` and a main checkout with one reads the main file; a worktree `.env` wins over the main one; neither file gives the refusal with exit 3. Run the whole reconcile glob, not only these files.

Related, delivered: [a-credential-is-read-where-a-repo-keeps-it](2026-09-17-a-credential-is-read-where-a-repo-keeps-it.md) (#930) added the `.env` read this plan extends.
