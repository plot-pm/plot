# Sprint: Triggers and connectors

> fleetd waits on triggers and reads Bitbucket and Jira in-process, so an idle fleetd pass starts no process and the story *Nothing changed, nothing runs* completes.

## Status

- **State:** Active
- **Start:** 2026-11-11
- **End:** 2026-11-17
- **Release:** 2.36.0

## Sprint Goal

The sprint delivers Phases 7 and 8 of the story [Nothing changed, nothing runs](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md) (#3170), the two phases that remain after sprint `desk-probes-and-liveness` (release 2.35.0):

- Phase 7: Bitbucket and Jira reads move into their connector adapters over Node's HTTPS client, each with its own budget and credentials.
- Phase 8: the watches arm, fleetd waits on triggers and re-reads only what a trigger names, the `git fetch --prune` on every 5 s scan ends, and a 10-minute safety net logs every difference the triggers missed.

The census measures the outcome: S4 (an idle fleetd pass) reaches 0 except on the safety-net pass, on GitHub and on Bitbucket.

It also closes the follow-up issues that sprint `desk-probes-and-liveness` filed.

### Must Have
- [x] [bitbucket-and-jira-read-in-process] Bitbucket and Jira read in-process (#3170) <!-- pr: #3389, branch: feature/bitbucket-and-jira-read-in-process-bitbucket-client -->
- [ ] [triggers-replace-the-tick] Triggers replace the tick (#3170) <!-- pr: #3387, branch: feature/triggers-replace-the-tick-deadlines -->

<!-- An item is `- [ ] <description>`. A leading `[<plan-slug>]` names the plan
     it commits to, and only a plan slug is read as one: `- [ ] [#123](url) …`
     names an issue, so it is an item with no plan and is scored on its
     checkbox. Strike a reference — `~~[<plan-slug>]~~` — to mark an item that
     left the sprint; the plan's own state then says whether it was withdrawn. -->

### Should Have

- [ ] [#3368](https://github.com/plot-pm/plot/issues/3368) `plot-ask merge` reads in-progress re-run checks as pending
- [ ] [#3369](https://github.com/plot-pm/plot/issues/3369) fleetd's channel binds a short socket path for a long repository root
- [ ] [#3382](https://github.com/plot-pm/plot/issues/3382) The state-sync PR gate reads `unknown` on a failed read
- [ ] [#3383](https://github.com/plot-pm/plot/issues/3383) `openSyncPr` finds the sync PR beyond the first 100 open PRs
- [ ] [#3384](https://github.com/plot-pm/plot/issues/3384) A snapshot-served story card counts its plan-table plans
- [ ] [#3385](https://github.com/plot-pm/plot/issues/3385) State-sync follow-ups: one exit-code constant, a checked reload, one common-dir read

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

- 2026-11-10: Scope, timebox and release decided by jwloka: Phases 7 and 8 as Must, the six follow-up issues as Should, 2026-11-16 to 2026-11-20, release 2.36.0.
- 2026-11-10: Timebox moved to 2026-11-11 to 2026-11-17 by jwloka, so the sprint starts the day after `desk-probes-and-liveness` closed.

<!-- Session log, decisions, links -->
