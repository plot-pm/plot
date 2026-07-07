# Close the drift loop: /plot drift summary + /plot-deliver verification gate

> Make drift visible where users already look (/plot) and prevent the biggest drift source at write time (/plot-deliver post-condition), completing the reconcile story started in #34.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->

## Changelog

- `/plot` prints a one-line drift summary when the reconcile scan finds anything, pointing at `/plot-reconcile`
- `/plot-deliver` verifies its own delivery landed (phase flipped, symlink moved) by re-running the reconcile scan scoped to the delivered slug

## Motivation

`/plot-reconcile` (PR #34) closes the *aggregate* drift loop: a periodic sweep catches what per-delivery attention misses. Two complements remain, both identified during its review:

1. **Discoverability.** A sweep only helps if it runs. `/plot` is the habitual entry point ("what's the state, what next?") and already pays the fetch cost — a single advisory line (`⚠ 3 hygiene findings — run /plot-reconcile`) makes drift ambient without adding a command to remember or a wall of report output to a casual status call.
2. **Prevention.** Downstream evidence (issue #33: 15 stale phases in one sweep; fresh drift right after a delivery batch) shows `/plot-deliver` itself is the biggest drift source — it is a multi-step write (flip phase, move symlink, commit) with no post-condition check. A scoped re-scan of the just-delivered slug turns the half-delivery failure mode into an immediate, fixable error instead of drift discovered weeks later. This supersedes the opt-in "post-deliver nudge" idea from issue #33 design question 2: a targeted gate needs no config key and no prompt fatigue, and it fits Principle 7 (phase guardrails) — it is the delivery guardrail pointed at plot's own write.

The periodic sweep stays valuable for what no gate can catch (manual edits, legacy plans, external branch state); this plan makes the common path self-checking.

## Design

### Approach

Both branches build on `plot-reconcile-scan.sh` and the shared helpers from #34 (`plot-plan-meta.sh`, `plot-config.sh`) — no new scanning logic.

- **`/plot` hook:** dispatcher runs the scan (`--no-fetch`, reusing its own fetch) in step 1 (Read State), counts findings in sections 1/2/3/5, and appends one advisory line to the status summary when the count is non-zero. Small-tier per the dispatcher's Model Guidance — mechanical count, no judgment; the pointer to `/plot-reconcile` is where judgment happens.
- **`/plot-deliver` gate:** after the delivery commit, re-run the scan and check the just-delivered slug appears in no finding section (grep the report for the plan's dated basename). If it does, the delivery half-landed — surface the finding and its printed fix immediately, before declaring success. Add a scoped mode to the scan if grep-the-report proves too coarse (`--plan <file>`), but start without it.

### Open Questions

- [ ] Should the `/plot` hook be skippable (env/config) for very large repos where the scan adds noticeable latency, or is `--no-fetch` cheap enough everywhere?
- [ ] Does the gate need `--plan <file>` scoping in the scan, or is report-grep sufficient?

## Branches

- `feature/reconcile-plot-hook` — one-line drift summary in the `/plot` dispatcher status output
- `feature/reconcile-deliver-gate` — post-delivery verification in `/plot-deliver` (re-scan, assert the delivered slug is clean)

## Notes

- Depends on #34 (plot-reconcile) being merged; implementation starts after.
- Origin: review discussion on #34 / issue #33 design question 2 (the opt-in nudge proposal, superseded here by the scoped gate).
