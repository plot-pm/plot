# Sprint: The board reads the channel

> fleetd holds one snapshot of answers and publishes it over a versioned channel, and a board with a tab open reads that channel and starts no process.

## Status

- **State:** Planning
- **Start:** 2026-11-09
- **End:** 2026-11-13
- **Release:** 2.34.0

## Sprint Goal

The sprint delivers Phases 3 and 4 of the story [Nothing changed, nothing runs](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md) (#3170).

Phase 3 builds the snapshot entity in `@plot-pm/domain`, the watch port and its adapter, a versioned channel that carries readings from fleetd, and a fleetd heartbeat that replaces the 180 s, 2 min and 15 min data-age checks. Phase 4 makes the board serve from that snapshot while fleetd runs, so it starts nothing of its own.

The census measures the outcome. Row S3 (an idle board with one visible tab and fleetd running) read 1248 `execve` per minute on GitHub at the close of sprint `nothing-runs`, against 1429 on the merge base. This sprint turns S3 into a required pass at 0.

All work for this sprint goes to the integration branch `sprint/the-board-reads-the-channel`. The sprint PR merges into `main` at sprint close.

### Must Have
- [ ] [the-snapshot-entity] One snapshot of answers per repository (#3170) <!-- pr: #3278, branch: feature/the-snapshot-entity-entity -->
- [ ] [the-channel-carries-readings] The channel carries the snapshot (#3170) <!-- pr: #3278, branch: feature/the-channel-carries-readings-contract -->
- [ ] [fleetd-heartbeat-not-data-age] fleetd says it is alive on a timer (#3170)
- [ ] [board-reads-the-channel] The board reads fleetd's snapshot and starts nothing (#3170)

<!-- An item is `- [ ] <description>`. A leading `[<plan-slug>]` names the plan
     it commits to, and only a plan slug is read as one: `- [ ] [#123](url) …`
     names an issue, so it is an item with no plan and is scored on its
     checkbox. Strike a reference — `~~[<plan-slug>]~~` — to mark an item that
     left the sprint; the plan's own state then says whether it was withdrawn. -->

### Should Have
- [ ] [quality-gates-fail-fast] Quality gates fail fast

<!-- add items here -->

### Could Have

<!-- add items here -->

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

<!-- Filled during /plot-sprint close: What went well / What could improve / Action items -->

## Notes

### Scope Changes

<!-- Log scope changes here: added/removed items, tier changes, with date and reason -->
<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->

<!-- Session log, decisions, links -->
