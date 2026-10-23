# CI board-integration still fails at the Playwright install when the apt mirrors are slow

> The `board-integration` job installs Playwright's system packages from the Ubuntu apt mirrors on every run; the job stops depending on those mirrors, or tolerates them failing, so a slow mirror no longer needs a manual rerun.

## Status

- **State:** Draft
- **Type:** infra
- **Sprint:**
- **Issue:** #2444
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- CI: a slow Ubuntu apt mirror no longer fails the `board-integration` job at the Playwright install.

<!-- Board impact: none. The change is in `.github/workflows/ci.yml` only. -->

## Motivation

On 2026-10-23, 14 of the 19 failed `ci.yml` runs failed in the `board-integration` job before any test ran:

| Failing step | Runs |
|---|---|
| Install Playwright browser | 8 |
| Install Playwright system packages | 6 |
| Board integration tests (vitest + Playwright) | 2 |
| validate: other suites | 3 |

The 16 `validate: Require the split jobs` failures follow from these; that step only reports the split jobs.

Both install steps already retry. #2367 added a browser cache and a retry, and #2393 bounds each `apt-get` attempt at 3 minutes with two attempts. Both attempts still time out when the mirrors are slow: run 39958278162 (system packages, 18:52–18:58 UTC) and run 39935545264 (`playwright install-deps chromium` exits 100). `gh run rerun --failed` passes in most cases.

Each failure needs a person or the master agent to rerun the job, and it blocks plan approval and the merge watcher until then. Plan PRs #2425 and #2396 waited on it on 2026-10-23.

The earlier plan `2026-10-23-ci-board-integration-fails-when-the` (#2360) tuned the retry and the cache key. This plan removes the dependency those fixes still carry.

## Design

### Approach

One measured choice, then one change to the `board-integration` job in `.github/workflows/ci.yml`. The step comment records that the runner image lacks 9 of Playwright's packages (fonts) and holds older versions of 8 more, so `install-deps` fetches 25.9 MB on every run. Three options remove or shrink that fetch:

1. **Cache the `.deb` files or the installed libraries.** A cache hit installs from local files and asks no mirror. The cache key follows the resolved Playwright version, as the browser cache does.
2. **Run the job in `mcr.microsoft.com/playwright`.** The image holds the browser and its libraries, so neither install step runs. The cost is an image pull from another registry, a pin that follows the Playwright version, and a job that no longer runs on the bare runner image the other jobs use.
3. **Skip `install-deps` when the runner's libraries already satisfy Chromium.** The step comment records that `install-deps --dry-run` reports packages missing on every run, so this option holds only if the missing fonts are not needed for the tests to pass. The slice measures that before it relies on it.

The slice reads the failed runs named above, measures the three options against them (install time, hit rate, and whether the board tests pass), and picks the one whose failure mode is smallest. A cache is the default, because it changes the least: a cache miss falls back to today's retried install.

### Open Questions

- [ ] Do the board tests pass without the 9 missing font packages? The answer decides whether option 3 is available.
- [ ] Does the `.deb` cache restore cleanly when the runner image's package versions change, or does it need a key on the image version?
- [ ] Does the Playwright container image keep the job inside its `timeout-minutes` on a cold pull?

## Slices

### Mirror independence

- `infra/board-integration-does-not-need-the-apt-mirrors` — remove the per-run apt fetch from the `board-integration` job, by the option the measurement favours <!-- builds: a Playwright system-package cache or container in the board-integration job of ci.yml -->

## Notes

- Source: tracker issue #2444, 2026-10-23.
- Related: #2367 (cache and retry), #2393 (bounded `apt-get` attempts), plan `2026-10-23-ci-board-integration-fails-when-the`.
