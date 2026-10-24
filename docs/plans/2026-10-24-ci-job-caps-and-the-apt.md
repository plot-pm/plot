# CI job caps and the apt cache keep stale packages and hide diagnostics

> Three CI jobs cap at the sum of their step caps, so a wedge ends cancelled before the diagnostic step runs; the apt cache key ignores the package set; and 11 comments and gates carry wrong figures or draft history.

## Status

- **State:** Approved
- **Type:** infra
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2485
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2534 merged
- **Started:** 2026-10-24, Claude, `infra/ci-job-caps-exceed-their-step-caps`
- **Started:** 2026-10-24, Jan Wloka, `infra/ci-comments-state-current-behaviour`

## Changelog

- CI: a wedged `helper-contracts` or `board-integration` run reaches its diagnostic step, the apt cache key follows the package set, and one failing split job no longer hides the other `validate` gates.

<!-- Board impact: none. The changes are in `.github/workflows/ci.yml`, `scripts/`, `packages/domain` comments and one comment in `skills/plot/scripts/plot-host.sh`; none touches the plan format, the template, the board or the `docs/plans` layout. -->

## Motivation

Issue #2485 collects 20 follow-up findings from plot-review of #2144, #2150, #2277, #2370, #2391, #2394 and #2460, checked against `origin/main` at `84b1638e4` on 2026-10-24. Three are MEDIUM and 17 are LOW.

- **A wedge hides its own diagnostic.** `helper-contracts` has `timeout-minutes: 12` (`ci.yml:207`) and its test step has `timeout-minutes: 12` (`ci.yml:308`). When the step cap fires, the job cap fires in the same moment, the job ends cancelled, and the `if: failure()` step "What was still running" never runs. That step exists for exactly this wedge.
- **The apt cache goes stale.** The key follows only the Playwright version (`ci.yml:426`). Cached `.deb` files age as Ubuntu publishes updates, an exact key hit never re-saves, and the stage step copies every `.deb` into the cache (`ci.yml:494`), so `restore-keys` carries obsolete packages across Playwright versions.
- **One claim has no measurement.** Nothing tests that a cancelled run still reads cancelled when `validate` waits on `needs` with `if: !cancelled()` (`ci.yml:534`).
- **One failure hides the others.** `Require the split jobs` is the first `validate` step (`ci.yml:574`), so one failing split job ends `validate` before every other gate in that run reports.
- **The comments state facts that are no longer true.** The remaining findings are comments with a wrong file count, a wrong job name, a cap above its job ceiling, history of an earlier draft, or a stale bundle count (`ci.yml:232`, `:336`, `:406`, `:409`, `:413`, `:416`, `:552`; `checks-verdict.ts:174`; `bounded-run-group-stop.test.ts:23`; `check-helper-table.sh:131`; `plot-host.sh:4844`).

The findings carry line numbers from `84b1638e4`. The slice that edits each file re-measures its line before editing.

## Design

### Approach

Three slices, split by file and by risk, so a reviewer reads each diff against one concern. Slices 1 and 2 both edit `ci.yml` in different jobs; the slice that merges second rebases over the first.

1. **Job caps and the validate gate order.** Each job cap becomes the sum of its step caps plus a margin that covers checkout, setup and the diagnostic step; the step caps stay. The diagnostic step then runs after the step cap fires. `Require the split jobs` moves to the last `validate` step, still under `if: !cancelled()`, so every other gate reports first and the split-job failure is the final line. A test measures that a cancelled run still reads cancelled (`ci.yml:534`); the form of the measurement is open below.
2. **The apt cache and the Playwright version step.** The cache key follows the package set (the `apt-get` simulation or the resolved `.deb` list), so a changed set writes a new entry. The stage step copies only the packages the current run needs, so obsolete `.deb` files leave the cache. The Playwright version step sets `pipefail` and fails on an empty version, so a failed read cannot yield the key `playwright-Linux-`.
3. **Comments and the helper-table gate.** `check-helper-table.sh` reads the declared bundles and the tracked scripts from one source, and its messages name the script that failed (`lib-declared-bundles.sh:72`). Every CI comment in the findings states current caps and steps in the present tense with no draft history. `checks-verdict.ts`, `bounded-run-group-stop.test.ts` and `plot-host.sh` comments state the current figures.

### Open Questions

- [ ] **Job cap margin.** The sum of step caps plus how many minutes? Slice 1 reads the checkout and setup durations from the last 30 runs and sets the margin from p95, not from a round number. The `board-integration` job already carries a 20 minute ceiling; the comment at `ci.yml:336` gives a 20.75 minute worst case on a miss, so that job needs either a cap above 20.75 or a smaller step sum.
- [ ] **Apt cache key source.** Which input names the package set without a network call before the cache restore: a hash of the pinned package list in the repository, or the `apt-get --print-uris` output? The first costs no mirror fetch and needs a manual bump; the second tracks the mirror and costs one `apt-get update`.
- [ ] **How to measure the cancelled-run claim.** A workflow-dispatch run that cancels itself and asserts the `validate` result, or a recorded run id cited in the comment? The first adds a CI job; the second adds no gate and states a fact once.
- [ ] **`check-helper-table.sh` source.** Read both from `HEAD`, or both from the index? The gate runs pre-commit and in CI, and the two moments differ.

## Slices

### Caps and gate order

- `infra/ci-job-caps-exceed-their-step-caps` — job caps exceed their step caps, `Require the split jobs` runs last, the cancelled-run claim is measured → #2557

### Apt cache

- `infra/the-apt-cache-key-follows-the-package-set` — the apt cache key follows the package set, the stage step copies only current packages, the Playwright version step fails on an empty version

### Comments and gates

- `infra/ci-comments-state-current-behaviour` — CI, `checks-verdict.ts`, `plot-host.sh` and `check-helper-table.sh` comments and messages state current behaviour; the helper-table gate reads one source

## Notes

- Source: https://github.com/plot-pm/plot/issues/2485. The plan writes nothing to the tracker.
- The plan keeps the issue's 20 findings in three slices and drops none. A finding that no longer holds on `origin/main` at implementation time is recorded here by the slice that finds it.
