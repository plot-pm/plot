## Implementation brief — the-agent-s-ci-wait-never (wave 2: Credentials and default branch)

- **Plan (canonical):** `docs/plans/2026-10-16-the-agent-s-ci-wait-never.md` on `main`
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1868 merged
- **Branch:** `bug/jenkins-default-branch-workflow` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 1 (the tracer, `bug/jenkins-run-for-sha-conclusion`) merged as #1895. This branch runs beside `bug/jenkins-credential-from-env`; nothing waits on either until this one merges. `bug/jenkins-pr-checks-bind-to-head` names this branch in its `waits:` annotation — it reads `jenkins_sha_runs`'s corrected shape (binding checks to `headSha`), so it does not start until this PR merges.

### What to build

`jenkins_sha_runs` in `skills/plot/scripts/plot-host.sh` (`:1733-1740`) maps a Jenkins build into the domain's `WorkflowShaRun` shape — `sha`, `status`, `conclusion`, `url`, `startedAt` — but emits no `workflow` key. The GitHub arm two mappings up the same file emits `workflow:.workflowName` (`:4446`) and `workflow:(.job // "")` (`:4479`); the Jenkins jq object has no equivalent line. `WorkflowShaRun.workflow` is a required `string`, so the JSON this function prints is missing a field the domain's zod schema expects — whatever decodes it either fails or the field decodes as `undefined`/empty in a way the filter below treats as never matching.

The failure lands in `declaredRuns` (`packages/domain/src/rules/default-branch.ts:40-44`): `checks.length === 0 ? [...runs] : runs.filter((run) => checks.includes(run.workflow))`. With `Default branch checks` set (this repo declares `CI`), every Jenkins run is filtered out because `run.workflow` never equals any declared name — it is missing, not merely a different word. `foldRuns([])` then returns `'unknown'` (`default-branch.ts:57-62`), which is indistinguishable from "no build has run yet." The default-branch red hold (`defaultBranchRed`, read by `plot-ask.mjs merge`) never fires on a red Jenkins main, because the fold result looks identical to a quiet repository.

Fix: emit `workflow` in `jenkins_sha_runs`'s jq mapping, as the job path — the `job` local already resolved at the top of the function (`:1708-1710`, overridable by `PLOT_JENKINS_JOB`). That is the plan's "emit `workflow` as the job path," and it matches what a person configuring `Default branch checks` would write: the job name, not a Jenkins-internal build number or URL.

Second part: report when a declared check name matches no run. Today a mismatched name (typo in `Default branch checks`, or a name that doesn't match the job path once this fix ships) folds to the same `unknown` as "nothing has run." That silence is exactly what gap 5 complains about. Name the mismatch somewhere a person reading the default-branch reading or its log line can see it — e.g. in the stderr diagnostic path `jenkins_sha_runs` or its caller already uses, or in the `DefaultBranchOutcome` path in `packages/fleet/src/shared/default-branch-refresh.ts` if the mismatch is better caught where `checks` (the declared list) and the folded runs are both in scope. The plan leaves this open to engineering judgment — it specifies the symptom to kill (silent, indistinguishable-from-empty), not the exact call site.

### Settled decisions — do not re-derive them

- **`workflow` is the job path, not a Jenkins build field.** Jenkins builds carry no "workflow name" the way a GitHub Actions run does — there is one job, many builds. The plan settles this as the job path (the `job` local, or `PLOT_JENKINS_JOB` where set) because that is the one stable name a `Default branch checks` config entry can name and match against, mirroring the GitHub arm's `workflowName`/`.job` fields at the same file.
- **This is a one-field addition to an existing jq mapping, not a new helper.** `jenkins_sha_runs` already builds the `WorkflowShaRun`-shaped object at `:1733-1740`; add a `workflow:` key to that same `jq -c` pipeline. Do not introduce a second mapping function or duplicate the job-path resolution that already exists in `$job`.
- **Absent is not false (the repo's own recurring rule).** A Jenkins run with no matching declared check name is not "no runs happened" — it is "the one declared name does not match anything this job reports." Collapsing those into one `unknown` is the bug. Whatever reporting mechanism you add must be able to tell the two apart, even if the immediate caller (`declaredRuns`) still folds them the same way for now — name the mismatch where a human or the board can see it, not just in the already-indistinguishable fold result.
- **`declaredRuns` and `foldRuns` in `packages/domain/src/rules/default-branch.ts` are DOMAIN code — pure functions, arrow-function style, already tested.** If the mismatch reporting belongs in the domain (e.g. a new rule function reading `checks` against the runs' `workflow` values before folding), it is an arrow function per `CLAUDE.md`'s Domain Package rules, with TSDoc stating what it returns and how it fails — not the history of why it was added. If it belongs in the shell (`plot-host.sh`), it is a stderr diagnostic line, consistent with how `jenkins_no_instance` and `ci_unaskable` already report configuration mismatches by name in that file.
- **Scope stays inside `jenkins_sha_runs` and its direct callers.** `jenkins_build_map` (PR-row colouring, gap 3) is the sibling branch `bug/jenkins-pr-checks-bind-to-head`'s territory, not this one's — don't touch it even though it shares the "bind to a commit" theme.

### Done when

The plan's `## Slices` entry (gap 5: "emit `workflow` as the job path and report an unmatched declared name") and Changelog line 3 ("the default-branch red hold works on Jenkins when `Default branch checks` is set") are the specification. Assertions that exist because a naive implementation would pass without them:

- A `host.test.mjs` (or equivalent) case asserting `jenkins_sha_runs`'s JSON output for a matched sha carries a non-empty `workflow` field equal to the job path. This catches the missing key outright — without it, a fix that adds the field under the wrong name or to the wrong object still "looks done."
- A `default-branch.test.ts` (or wherever `declaredRuns`/`foldRuns` are tested) case: `Default branch checks` set to a name that equals the job path, Jenkins runs present with that `workflow` value, fold settles `red`/`green` — not `unknown`. This is the end-to-end proof the red hold actually fires on Jenkins.
- A case with `Default branch checks` set to a name that matches NOTHING the job reports: assert the mismatch is visible somewhere (stderr, a log line, a returned diagnostic) distinct from the "no runs at all" case. Two scenarios that read identically today — configured-but-mismatched vs. never-built — must read differently once this ships, or gap 5 is not actually closed.
- A case with `Default branch checks` empty (the existing "keep every run" branch in `declaredRuns`) is unaffected — this fix must not change behaviour for repositories that declare no check names.

Plus: add a changeset (description first, `bumps:` block last, `plan:` line inside it; package `plot`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally, and do not run `host.test.mjs` as a whole file under load: run the test names you touched.

This slice touches a `.sh` file, so `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. A one-line jq addition is cheap, but if the mismatch-reporting path adds more than a line or two of shell, pay for it in the same change — remove shell elsewhere, or put the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

New functions are arrow functions where they are TypeScript. Reasoning goes in the commit message, not in the code.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `jenkins_sha_runs`'s jq filter (the `workflow` field, near `:1733`) in `skills/plot/scripts/plot-host.sh`, any mismatch-reporting addition in that function or in `packages/domain/src/rules/default-branch.ts` / `packages/fleet/src/shared/default-branch-refresh.ts`, the matching test cases, and one changeset. The sibling `bug/jenkins-credential-from-env` edits `jenkins_rest_credential` in the same file — stay out of that function so the two merge cleanly. `bug/jenkins-pr-checks-bind-to-head` later edits `jenkins_build_map` and depends on this branch's `workflow` field landing first. Neither sibling branch is claimed at dispatch.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
