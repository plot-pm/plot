## Implementation brief — jenkins-sha-lookups-in-plot-host (wave: Test hygiene)

- **Plan (canonical):** docs/plans/2026-10-24-jenkins-sha-lookups-in-plot-host.md on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2497 merged
- **Branch:** `bug/jenkins-sha-tests-run-in-a-private-home` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** plot-review app (required since 2026-10-15)

This is the third and final slice. The first two are merged: "Sha binding" (#2548, `bug/jenkins-sha-runs-bind-by-action`) and "Refusals and credentials" (#2659, `bug/jenkins-refusals-and-credential-fallback`). `jenkins_sha_runs` in `skills/plot/scripts/plot-host.sh` already binds branch/sha per-action, keys the plain-job match on the asked branch, filters `NOT_BUILT`/`ABORTED` before the limit, and refuses a missing multibranch branch and a host-less `Instance` line by name. Nothing here touches that logic — this slice is test-only, in `test/reconcile/host.test.mjs`.

### What to build

**1. Run the Jenkins sourcing tests in a private `HOME` and `cwd`.**

`runJenkins` and `runJenkinsAllowFail` (test/reconcile/host.test.mjs:2599-2623) spawn `bash <adapter> <args>` with `cwd: repo` (already a private temp dir) and `env: { ...process.env, PATH: ..., PLOT_HOST: '', ...extraEnv }` — they never set `HOME` or `PLOT_BUDGET_HOME`. Under `pnpm run test:contracts`, `scripts/owned-run.sh` already redirects `HOME`/`PLOT_BUDGET_HOME`/`TMPDIR` for the whole process tree, so these tests are accidentally safe there. Run the same test file directly — `node --test test/reconcile/host.test.mjs`, which is exactly what `plot-local-checks.mjs` tells an agent to do for a changed file — and every Jenkins call these two helpers make (`host_slot_take`/`budget_record_call` inside `jenkins_sha_runs`) falls through `plot-budget.sh:74`'s `${PLOT_BUDGET_HOME:-${HOME}/.plot/state}` straight into the operator's real `~/.plot/state/budget.tsv`.

Give both helpers their own private `HOME` the same way the Jira ledger tests already do (test/reconcile/host.test.mjs:8080-8094, the `jiraEnvRepo`/`runJiraNoCreds` pattern): a `mkdtempSync` directory passed as `HOME`, with `PLOT_BUDGET_HOME: path.join(home, '.plot', 'state')` **named explicitly beside it** — the comment at line 8080 states why: `plot-budget.sh` reads `PLOT_BUDGET_HOME` first and only falls back to `$HOME/.plot/state` while nothing exports the override, so setting `HOME` alone on a test that runs outside `owned-run.sh` is not sufficient on its own, it just moves the leak to a directory that still needs the same treatment as the real one. Track the temp dir with `trackTemp` like every other fixture in this file, so teardown removes it.

Scope this to the two Jenkins runner helpers — do not touch the dozens of other `runJenkins`-adjacent call sites in the file (`makeStubs`, `makeJenStub`, the GitHub-arm helpers) unless they also shell into `jenkins_sha_runs` without going through these two functions. If you find another direct caller, name it in the PR rather than silently folding it in.

**2. Retitle the two `runs-for-sha` tests.**

Two tests are currently misnamed `run-for-sha and runs-for-sha ...` (host.test.mjs:3966 and :3990) even though each exercises both the singular op (`run-for-sha`) and the plural op (`runs-for-sha`) in one body — that's not wrong, but the plan calls for retitling, and the two are the ones named in the "Test hygiene" slice. Read what each asserts before renaming:
- :3966 `'host: run-for-sha and runs-for-sha still return an ABORTED build for the exact sha asked'`
- :3990 `'host: run-for-sha and runs-for-sha answer none/empty when the only build for a sha is NOT_BUILT'`

Split each into two titled tests (one assertion block per op) or give the combined test a title that names what's being proven rather than which two ops it calls — match the surrounding file's naming convention (`'host: <op> <behaviour>'`), and don't just prepend/append a word. The surrounding tests in that block (:3870–3990) are a good model for the house style.

**3. Add a `runs-for-sha` test on a plain job.**

`'host: runs on a plain job emits a line rather than exiting 4'` (host.test.mjs:3715) exists for `runs`, and the plain-job match-key fix (slice 1, #2548) covers `jenkins_sha_runs` for every op including `runs-for-sha` — but no test exercises `runs-for-sha` specifically against a plain (non-multibranch) job. Without it, a future regression that breaks the plain-job arm only for the sha-bound path (as opposed to the unbound `runs` path) would pass every existing test. Build it the same way the :3715 test does — a `jenkins_rest_credential`/job fixture with no multibranch `_class`, asserting `runs-for-sha` returns the matching build(s) rather than exiting 4.

### Decisions already settled — do not re-derive them

- **Why `owned-run.sh` doesn't already cover this.** It redirects the whole process tree for `pnpm run test:contracts`, which is the CI/suite path. It does nothing for `node --test test/reconcile/host.test.mjs` run directly — which is the path `plot-local-checks.mjs` names for a changed-file check, and the path any agent iterating on this file will actually run. The fix belongs at the test helper, not at the runner wrapper: a single file must be independently safe.
- **`HOME` alone is not enough; `PLOT_BUDGET_HOME` must be named too.** This is the one correction worth internalizing before touching the file — see the comment block at host.test.mjs:8080-8083, written for exactly this reason after a prior near-miss on the Jira tests. `plot-budget.sh:74` checks `PLOT_BUDGET_HOME` before `HOME`, so a test that sets `HOME` but not `PLOT_BUDGET_HOME`, and runs on a machine where some other process has `PLOT_BUDGET_HOME` exported ambiently, writes to a location neither the test author nor the operator expects. Always pass both.
- **Why `cwd: repo` was never the problem.** `plot_env_file` resolves `.env` via `git rev-parse --show-toplevel`/`--git-common-dir`, both of which key off `cwd`, already a private temp git repo in every existing test. The leak is specifically the budget ledger (and anything else keyed off bare `$HOME`), not credentials.
- **This slice is test-only.** `jenkins_sha_runs` itself needs no change — slices 1 and 2 already shipped the binding, match-key, filter-before-limit and refusal fixes this plan names. Resist the urge to "clean up" the function while you're in the file for an unrelated reason; a diff with no behaviour change destroys `git blame` for every touched line (CLAUDE.md, "The unit is the function, not the file").

### Done when

The plan's `## Done when` is implicit in its Slices section for this wave (no explicit `## Done when` heading on this plan) — treat the three "What to build" items above as the specification: both Jenkins runner helpers carry a private `HOME`+`PLOT_BUDGET_HOME` pair, the two misnamed tests read names that state what they prove, and a `runs-for-sha`-on-plain-job test exists and passes.

Verify the budget-leak fix the way the Jira precedent does: run `node --test test/reconcile/host.test.mjs` directly (not through `owned-run.sh`) before and after your change, diffing `~/.plot/state/budget.tsv`'s line count — before, every Jenkins-path test in this file adds a line there; after, none do. This is the only way to prove the fix, since the ledger writes silently and no existing test asserts against the real `$HOME`.

Plus the repo's standing gates: before each push, run `node skills/plot/scripts/board/plot-local-checks.mjs` (resolved from this skill's directory) and run what it prints — the tests naming this changed file, plus the gate tests and `scripts/check-*.sh`. The suites named in `CI suites` in `CLAUDE.md`'s Plot Config run in CI; don't run them locally as a matter of course (`test:e2e` is CI's gate, not a local one — see CLAUDE.md § Testing).

Name the shell gate explicitly: `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base. This slice touches only `test/reconcile/host.test.mjs` (not under `skills/`), so the gate should not fire — but if your retitling or new-test work spills into any `.sh` file, that growth must be paid for in the same change.

### Bookkeeping

Open the PR through the controller once the first real commit exists:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

It reads the plan, titles the PR from this wave's heading ("Test hygiene"), and appends `→ #<number>` to this branch's `## Slices` line automatically-by-convention — confirm it did, or add it by hand if not. Do not run `gh pr create`.

### Scope guard

This branch owns `test/reconcile/host.test.mjs` only — no production code in `skills/plot/scripts/plot-host.sh`. The plan's Notes say all three slices in this plan touch `plot-host.sh` or its one test file and so run strictly in sequence; both prior slices are merged, so nothing is in flight that collides here. If you find a fourth, unrelated issue in this test file while working, report it rather than fixing it inline — this slice's scope is the three items the plan names for "Test hygiene," nothing broader.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
