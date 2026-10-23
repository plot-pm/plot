## Implementation brief — ci-board-integration-fails-when-the (wave 1: Install step)

- **Plan (canonical):** `docs/plans/2026-10-23-ci-board-integration-fails-when-the.md` on `main`
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2362 merged
- **Branch:** `infra/playwright-install-survives-a-slow-download` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority

One wave, one branch. Nothing waits on it and it waits on nothing.

### What to build

The `Install Playwright browser` step in the `board-integration` job (`.github/workflows/ci.yml`, near `:397`) carries `timeout-minutes: 3`. On 2026-10-22 it timed out on four PRs (#2348 twice, #2349, #2356, #2358); `validate` then failed on `Require the split jobs` although no test ran, and every rerun passed. Issue #2360 says the step has no cache. That is false: `Cache the Playwright browser` (`:381`) exists. The slice measures which of three causes applies before it edits anything: (1) the cache key hashes `packages/board/package.json` and misses on unrelated edits, (2) `--with-deps` runs `apt-get` on every run, cache hit or not, (3) 3 minutes is below a cold install on a slow day (comment says ~45 s warm, ~90 s cold).

Read the four failed runs' logs (`gh run view --log`, the step's start and end times) and write the per-run step duration and the named cause into the PR body. Then edit the cache step and the install step. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**Do not raise one bound.** The comment above the step records that a connection that never completes held a step past 10 minutes eleven times in one day (measured 2026-08-19, commit `95a08ee46`). A single larger bound turns a hang back into a long silence. The retry runs the step twice at a bound near 5 minutes each.

**No third-party retry action.** Use a shell loop or a second step guarded by `if: steps.<id>.outcome == 'failure'` with `continue-on-error`. A repository retry mechanism, if one exists, wins; a grep of `ci.yml` for `retry` finds none for this step (the `git-retry` hits at `:1195` concern another test).

**Key the cache on the resolved Playwright version**, from `pnpm --filter @plot-pm/board exec playwright --version`, not on `package.json`. The existing comment at `:376` already claims this keying; the code does not do it. Fix the code, keep the comment true.

**Split the install by cache outcome.** On `steps.playwright-cache.outputs.cache-hit == 'true'` run `playwright install-deps chromium` only; otherwise the full `install --with-deps chromium`.

### The open question that decides the bound

The job has `timeout-minutes: 15` (`:333`). Two attempts at 5 minutes use 10 of them, before the 15-minute test step and the build. Answer the plan's second open question with arithmetic from the job's measured median (542.5 s, p95 600 s, max 606 s, per the comment at `:327`): either shrink the per-attempt bound or raise the job ceiling, and say which and why in the comment. A retry that the job ceiling cancels first is not a retry.

### Done when

The plan's `## Done when` list, if present, and the plan's Approach bullets are the specification. Plus:

- The PR body names the cause of each of the four failures with its step duration.
- The `Install Playwright browser` step cannot hold a job past the job's own ceiling, shown by the arithmetic above.
- A hung download still fails within about 10 minutes in total, not more.
- `validate`'s `Require the split jobs` step is untouched.

Gates: one `.changeset/*.md` (package `plot`, description first, `bumps:` block last, `plan:` line inside the block). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to measure; do not add shell under `skills/`. A workflow change can only be proved by a CI run: say in the PR body which run exercised the new step, and whether it was a cache hit or miss. Do not run `pnpm run test:e2e` locally.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves). Never `gh pr create`.
- When the PR exists, write its number into the slice heading in the plan's `## Slices` section on `main`: `### Install step (Branch: infra/playwright-install-survives-a-slow-download, PR: #N)`. The trailing `→ #N` form parses as no PR for a waves plan.

### Scope guard

This branch owns `.github/workflows/ci.yml` (the `board-integration` job's cache and install steps, and its `timeout-minutes` if the arithmetic requires it) and one changeset. Not this branch: the `validate` job, the `helper-contracts` job, any board source.

No other branch in flight touches `ci.yml` at brief time (`git log` shows no commit on it since `599d970b7`); re-check with `git ls-remote --heads origin` before the first push.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
