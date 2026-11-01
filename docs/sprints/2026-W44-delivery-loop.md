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

- [x] [ci-runs-what-the-change-touches] Blocker: CI runs what the change touches, and a red main admits its repair PR <!-- branch: feature/ci-selection-rule -->
- [x] [fleet-roles-are-declared-agents] Unattended refusals on merge, continue and release; role agents loaded from the default branch with per-role gates (#2898) <!-- pr: #2908, branch: feature/plot-init-provides-roles -->
- [x] [the-delivery-loop-keeps-a-run] The loop's run log and the idle-slice notification (#2899) <!-- pr: #2909, branch: feature/an-idle-slice-notifies -->
- [x] [fleetd-reviews-every-slice-pr-in] fleetd reviews every slice PR in scope; the index records the review; `slicePrNext` (#2900) <!-- pr: #2917, branch: feature/a-review-opens-no-issue -->
- [x] [fleetd-merges-slice-prs-one-at] One merge in flight, only on `plot/review` success, only through a Merger app (#2902) <!-- pr: #2914, branch: feature/fleetd-merges-one-at-a-time -->
- [x] [a-high-finding-is-fixed-before] Every HIGH goes to a fixer, two attempts, then a ticket (#2903) <!-- pr: #2912, branch: feature/an-unfixed-high-is-ticketed -->
- [x] [the-fleet-answers-plot-blocked-questions] The unblocker answers every agent question and writes each answer into the PR body (#2901) <!-- pr: #2913, branch: feature/fleetd-answers-a-question -->
- [x] [tickets-follow-the-delivery-loop] The plan issue shows slice progress and HIGH tickets (#2905) <!-- pr: #2916, branch: feature/jira-moves-at-approve -->
- [x] [a-dead-desk-gets-a-fixer] A dead desk reads unreadable; a merged PR asks no one (#2906) <!-- pr: #2915, branch: feature/a-dead-desk-reads-unreadable -->
- [x] [a-red-default-branch-is-repaired] A red main is re-run, repaired or reverted within 60 minutes (#2904) <!-- pr: #2910, branch: feature/a-red-main-is-reverted -->
- [x] [the-release-waits-for-one-approval] The release waits for one approval by a person (#2907) <!-- pr: #2911, branch: feature/fleetd-prepares-the-release -->
- [x] [the-bundle-gate-refuses-the-repair] The bundle gate accepts a staged bundle equal to the default branch, so a desk can repair a bundle conflict (#2970) <!-- pr: #2971, branch: feature/the-bundle-gate-refuses-the-repair -->

### Should Have

- [ ] [the-plan-walk-moves-into-the] The plan walk moves into the domain and `plot-fleet-scan.sh` becomes a launcher (#2980)
- [ ] [the-commit-gates-match-only-the] The commit gates read every commit form, and a replay or merge in progress passes (#2974)
- [ ] [every-plan-reference-shows-its-issue] Every plan reference on the board shows its issue prefix and opens the plan (#2993)
- [ ] [an-issue-shows-its-plan-s] An issue shows its plan's state on every surface: lanes read the default branch, released issues carry their label, finding tickets close when settled, one plan comment, a slice row reads its head's checks (#2997) <!-- pr: #2998 -->
- [ ] [a-plan-that-joins-a-sprint] A plan that joins a sprint names the sprint: one membership rule, one writer, a gate on added member lines, and a repair of this sprint (#2999) <!-- pr: #3000 -->
- [ ] [two-test-teardowns-turn-main-red] Two test teardowns turn main red: a stopped process leaves no plan stage directory, and the continuation tests remove desks after the last write (#3006) <!-- pr: #3008 -->
- [ ] [the-board-starts-processes-on-the] The board answers /api/board from held values: a process-count ratchet, one held config, git reads through the walk cache, and one plan parse per blob (#3017) <!-- pr: #3018 -->

### Could Have

<!-- add items here -->

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

<!-- Filled during /plot-sprint close: What went well / What could improve / Action items -->

## Notes

### Scope Changes

<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->

- 2026-10-31: Added [the-plan-walk-moves-into-the] the follow-up to the fleet scan timeouts of #2978 (#2980)
- 2026-10-31: Added [the-commit-gates-match-only-the] the commit gates miss `git -C` and `--continue` commits (#2974)
- 2026-11-01: Added [every-plan-reference-shows-its-issue] the board shows one plan with and without its issue prefix and link (#2993)
- 2026-11-01: Added [an-issue-shows-its-plan-s] an issue's lane, label and finding ticket lag behind its plan's state (#2997)
- 2026-11-01: Added [a-plan-that-joins-a-sprint] three plans joined this sprint with an empty Sprint field, and approve and deliver skip such a plan's sprint line (#2999)
- 2026-11-01: Added [two-test-teardowns-turn-main-red] two teardown leaks failed 8 of 48 main CI runs on 2026-11-01, and a red main refuses every merge (#3006)
- 2026-11-01: Added [the-board-starts-processes-on-the] /api/board took 8 to 61 s on a loaded machine and the board page showed "No contact" while the server ran (#3017)
