# validate runs at 86% of its 25-minute cap, and a slow runner reports green work as cancelled

> The `validate` job finishes inside its 25-minute cap with margin, and a job that reaches the cap reads as a timeout, not as a cancellation.

## Status

- **State:** Approved
- **Type:** infra
- **Issue:** #2121
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2124 merged
- **Started:** 2026-10-19, Jan Wloka, `infra/validate-step-budget`

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

### Open Questions

- [ ] Does GitHub expose the timeout cause in the jobs API (`steps[].conclusion`, annotations), so Plot can read it with no workflow change?
- [ ] Do the split jobs need to be separate required checks, and does the branch ruleset (`Default branch checks: CI`) name `validate` only?
- [ ] Does a `cancelled` run caused by a superseding push (concurrency group) differ from a timeout in the data Plot reads?

## Slices

### Measure and bound

- `infra/validate-step-budget` — measure the last 30 runs, then split or bound the slow steps so p95 stays at or below 60 % of the cap

### Report

- `infra/a-timeout-reads-as-a-timeout` — a run that reached its cap reads as a timeout in `plot-host.sh` and `checks-verdict.ts`, and the desk and merge script act on that word <!-- waits: infra/validate-step-budget -->

## Notes

- Source: https://github.com/plot-pm/plot/issues/2121. The plan writes nothing to the tracker.
- Related: #2106 (a desk asks a person when CI gives no answer).
