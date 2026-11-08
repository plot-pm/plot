# Sprint: Nothing changed, nothing runs

> The process-count gate measures what the board and fleetd start, and the cheap wins cut that count.

## Status

- **State:** Active
- **Start:** 2026-11-09
- **End:** 2026-11-13
- **Release:** 2.33.0

## Sprint Goal

The sprint delivers Phases 1 and 2 of the story [Nothing changed, nothing runs](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md) (#3170).

Phase 1 adds a gate that counts `execve` per minute and per fleetd pass in reproducible fixtures (GitHub and Bitbucket, N desks), and writes each zero target in the story's Measures table as an expected failure. Phase 2 lands the cheap wins, and each one turns one Phase 1 assertion into a required pass.

On 2026-11-05 the board and fleetd of the plot repository started about 90 processes per second with nobody looking. This sprint does not reach zero. It measures the baseline and moves the count down by the items Phase 2 names.

All work for this sprint goes to the integration branch `sprint/nothing-runs`. The sprint PR merges into `main` at sprint close.

### Must Have
- [x] [process-census-gate] A CI gate counts the processes the board and fleetd start (#3170) <!-- pr: #3238, branch: infra/process-census-ci-gate -->
- [ ] [no-tab-no-pulse] A board that no visible tab shows starts no process (#3170) <!-- pr: #3238, branch: feature/no-tab-no-pulse-page -->

<!-- An item is `- [ ] <description>`. A leading `[<plan-slug>]` names the plan
     it commits to, and only a plan slug is read as one: `- [ ] [#123](url) …`
     names an issue, so it is an item with no plan and is scored on its
     checkbox. Strike a reference — `~~[<plan-slug>]~~` — to mark an item that
     left the sprint; the plan's own state then says whether it was withdrawn. -->

### Should Have
- [ ] [monitors-nap-without-sleep] The desk monitors nap and probe liveness without a process (#3170) <!-- pr: #3238, branch: bug/is-alive-without-a-process -->
- [ ] [fixed-answers-once] Answers fixed for a process's life are read once (#3170) <!-- pr: #3238, branch: bug/fixed-answers-once-in-process -->

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
