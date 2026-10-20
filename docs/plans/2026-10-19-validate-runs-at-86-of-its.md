# validate runs at 86% of its 25-minute cap, and a slow runner reports green work as cancelled

> The `validate` job finishes inside its 25-minute cap with margin, and a job that reaches the cap reads as a timeout, not as a cancellation.

## Status

- **State:** Delivered
- **Type:** infra
- **Issue:** #2121
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2124 merged
- **Started:** 2026-10-19, Jan Wloka, `infra/validate-step-budget`
- **Started:** 2026-10-20, Jan Wloka, `infra/a-timeout-reads-as-a-timeout`
- **Delivered:** 2026-10-20

## Changelog

- CI: the `validate` job runs inside its cap with margin, and a run that hits the cap is reported as a timeout.

Board impact: none expected. The second slice changes what `plot-host.sh` and `checks-verdict.ts` report for a run that hit its cap; the board reads that verdict.

## Motivation

On 2026-10-19 three PR runs of `validate` ended `cancelled` or `failure`, and the same heads passed on re-run (#2121). `validate` has `timeout-minutes: 25` (`.github/workflows/ci.yml:194`). GitHub reports a job that reaches its timeout as `cancelled`.

| run | PR | validate | duration |
|---|---|---|---|
| 39276878253 (attempt 2) | #2108 | cancelled, every step `success` | 25 min 2 s |
| 39285997860 | #2109 | success | 21 min 32 s |
| 39283846486 | #2104 | failure | 24 min 48 s |

Steps of run 39276878253 attempt 2 (sum 23 min 42 s):

| step | seconds |
|---|---|
| Board integration tests (vitest + Playwright) | 574 |
| Helper contract tests | 538 |
| Fleet unit tests + loop coverage gate | 124 |
| Domain tests + coverage gate | 49 |
| E2E choreography tests | 47 |
| Board tests | 39 |
| Fleet bundle tests | 36 |

Two steps hold 78 % of the time. The comment above the cap in `ci.yml` says a green run takes about 7 minutes (measured 2026-08-19); a healthy run now takes 21 to 24 minutes, so the cap has no margin. A `cancelled` result costs a 20-minute re-run, a desk question (`no-answer`, #2106) and a stalled merge queue.

## Design

### Approach

1. **Measure first.** Read the step durations of the last 30 `validate` runs on `main` and on PRs. Record median, p95 and maximum per step in this plan. The numbers above are one run; the plan decides on the distribution.
2. **Cut the job's wall time.** Two options, chosen from the measurement:
   - split the two largest steps (Board integration, Helper contract) into their own jobs that run in parallel with `validate`;
   - bound the slow step with its own `timeout-minutes`, so a hang there fails that step with its own name.
   The target is a p95 of at most 60 % of the cap, or a cap raised only if a split does not reach that.
3. **Report a timeout as a timeout.** GitHub gives a job that reached its cap the conclusion `cancelled`. Plot reads that word in `plot-host.sh` (line 4651) and `rules/checks-verdict.ts` (lines 141–162, 254). The slice decides how to tell the two apart, for example a step-level `timeout-minutes` that makes the step `failure`, or a job-end marker step with `if: always()` that records the elapsed time. It then makes the desk and `plot-ask.mjs merge` tell the two apart.

### Measured distribution (30 runs, main and PRs, 2026-10-20)

Every `validate` step with `started_at`/`completed_at` set, read from `repos/plot-pm/plot/actions/runs/<id>/jobs`. Seconds, n=30 unless noted.

| step | median | p95 | max |
|---|---|---|---|
| Board integration tests (vitest + Playwright) | 542.5 | 600.0 | 606.0 |
| Helper contract tests | 462.5 | 547.6 | 554.0 |
| Fleet unit tests + loop coverage gate | 123.0 | 125.0 | 125.0 |
| E2E choreography tests | 43.0 | 47.0 | 47.0 |
| Domain tests + coverage gate | 38.0 | 47.5 | 48.0 |
| Fleet bundle tests | 36.0 | 36.5 | 37.0 |
| Board tests | 29.5 | 37.0 | 37.0 |
| Install Playwright browser | 11.0 | 14.1 | 15.0 |
| Domain typecheck | 6.0 | 7.0 | 7.0 |
| Board typecheck | 6.0 | 8.0 | 8.0 |
| Build the board bundles | 4.0 | 5.5 | 6.0 |
| Cache the Playwright browser | 3.5 | 5.0 | 6.0 |
| Board build + artifact freshness | 3.5 | 4.5 | 5.0 |
| Fleet typecheck | 3.0 | 5.0 | 5.0 |
| remaining ~40 gate/checkout/setup steps | ≤1.0 each | ≤2.0 each | ≤5.0 each |
| **`validate` total (sum of steps)** | **1343.0** | **1514.0** | **1515.0** |
| **`validate` total, Board integration + Helper contract removed** | **345.0** | **375.65** | **382.0** |

Two steps hold 74.3 % of the median total (998.0 s of 1343.0 s). 3 of 30 runs ended at the job cap (1500 s = 25 min) with every executed step `success`; a 4th ended `cancelled` with the same signature. With the two steps split into their own jobs, `validate`'s own remaining p95 is 375.65 s — 25.0 % of the 1500 s cap, against the plan's 60 % (900 s) target.

### Open Questions

- [x] **Does GitHub expose the timeout cause in the jobs API (`steps[].conclusion`, annotations), so Plot can read it with no workflow change?** Yes. All 4 `cancelled` runs in the 30-run sample carry the same step-level fingerprint: every step up to the one running when the cap fired is `success` or `skipped` (pre-dispatch-guard steps), the step that was running reads `cancelled` itself, and every step after it is `skipped`. `steps[].conclusion` alone tells a timeout-caused cancellation apart from one where the job never started — no annotation and no workflow change needed.
- [x] **Do the split jobs need to be separate required checks, and does the branch ruleset (`Default branch checks: CI`) name `validate` only?** Confirmed via the live ruleset API (`repos/plot-pm/plot/rulesets/24412719`): required contexts are `validate` and `plot/review` only. A new job with no edge into `validate` is invisible to the ruleset. This slice uses a `needs:` edge from `validate` onto the two new jobs rather than a ruleset change — see the PR description for the full reasoning. A ruleset change (adding `helper-contracts` and `board-integration` as their own required contexts) remains available if a person prefers it; that edit is not made here.
- [x] **Does a `cancelled` run caused by a superseding push (concurrency group) differ from a timeout in the data Plot reads?** All 4 `cancelled` runs in this 30-run sample were timeouts (same fingerprint above); none was a concurrency-group supersession, so the sample has no example of that case to compare against. Expected difference, from how GitHub's concurrency cancellation works: a superseded run is cancelled before any step starts, so every step reads `skipped` (none `success`, none `cancelled`) — a run with at least one `success` step before the `cancelled` one is a timeout, a run with zero non-skipped steps is a supersession. Wave 2 (`infra/a-timeout-reads-as-a-timeout`) should verify this against a real superseded run rather than relying on this inference alone.

## Slices

### Measure and bound

- `infra/validate-step-budget` — measure the last 30 runs, then split or bound the slow steps so p95 stays at or below 60 % of the cap → #2141

### Report

- `infra/a-timeout-reads-as-a-timeout` — a run that reached its cap reads as a timeout in `plot-host.sh` and `checks-verdict.ts`, and the desk and merge script act on that word <!-- waits: infra/validate-step-budget --> → #2149

## Notes

- Source: https://github.com/plot-pm/plot/issues/2121. The plan writes nothing to the tracker.
- Related: #2106 (a desk asks a person when CI gives no answer).
