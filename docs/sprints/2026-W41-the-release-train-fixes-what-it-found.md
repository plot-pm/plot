# Sprint: The release train fixes what it found

> The release train fixes what it found

## Status

- **State:** Planning
- **Start:** 2026-10-08
- **End:** 2026-10-21
- **Release:** 2.25.0

## Sprint Goal

**The release train fixes what it found.**

Auto-dispatch delivered v2.22 to v2.24 between 2026-10-03 and 2026-10-07. While it ran, it found defects that stopped delivery, moved the default branch, spent corrections during a host outage, and left slices claimed with nobody working on them. This sprint fixes those defects before the fleet takes new feature work.

### Must Have

<!-- An item is `- [ ] <description>`. A leading `[<plan-slug>]` names the plan
     it commits to, and only a plan slug is read as one: `- [ ] [#123](url) …`
     names an issue, so it is an item with no plan and is scored on its
     checkbox. Strike a reference — `~~[<plan-slug>]~~` — to mark an item that
     left the sprint; the plan's own state then says whether it was withdrawn. -->

- [ ] [the-release-train-fixes-what-it-found](../plans/2026-10-07-the-release-train-fixes-what-it-found.md) — twelve fixes, one slice each, ordered by severity: delivery, the corpus pin, continue, unacquired runs, the PR index, spend limits, local checks, charters, the claim release controller, approval findings, the sweep and the vendored helpers.

### Should Have

- [ ] [every-loop-ending-has-a-supervisor-rule](../plans/2026-10-07-every-loop-ending-has-a-supervisor-rule.md) — every loop ending gets one supervisor action: release the claim, a fresh agent, or ask a person (#1274, #1288, #1281).

### Could Have

- [ ] [the-board-reads-a-pr-while-its-ci-runs](../plans/2026-10-07-the-board-reads-a-pr-while-its-ci-runs.md) — the PR-row decision moves into the domain; running CI reads as waiting on a machine (#1164, #1277, #1240).

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

<!-- Filled during /plot-sprint close: What went well / What could improve / Action items -->

## Notes

### Scope Changes

<!-- Log scope changes here: added/removed items, tier changes, with date and reason -->
<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->

- 2026-10-07: Created with three plans in the tiers that jwloka chose.
