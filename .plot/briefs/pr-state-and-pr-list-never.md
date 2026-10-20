## Implementation brief — pr-state-and-pr-list-never (wave: Bitbucket mergeable)

- **Plan (canonical):** `docs/plans/2026-10-20-pr-state-and-pr-list-never.md` on main
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2167 merged
- **Branch:** `bug/pr-state-and-pr-list-never` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review app, required since 2026-10-15)

The plan's only wave. Nothing waits on it and it waits on nothing. Issue: #2156.

### What to build

On Bitbucket, `pr-list --rich` rows read `mergeable: unknown` and `pr-state` carries no `mergeable` field. Measured 2026-10-20 against ewz-kus-portal. A desk therefore never learns that its PR conflicts with the base, and the `pr.mergeable === 'conflicting'` branch in `packages/fleet/src/server/entry/worker-loop.ts:956` never starts.

The cause is in the code, not the host: `MERGEABLE_OF` (`plot-host.sh:566`) folds GitHub's `mergeable`, `mergeStateStatus` and `mergeable_state`. The Bitbucket arms hard-code `mergeable:"unknown"` (`plot-host.sh:4462` and `:4473`), and the `pr-state` row is built by `bitbucket-pr-reading.ts` (shipped through `board/plot-jenkins-pr-checks.mjs state`), which emits no `mergeable` key at all.

The plan is canonical. This branch picks one of its two outcomes after measuring, then builds it.

### The decisions the plan settles — do not re-derive them

**Measure before choosing.** Run `bb api` (`bb 1.0.0` is installed; paths are relative to `https://api.bitbucket.org/2.0`) against ewz-kus-portal, read-only, for one conflicting and one clean PR: `/repositories/{ws}/{repo}/pullrequests/{id}/diffstat` (entries carry a `status` such as `merge conflict`) and the PR object itself. Record the measured payloads and the per-call latency in the PR body. Writes against ewz-kus-portal need Jan's go.

**Rate-limit contract.** `host` is a connector: one extra request per open PR costs budget, and `bb` calls were measured at about 10 s each (comment at `plot-host.sh:3626`). If outcome 1 wins, the answer comes from a bounded number of calls per pass, and a row the pass does not reach reads `unknown`, as the Jenkins binding already does past its cap (`SHA_LOOKUPS_PER_PASS = 5`). Do not fan out one call per PR unbounded on the list path.

**Absent is not false, and `unknown` is not `mergeable`.** An endpoint failure, a timeout or an unreached row reads `unknown`. Only a payload that says the PR merges cleanly reads `mergeable`; only one that reports a conflict reads `conflicting`. Measured 2026-08-27 on this estate: an empty result read as "no PRs" refused four merged plans.

**One fold.** A new Bitbucket mapping extends `MERGEABLE_OF` or sits beside it. The GitHub mapping does not change. If the `pr-state` row's logic belongs in the domain, put it in `bitbucket-pr-reading.ts` and reach it through the existing bundle rather than writing jq in shell (see the shell gate below).

**If outcome 2 wins** (Bitbucket stays `unknown`): the connector contract comment in `plot-host.sh` (`:37-39`, `:204`) states that Bitbucket never answers `mergeable`, and the desk path gets another signal, such as a failed `git merge-tree` or a failed merge of the base in the worktree. That signal is a second code path in `worker-loop.ts`, and it follows the layering rule: controller calls the domain, a port reaches git.

### Done when

- Outcome 1: `pr-list --rich` and `pr-state` (by number and by branch) on Bitbucket report `mergeable`, `conflicting` or `unknown` from the measured endpoint. Outcome 2: the contract states `unknown`, and the desk path conflicts-detects without a PR field.
- Host-contract tests in `test/reconcile/host.test.mjs` cover the Bitbucket arm with one fixture per endpoint answer — clean, conflicting, endpoint failure — and assert that `pr-state` carries the `mergeable` key. The failure fixture is the one a naive implementation passes without: a swallowed endpoint error that yields `mergeable` instead of `unknown`.
- A GitHub regression assertion: the GitHub `mergeable` answers do not change.

Plus the repo gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches `plot-host.sh`, so growth is paid for in the same change — remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override. Add a changeset (description first, `bumps:` block last) for the `plot-dispatch`/`plot` skill bump that applies, and run `./scripts/check-changeset-packages.sh`.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the Bitbucket arms of `pr-list` and `pr-state` in `skills/plot/scripts/plot-host.sh`, `packages/domain/src/rules/bitbucket-pr-reading.ts` with its bundle, the tests in `test/reconcile/host*.test.mjs`, and — only under outcome 2 — the desk path in `packages/fleet/src/server/entry/worker-loop.ts`. No other plan slice is open on these paths; verified at dispatch against `origin` heads (only `idea/plot-on-a-bitbucket-repository-lists` exists, a plan branch).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
