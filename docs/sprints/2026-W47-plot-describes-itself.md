# Sprint: Plot describes itself

> Plot's own documents describe what runs, and a second operator can follow them.

## Status

- **State:** Planning
- **Start:** 2026-11-21
- **End:** 2026-11-27
- **Owner:** eins78
<!-- Optional. The version this sprint is working toward, named before it is
     cut. With it, /plot-release refuses to cut past an unfinished Must Have
     and asks about unfinished Should Haves. Without it, nothing changes. -->
- **Release:** 2.37.0

## Sprint Goal

A reader who did not build Plot finds in Plot's own documents what the automation does. The same reader follows the documents from install to the first autonomous run without help.

The sprint delivers two plans. One plan makes the documents describe the automation that runs. The other plan adds a guide from install to the first autonomous run. Three smaller changes keep the claims in the documents true. The configuration comments match the code. A gate lists the entries the repository root may hold. The board environment documentation covers the environment and remote access.

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

### Should Have

<!-- add items here -->

### Could Have

<!-- add items here -->

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

<!-- Filled during /plot-sprint close: What went well / What could improve / Action items -->

## Notes

- This sprint runs on a second operator's fleet.
- Verification of delivered plans (`/plot-deliver --verify`) runs on each plan of the sprint as a trial.
- The sprint's close judges whether verification stays on.
- Start this sprint only when no other sprint is active: the fleet reads no scope while `docs/sprints/active/` holds more than one sprint.

### Scope Changes

<!-- Log scope changes here: added/removed items, tier changes, with date and reason -->
<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->

<!-- Session log, decisions, links -->
