# Sprint: The fleet runs safely alone

> The fleet runs a sprint and its release with no person repairing it by hand: every hand repair of the week of 2026-11-23 becomes code.

## Status

- **State:** Planning
- **Start:** 2026-12-04
- **End:** 2026-12-11
- **Owner:** jwloka
<!-- Optional. The version this sprint is working toward, named before it is
     cut. With it, /plot-release refuses to cut past an unfinished Must Have
     and asks about unfinished Should Haves. Without it, nothing changes. -->
- **Release:** 2.39.0

## Sprint Goal

In the week of 2026-11-23 a person repaired the fleet by hand again and again: releases that booked no plan, a slice claimed in the wrong repository, a release PR whose head every merge moved, a review left pending for nine hours, a PR that passed its CI and broke main, and flaky tests that turned main red. This sprint turns each of those repairs into code, so the fleet runs a sprint and its release alone.

### Must Have

<!-- An item is `- [ ] <description>`. A leading `[<plan-slug>]` names the plan
     it commits to, and only a plan slug is read as one: `- [ ] [#123](url) …`
     names an issue, so it is an item with no plan and is scored on its
     checkbox. Strike a reference — `~~[<plan-slug>]~~` — to mark an item that
     left the sprint; the plan's own state then says whether it was withdrawn. -->

- [ ] [plots-documents-describe-the-automation-that-runs] Plot's documents describe the automation that runs (plan PR #3631)
- [ ] [a-guide-leads-from-install-to-the-first-autonomous-run] A guide leads from install to the first autonomous run (plan PR #3633)
- [ ] [#3634](https://github.com/plot-pm/plot/pull/3634) The `Worker bound` and `Slice max runs` comments match the code
- [ ] [#3637](https://github.com/plot-pm/plot/pull/3637) The root-entry gate lists the entries the repository root may hold
- [ ] [#3635](https://github.com/plot-pm/plot/pull/3635) The board environment documentation covers the environment and remote access
- [ ] [a-foreign-slice-is-never-claimed-here] A foreign slice is never claimed here (#3735) <!-- pr: #3740, branch: bug/a-foreign-slice-is-never-claimed-here -->
- [ ] [a-release-between-two-sprints-books-its-plans] A release between two sprints books its plans (#3736) <!-- pr: #3740, branch: bug/a-release-no-sprint-names-books-its-changesets -->
- [ ] [a-release-holds-merges-while-it-waits] A release holds merges while it waits <!-- pr: #3740, branch: bug/a-waiting-release-holds-merges -->
- [ ] [a-launcher-change-selects-its-tests] PR CI selects the contracts that run a changed bundle <!-- pr: #3740, branch: bug/a-bundle-names-its-input-sources -->

### Should Have
- [ ] [supersede-names-a-plan-in-another-repository] Supersede names a plan in another repository (#3710) <!-- pr: #3740, branch: feature/supersede-takes-a-foreign-successor -->
- [ ] [a-stale-pending-review-is-asked-again] A stale pending review is asked again <!-- pr: #3740, branch: bug/a-held-stale-review-names-its-reason -->
- [ ] [a-desk-reads-quiet-from-its-live-signals] A desk reads quiet from its live signals (#3745) <!-- pr: #3747, branch: bug/a-desk-reads-quiet-from-its-live-signals -->

<!-- add items here -->
- [ ] [#3750](https://github.com/plot-pm/plot/issues/3750) A release can be approved on a board reached through its tailnet origin, or the button says why not

### Could Have

<!-- add items here -->

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

<!-- Filled during /plot-sprint close: What went well / What could improve / Action items -->

## Notes

### Scope Changes

<!-- Log scope changes here: added/removed items, tier changes, with date and reason -->

- 2026-11-27: added issue #3750 as a Should Have, from the panel on a-release-holds-merges-while-it-waits.
- 2026-11-27: added the five Must Haves of Max Albrecht (#3631, #3633, #3634, #3635, #3637) from plot-describes-itself.
- 2026-11-27: added issue #3745 as a Should Have: the status read three working agents as quiet for 2 h.
<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->

<!-- Session log, decisions, links -->
