# Fleet supervisor holds scale slots too long and misses the configured label

> The fleet supervisor frees a launch's scale-up slot only after `Worker bound`, trusts a stamped pid with no time bound, and `plot-fleetctl.sh --start` checks only the resolved label.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2486
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2536 merged
- **Started:** 2026-10-24, Claude, `bug/fleet-supervisor-liveness-bounds`

## Changelog

- The fleet supervisor frees the scale-up slot of a launch that never gets a pid after a short grace instead of after `Worker bound`.
- A stamped pid in an old manifest counts as a running agent only within a time bound.
- `plot-fleetctl.sh --start` no longer loads a second supervisor when a checkout declares `Fleet label` but runs under the default label.
- `refreshDefaultBranch` logs a lasting unreadable cause once instead of on every daemon tick.

<!-- Board impact: none. No plan format, template, or docs/plans layout change. The helper scripts change (`plot-fleetctl.sh`, `plot-config.sh`), and neither feeds the board's plan parser. -->

## Motivation

Follow-up findings from plot-review on #2070, #2309, #2378, #2420, #2457 and #2462, checked against `origin/main` at `84b1638e4` on 2026-10-24, collected in issue #2486. Three are MEDIUM:

- `packages/fleet/src/server/entry/registryd-main.ts:828`: a launch that never gets a pid holds a scale-up slot for `Worker bound` (8 h). A scale-up that cannot start its agent blocks the next one for a working day.
- `packages/fleet/src/shared/queue-reading.ts:650`: a stamped pid in an old manifest counts as a running agent with no time bound. A reused pid inflates the running count and holds slots.
- `skills/plot/scripts/plot-fleetctl.sh:629`: only the resolved label is checked on `--start`. A checkout that declared `Fleet label` but still runs under the default label (after an upgrade) gets a second supervisor.

The remaining findings are LOW: comment, changeset and doc wording that no longer matches behaviour, one log that repeats per tick, and test structure.

## Design

### Approach

The slices group the findings by the code they touch, so each branch has one reviewer-sized diff.

- **Agent liveness bound.** Replace the `Worker bound` hold for a pid-less launch with a short grace. Bound the stamped-pid count by a time limit. `readQueue` takes liveness (`alive`) as a reading so tests pin it and no longer read the real process table. Domain rules stay synchronous and take readings as values (see `CLAUDE.md`, *The Domain Package*). Reword `.changeset/first-tick-after-start-counts-agents.md`, which cites "Worker bound or pid liveness".
- **Label check.** `plot-fleetctl.sh --start` checks the default label and the configured `Fleet label` before it loads a supervisor. Extend `startAndReadLabel` in `test/reconcile/fleetctl.test.mjs` instead of copying it, and drop the neither-variable-nor-key test that duplicates an existing one. The header and the "THE LABEL IS OVERRIDABLE…" heading (`plot-fleetctl.sh:71`) describe the config-key precedence. Put the git check and the `repo_root` assignment on separate lines if the shell-line gate (`scripts/check-shell-lines.sh`) allows it.
- **Log once.** `refreshDefaultBranch` (`default-branch-refresh.ts:181`) warns once per lasting cause and warns again when the cause changes or the reading recovers.
- **Wording.** `plot-config.sh` header lists `Fleet label`. `com.plot-pm.fleetd.plist` and the other places that say the label comes from `PLOT_FLEET_LABEL` alone state the precedence. `skills/plot-fleet/SKILL.md:259` shows a current desk name instead of `plot-wt-free-3`. The refused-hold describe block in `packages/domain/test/queue.test.ts:995` moves out from between a doc comment and the block it documents. The comment at `registryd-main.ts:2641` says the refused hold prints its reason too.

### Open Questions

- [ ] What grace period frees a pid-less launch? Measure how long a healthy launch takes from start to stamped pid before choosing a number.
- [ ] What time bound applies to a stamped pid in an old manifest, and does it reuse `Worker bound` or a separate key?
- [ ] Do the stamped-pid and pid-less bounds share one rule in `packages/domain`, or does the fleet package own both?

## Slices

### Liveness

- `bug/fleet-supervisor-liveness-bounds` — bound the pid-less launch hold and the stamped-pid count, and give `readQueue` an `alive` reading

### Label

- `bug/fleetctl-start-checks-configured-label` — `--start` checks the default and the configured label, and the fleetctl tests share one helper

### Log and wording

- `bug/fleet-review-followups-wording` — log a lasting default-branch cause once, and correct the comments, changeset, plist, `plot-config.sh` header and `plot-fleet/SKILL.md` wording

## Notes

- Created from tracker issue #2486 by `/plot-idea`, unattended. The issue is the problem statement and no tracker write was made.
- Design question not answered in the prompt, so the plan starts in Draft.
- Definition of Done: `docs/definition-of-done.md`.
