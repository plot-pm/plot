## Implementation brief — jenkins-run-for-sha-on-the

- **Plan (canonical):** `docs/plans/2026-10-21-jenkins-run-for-sha-on-the.md` on `main`
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2285 merged
- **Branch:** `bug/jenkins-run-for-sha-on-the` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

One branch, one wave. Nothing waits on it and it waits on nothing. The delivered sibling `jenkins-run-for-sha-can-answer` (#2214) edited the same function (it drops `NOT_BUILT` builds); rebase on `main` before you start.

### What to build

On ewz-kus-portal (Bitbucket + Jenkins), `plot-host.sh run-for-sha develop <sha>` and `plot-host.sh runs develop` print `plot-host: run-for-sha — Jenkins did not answer for '<host>'` and exit 4, although Jenkins answered. The project builds `develop` in a separate job (`kus-portal/continuous-deploy`), not in the multibranch job `kus-portal/continuous-build-multi`. fleetd therefore writes no `default-branch.json`, the `default-branch-red` hold never acts, and nothing warns.

The mechanism is in `jenkins_sha_runs` (`skills/plot/scripts/plot-host.sh:1799`). The loop over `jenkins_job_url_path "$job" "$branch"` then `jenkins_job_url_path "$job" ""` accepts a body only when it `has("builds")` or `has("jobs")`. The branch path answers a 404 page. The multibranch root answers only `{"_class":"…WorkflowMultiBranchProject"}`, because the `tree=builds[…]` filter strips `jobs`, so the `has("jobs")` test never matches, `body` stays empty and the function exits 4.

Build three things, in this order:

1. **A missing branch answers empty.** A root that answers JSON with a multibranch `_class` and no `builds` means the branch is absent: `run-for-sha` and `runs` print an empty answer and exit 0. A 404 on the branch path alone, and a root that did not answer at all (HTML, empty, refused), stay exit 4 — an unreachable Jenkins must stay distinguishable from "no such branch".
2. **A way to name the default branch's job.** See the open questions below.
3. **A visible reason when fleetd gets no reading for the default branch.** Today the absence is silent. Name the cause where the fleet log or the board shows it.

The plan is canonical; this is orientation.

### Open questions the plan leaves to you — decide, record, do not skip

The plan is Approved with three unchecked questions. They are the implementer's call; record each answer in the PR body and tick it in the plan.

- **Config key, message only, or both?** The plan's `<!-- builds: -->` annotation on the slice already says *a Plot Config key for the default branch's Jenkins job*, so lean to the key plus a warning. A message alone leaves ewz-kus-portal with no default-branch CI reading, which is the failure being fixed.
- **One job for the default branch, or a branch-to-job map?** The field test shows one case. Take the single job: a map is a surface nobody has asked for.
- **Does the empty answer change `plot-ask.mjs merge`?** It should not: a missing reading holds nothing (`default-branch-red`), and `merge` refuses a reading older than `Checks wait` as `default-branch-stale`. Prove it with a test rather than assume it.

### Settled decisions — do not re-derive them

- **Exit 4 keeps its meaning: Jenkins was not asked or did not answer.** Absent is not false. An empty answer for a branch Jenkins confirmed it does not hold is an answer; an HTML page, a 404 or a refusal is not. Test the two cases apart. The existing tests at `test/reconcile/host.test.mjs:2894-2905` assert HTML makes two curl calls and exits 4 — they must still pass unchanged.
- **Widening the `tree=` filter to add `jobs` is the wrong fix.** It makes the root answer carry job names for every project, and the `has("jobs")` arm then returns `{"builds":[]}` for a root that merely lists jobs. That arm answers "empty" for a root that never held the branch only by accident. Key the decision on the `_class`, not on `jobs`.
- **The config key is read through `plot-config.sh get`, as `jenkins_instance` does (`plot-host.sh:1688`).** `PLOT_JENKINS_JOB` already overrides `$job` for the whole function (`:1804`); the new key must not collide with it. Say which wins and test it.
- **`workflow` stays the job path.** The delivered `workflow`-emission work (`jenkins-default-branch-workflow`) set `workflow` to `$job`. If the default branch reads from another job, `workflow` is that job's path, so `Default branch checks` names it.
- **Scope stays in `jenkins_sha_runs` and the place fleetd reports a missing reading.** `jenkins_build_map` and PR-row colouring are not this branch's.

### Done when

The plan's `Changelog` line is the specification. Assertions that exist because a naive implementation would pass without them:

- A multibranch root answering `{"_class":"…WorkflowMultiBranchProject"}` with a 404 branch path: `run-for-sha` and `runs` print an empty answer and exit 0. This is the ewz case; without it the fix is untested.
- An HTML body on both URLs still exits 4. This catches an implementation that reads "no `builds`" as "no branch" and so reads an unreachable Jenkins as an empty history.
- A 404 on the root as well as the branch path still exits 4.
- With the new key set, the function reads the named job and not the multibranch branch path; with it unset, behaviour is unchanged.
- The reason for a missing default-branch reading is observable (log line, board text or returned diagnostic), and a test asserts it.

Plus: a changeset (description first, `bumps:` block last, `plan:` line inside it; package `plot`). If you add a config key, add its row wherever the other keys such as `Jenkins instance` are documented and probed (`test/reconcile/boardprobe.test.mjs`, `init-stack.test.mjs`, `ci-scheme.test.mjs` read it) and update the CLAUDE.md `Plot Config` list only through `./scripts/check-agents-md.sh --write`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally, and do not run `host.test.mjs` as a whole file under load: run the test names you touched.

This slice touches a `.sh` file, so `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. Growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

New TypeScript functions are arrow functions. Reasoning goes in the commit message, not in the code.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `jenkins_sha_runs` in `skills/plot/scripts/plot-host.sh`, the code that reports a missing default-branch reading (`packages/fleet/src/shared/default-branch-refresh.ts` is the likely place), the matching tests, a possible config-key row, and one changeset. `bug/plot-review-status-sh-exits-1` and `bug/reconcile-on-bitbucket-reads-merged-branches` are in the same sprint; neither names `jenkins_sha_runs`. If you find something the plan did not anticipate, report it rather than improvising outside scope.
