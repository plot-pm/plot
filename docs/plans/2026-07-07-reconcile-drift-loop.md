# Close the drift loop: /plot drift summary + /plot-deliver verification gate

> Make drift visible where users already look (/plot) and prevent the biggest drift source at write time (/plot-deliver post-condition), completing the reconcile story started in #34.

## Status

- **Phase:** Approved
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

- **`/plot` hook:** dispatcher runs the scan (`--no-fetch`, reusing its own fetch) in step 1 (Read State) and appends one advisory line to the status summary when anything was found. To make that count mechanical and small-model-proof, the hook branch also adds a machine-countable **summary footer** to the scan report (e.g. `summary: drift=1 merged_not_delivered=1 stale=3 attention=0 concurrent=1 pr_source=gh main=main`) — the hook greps that single line instead of parsing section bodies, and `/plot-reconcile`'s Automation Output fills from it. Small-tier per the dispatcher's Model Guidance; the pointer to `/plot-reconcile` is where judgment happens.
- **Scan performance (prerequisite for ambient use):** measured 3.4s for 12 plans (`--no-fetch`) — the scan spawns a parser+jq subprocess chain per plan, twice; extrapolated ~15s at 90 plans, too slow for a hook on every `/plot`. The hook branch therefore (a) gives `plot-plan-meta.sh` a multi-file mode (all plans parsed in one invocation, JSON-lines out), (b) makes the scan parse each plan once and reuse the result across sections 1/2/5, and (c) wraps the hook's scan call in a `timeout 10` with a graceful "sweep skipped — run /plot-reconcile" line when exceeded. Contract tests extend to the multi-file mode and the summary footer.
- **`/plot-deliver` gate:** after the delivery commit, re-run the scan and grep the report for the delivered plan's **dated basename** — it appears only in plan-finding lines (sections 1, 2, 5; branch lines can't contain it), so a hit means the delivery half-landed: surface the finding and its printed fix immediately, before declaring success. The just-merged impl branch will often legitimately appear in section 3 as a deletion candidate — the gate surfaces that as optional housekeeping, not as a failure. No `--plan` scoping needed for v1.

### Open Questions

- [x] ~~Should the `/plot` hook be skippable for very large repos?~~ Resolved by measurement (2026-07-08): not config — make the scan cheap (multi-file parser mode, single parse pass) and bound the hook with `timeout 10` + graceful skip line. No config key in v1.
- [x] ~~Does the gate need `--plan <file>` scoping, or is report-grep sufficient?~~ Resolved: report-grep on the dated basename is precise (basename occurs only in plan-finding lines); section-3 hits for the just-merged branch are expected and reported as optional housekeeping.

## Branches

<!-- Workflow compressed by maintainer decision (Max, 2026-07-08): both
     features are implemented directly on this plan's idea branch and land
     with the plan in one PR (#35), instead of fanning out. No separate
     impl branches exist. -->

- `idea/reconcile-drift-loop` — plan + both features (dispatcher hygiene line; deliver step 7b gate; scan summary footer; multi-file parser) → #35

## Notes

- Built on #34 (plot-reconcile); this PR's branch merges #34's branch in, so it is self-contained — the overlap collapses from the diff once #34 merges. Merge order: #34 first, then #35.
- **Workflow note:** plan approval and implementation were deliberately compressed into this single PR (maintainer decision, 2026-07-08) — the plan file, its resolution of both open questions, and the implementation are reviewed together. After merge, run `/plot-deliver reconcile-drift-loop` to flip the phase and move the symlink — which now exercises the very gate this plan adds.
- Origin: review discussion on #34 / issue #33 design question 2 (the opt-in nudge proposal, superseded here by the scoped gate).
