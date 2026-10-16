## Implementation brief — the-agent-s-ci-wait-never (wave 2: Credentials and default branch)

- **Plan (canonical):** `docs/plans/2026-10-16-the-agent-s-ci-wait-never.md` on `main`
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1868 merged
- **Branch:** `bug/jenkins-credential-from-env` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 1 (the tracer, `bug/jenkins-run-for-sha-conclusion`) merged as #1895. This branch runs beside `bug/jenkins-default-branch-workflow`; nothing waits on this branch.

### What to build

On a machine with no macOS keychain, no Jenkins REST call can authenticate. `jenkins_rest_credential` in `skills/plot/scripts/plot-host.sh` (near `:1649`) returns 1 at `command -v security`, so `jenkins_sha_runs` exits 4 (*cannot be asked*) on every Linux agent and every CI machine. The tracer's mapping fix therefore reaches no Linux machine until the credential resolves. The fix: `jenkins_rest_credential` also reads `JENKINS_USER` and `JENKINS_API_TOKEN`, from the environment first and from the repository's `.env` where both are unset, and prints `user:token` as before. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

- **Copy the Jira connector's shape, not its code path.** `jira_load_env_file` (`plot-host.sh`, near `:2576`) is the precedent: the environment wins and the file is opened only when BOTH variables are unset; both or neither is read, because half a Basic credential authenticates nothing; the repository root comes from `git rev-parse --show-toplevel` with no upward walk toward `$HOME`; the source is named on stderr and the value is never printed. Plan Open Question 3 asks whether a shared helper is warranted. `read_env_var` (near `:2519`) is already the shared reader; reuse it and do not write a second `.env` parser. Do not source or `eval` the file: the comment above `read_env_var` records the measured failure (an unquoted JSON object aborted zsh) and the quote-stripping order that has been got wrong twice.
- **Order: environment, then `.env`, then keychain? Settle it by what each source costs.** A deliberate export is never second-guessed. The keychain stays for macOS machines that have no env pair. Name the order you chose in the TSDoc-style comment above the function and test every arm.
- **Never the Keycloak bearer.** The comment above the function records it: `jen auth token` prints a bearer that Jenkins answers with an HTML login redirect. Do not add it as a fallback.
- **Empty is still the honest answer.** No source, or a half pair in any source, returns 1, and the caller turns that into exit 4. A Linux agent with no credential reads *cannot be asked*, never *no run*.
- **No echo of a secret.** The credential goes straight to `curl -u`. No failure path names the token, and the stderr line names the source and the variable names only.
- **`jenkins_rest_credential` runs inside `$(...)`** at its call site (`:1715`), so a stderr note prints once per call. Check that a source note does not repeat per request in a loop.

### Done when

The plan's `## Slices` entry and Changelog line 4 are the specification: Jenkins REST credentials read from the environment or `.env` as well as the macOS keychain. Assertions that exist because a naive implementation would pass without them:

- A `host.test.mjs` case with **no `security` binary on `PATH`** and `JENKINS_USER` and `JENKINS_API_TOKEN` exported: `run-for-sha` reaches the stubbed `curl` with `-u user:token`. This catches reading the variables after the `command -v security` guard, which passes on macOS and fails on Linux.
- The same case from a `.env` file in the repository root, including an `export `-prefixed line and a quoted value with trailing spaces. This catches a `grep | cut` reader.
- Only one variable set, in the environment and in `.env`: exit 4, as today. This catches a half credential reaching `curl`.
- Environment set and `.env` different: the environment value reaches `curl`.
- No test prints the token: assert the token string is absent from stderr.

Plus: add a changeset (description first, `bumps:` block last, `plan:` line inside it; package `plot`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally, and do not run `host.test.mjs` as a whole file under load: run the test names you touched.

This slice touches a `.sh` file, so `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. Pay for the added lines in the same change: remove shell elsewhere, or put the pair-resolution rule in the domain and ask it through a bundle. The gate stores no number and has no override. Weigh this before choosing where the `.env` read lives.

New functions are arrow functions where they are TypeScript. Reasoning goes in the commit message, not in the code.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `jenkins_rest_credential` and what it needs in `skills/plot/scripts/plot-host.sh`, the matching cases in `test/reconcile/host.test.mjs`, and one changeset. The sibling `bug/jenkins-default-branch-workflow` edits `jenkins_sha_runs`'s jq filter (the `workflow` field, near `:1722`) in the same file; stay out of that function so the two merge cleanly. `bug/jenkins-pr-checks-bind-to-head` later edits `jenkins_build_map`. Neither branch is claimed at dispatch.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
