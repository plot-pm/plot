## Implementation brief — ci-board-integration-still-fails-at (wave 1: Mirror independence)

- **Plan (canonical):** docs/plans/2026-10-23-ci-board-integration-still-fails-at.md on main
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2445 merged
- **Branch:** `infra/board-integration-does-not-need-the-apt-mirrors` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention (plan `Review: pr`)

This is the plan's only branch. Nothing waits on it and it waits on nothing.

### What to build

The `board-integration` job in `.github/workflows/ci.yml` stops depending on the Ubuntu apt mirrors at the Playwright install. Observed on 2026-10-23: 14 of 19 failed `ci.yml` runs failed in this job before any test ran (8 at "Install Playwright browser", 6 at "Install Playwright system packages"). Runs 39958278162 and 39935545264 exhausted both retried `apt-get` attempts of #2393. `gh run rerun --failed` passes most of them, so each failure costs a manual rerun and holds plan approval and the merge watcher. Your change is right when a slow mirror no longer fails the job. The plan is canonical; this brief orients.

### Decisions the plan settles — do not re-derive them

- **Retry and timeout tuning is exhausted.** #2367 (cache and retry) and #2393 (3 min per attempt, two attempts, root `timeout`, dpkg lock wait) are in `ci.yml` at lines 399-441. Both attempts still time out on a slow mirror. Do not lengthen the bound or add attempts. That is the dependency the plan removes, not a knob.
- **The browser cache does not cover `apt`.** The cache step hits in 3-5 s and `install-deps` still fetches 25.9 MB on every run. The runner image lacks 9 of Playwright's packages (fonts) and holds older versions of 8 more. `install-deps --dry-run` reports them missing on every run, so "skip on a cache hit" is not available as it stands.
- **Three options, measured before one is chosen** (read the failed runs named in the plan):
  1. Cache the `.deb` files or installed libraries. Key it on the resolved Playwright version like the browser cache. A miss falls back to today's retried install. **This is the default**, because it changes least.
  2. Run the job in `mcr.microsoft.com/playwright`. Costs: a pull from another registry, a pin that tracks the Playwright version, and a job off the bare runner image the other jobs use.
  3. Skip `install-deps` when the libraries already satisfy Chromium. Holds only if the board tests pass without the 9 font packages.
- **Pick by failure mode.** Record the measurement (install time, hit rate, tests passing) in the commit message, not in `ci.yml` prose, so `git log -S` finds it.
- Rules carried over: exit code, not emptiness, decides a step. A cache miss must still end in a working install. A change that only passes on a cache hit has moved the failure, not removed it.

### Done when

The plan has no `## Done when` list. The slice is done when:

- `board-integration` completes its Playwright setup with no `apt-get` fetch on a cache hit (option 1 or 2), or with none at all (option 3).
- A cold cache (miss) still installs correctly through the existing retried path. Prove it with a run on a changed key, and say which run.
- The three Open Questions in the plan each have an answer in the commit message.
- Naive-pass trap: a green run right after the change proves nothing if the cache was populated by the same run. Check a second run that restores from the cache.

Gates: no changeset is needed (CI-only; plan says board impact none), but `./scripts/check-changeset-packages.sh` must still pass. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows. This slice touches no `.sh` file under `skills/`; keep it that way.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while moving), never `gh pr create`. Then append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the `board-integration` job in `.github/workflows/ci.yml` and nothing else. Other jobs, `validate`, and the board package are out of scope. The worktree `.worktrees/free-66648ff6` holds `infra/playwright-install-survives-a-slow-download`, an earlier branch over the same install steps: run `git fetch` and check for a conflicting `ci.yml` change before you push.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
