# Sprint: The fleet delivers a scope alone

> A person starts a sprint of approved plans, and fleetd carries every plan to Delivered and prepares the release, which waits for one approval.

## Status

- **State:** Active
- **Start:** 2026-10-29
- **End:** 2026-11-12
- **Release:** 2.30.0

## Sprint Goal

The ten plans of the story [the-fleet-delivers-a-scope-alone](../stories/the-fleet-delivers-a-scope-alone/STORY-the-fleet-delivers-a-scope-alone.md), built from its design [DESIGN-delivery-loop.md](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md). Each plan passed one or two panel rounds of four jurors on 2026-10-29, and Jan Wloka decided the open questions. The plans carry 30 slices in 9 dependency levels; cross-plan order is held by `waits:` annotations.

### Must Have

- [ ] [ci-runs-what-the-change-touches] Blocker: CI runs what the change touches, and a red main admits its repair PR <!-- branch: feature/ci-selection-rule -->
- [ ] [fleet-roles-are-declared-agents] Unattended refusals on merge, continue and release; role agents loaded from the default branch with per-role gates (#2898) <!-- pr: #2908, branch: feature/plot-init-provides-roles -->
- [x] [the-delivery-loop-keeps-a-run] The loop's run log and the idle-slice notification (#2899) <!-- pr: #2909, branch: feature/an-idle-slice-notifies -->
- [ ] [fleetd-reviews-every-slice-pr-in] fleetd reviews every slice PR in scope; the index records the review; `slicePrNext` (#2900) <!-- pr: #2917, branch: feature/a-review-opens-no-issue -->
- [ ] [fleetd-merges-slice-prs-one-at] One merge in flight, only on `plot/review` success, only through a Merger app (#2902) <!-- pr: #2914, branch: feature/fleetd-merges-one-at-a-time -->
- [ ] [a-high-finding-is-fixed-before] Every HIGH goes to a fixer, two attempts, then a ticket (#2903) <!-- pr: #2912, branch: feature/an-unfixed-high-is-ticketed -->
- [ ] [the-fleet-answers-plot-blocked-questions] The unblocker answers every agent question and writes each answer into the PR body (#2901) <!-- pr: #2913, branch: feature/fleetd-answers-a-question -->
- [ ] [tickets-follow-the-delivery-loop] The plan issue shows slice progress and HIGH tickets (#2905) <!-- pr: #2916, branch: feature/jira-moves-at-approve -->
- [ ] [a-dead-desk-gets-a-fixer] A dead desk reads unreadable; a merged PR asks no one (#2906) <!-- pr: #2915, branch: feature/a-dead-desk-reads-unreadable -->
- [ ] [a-red-default-branch-is-repaired] A red main is re-run, repaired or reverted within 60 minutes (#2904) <!-- pr: #2910, branch: feature/a-red-main-is-reverted -->
- [ ] [the-release-waits-for-one-approval] The release waits for one approval by a person (#2907) <!-- pr: #2911, branch: feature/fleetd-prepares-the-release -->

### Should Have

<!-- add items here -->

### Could Have

<!-- add items here -->

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

<!-- Filled during /plot-sprint close: What went well / What could improve / Action items -->

## Notes

### Scope Changes

<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->
