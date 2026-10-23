# CI board-integration fails when the Playwright browser download takes more than 3 minutes

> The `Install Playwright browser` step times out at 3 minutes on a slow download and fails the PR; the step gets a bound that covers a cold install, or one retry.

## Status

- **State:** Approved
- **Type:** infra
- **Sprint:**
- **Issue:** #2360
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2362 merged

## Changelog

- CI: a slow Playwright browser download no longer fails the `board-integration` job.

<!-- Board impact: none. The change is in `.github/workflows/ci.yml` only. -->

## Motivation

On 2026-10-22 the `board-integration` job failed at `Install Playwright browser` on four PRs: #2348 (twice), #2349, #2356 and #2358. Each time the step ended with `The action 'Install Playwright browser' has timed out after 3 minutes.` `validate` then failed on `Require the split jobs`, so each PR read red although no test ran. A rerun passed in every case rerun so far.

Issue #2360 says the step has no cache. That is not what the workflow holds: `ci.yml` already has a `Cache the Playwright browser` step on `~/.cache/ms-playwright`. The failure therefore comes from one of three places, and the slice measures which before it changes anything:

1. The cache misses. Its key hashes `packages/board/package.json`, not the resolved Playwright version, so any edit to that file evicts a browser that is still correct.
2. `playwright install --with-deps` runs `apt-get` for the system packages on every run. The cache covers `~/.cache/ms-playwright` and not those packages, so a slow Ubuntu mirror costs time on a cache hit too.
3. The 3-minute bound is below the cold-install time on a slow day. The comment above the step measures ~45 s warm and ~90 s cold, which leaves a factor of 2 on a cold run.

## Design

### Approach

One slice, edits to the `Install Playwright browser` step and its cache step in `.github/workflows/ci.yml`:

- Read the logs of the four failed runs and name which of the three causes applies, with the step duration of each.
- Key the cache on the resolved Playwright version (`pnpm --filter @plot-pm/board exec playwright --version`) so an unrelated `package.json` edit does not evict the browser.
- Split the install: on a cache hit, run `playwright install-deps chromium` only; on a miss, run the full install.
- Replace the 3-minute bound with one that covers a cold install, and retry the step once on a timeout or failure. The existing comment states the reason for a tight bound: a connection that never completes held a step past 10 minutes eleven times in one day. The new bound must still turn that case into a fast failure, so the retry runs the step twice at a bound near 5 minutes rather than raising a single bound.

The slice keeps the retry mechanism the repository already uses, if one exists, and adds no third-party action for it.

### Open Questions

- [ ] Which of the three causes produced the four failures? The run logs answer it, and the answer decides whether the cache key or the retry carries the fix.
- [ ] Does a retry of a timed-out step stay inside the job's `timeout-minutes`?

## Slices

### Install step

- `infra/playwright-install-survives-a-slow-download` — key the browser cache on the Playwright version and give the install step a retry <!-- builds: a version-keyed Playwright cache and a retried install step in ci.yml -->

## Notes

- Source: tracker issue #2360, 2026-10-22.
- Related history: commit `95a08ee46` set the 3-minute bound.
