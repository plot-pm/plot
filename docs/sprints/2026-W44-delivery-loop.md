# Sprint: The fleet delivers a scope alone

> A person starts a sprint of approved plans, and fleetd carries every plan to Delivered and prepares the release, which waits for one approval.

## Status

- **State:** Closed
- **Actual End:** 2026-11-03
- **Start:** 2026-10-29
- **End:** 2026-11-12
- **Release:** 2.30.0

## Sprint Goal

The ten plans of the story [the-fleet-delivers-a-scope-alone](../stories/archived/the-fleet-delivers-a-scope-alone/STORY-the-fleet-delivers-a-scope-alone.md), built from its design [DESIGN-delivery-loop.md](../stories/archived/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md). Each plan passed one or two panel rounds of four jurors on 2026-10-29, and Jan Wloka decided the open questions. The plans carry 30 slices in 9 dependency levels; cross-plan order is held by `waits:` annotations.

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

- [x] [the-plan-walk-moves-into-the] The plan walk moves into the domain and `plot-fleet-scan.sh` becomes a launcher (#2980) <!-- pr: #2981, branch: feature/scan-once-walks-in-process -->
- [x] [the-commit-gates-match-only-the] The commit gates read every commit form, and a replay or merge in progress passes (#2974) <!-- pr: #2984, branch: feature/replay-aware-commit-gates -->
- [x] [every-plan-reference-shows-its-issue] Every plan reference on the board shows its issue prefix and opens the plan (#2993) <!-- pr: #2994, branch: feature/a-plan-reference-is-decided-once -->
- [x] [an-issue-shows-its-plan-s] An issue shows its plan's state on every surface: lanes read the default branch, released issues carry their label, finding tickets close when settled, one plan comment, a slice row reads its head's checks (#2997) <!-- pr: #2998 -->
- [x] [a-plan-that-joins-a-sprint] A plan that joins a sprint names the sprint: one membership rule, one writer, a gate on added member lines, and a repair of this sprint (#2999) <!-- pr: #3000 -->
- [x] [two-test-teardowns-turn-main-red] Two test teardowns turn main red: a stopped process leaves no plan stage directory, and the continuation tests remove desks after the last write (#3006) <!-- pr: #3008 -->
- [x] [the-board-starts-processes-on-the] The board answers /api/board from held values: a process-count ratchet, one held config, git reads through the walk cache, and one plan parse per blob (#3017) <!-- pr: #3018 -->
- [x] [the-bounded-run-group-stop-test] A stop that lands with the child's exit still stops, and the group-stop test tells a slow stop from a survivor (#3010) <!-- pr: #3019 -->
- [x] [the-agent-reporter-starts-a-sleep] The agent reporter waits on a FIFO without a poll, and the AgentMonitor reads its pid with a builtin (#3024) <!-- pr: #3025 -->
- [x] [fleetd-s-fixer-and-main-repair] fleetd's fixer runs bounded, the role command passes the agents JSON, and a failed role start spends no attempt (#3028) <!-- pr: #3029 -->
- [x] [the-reporter-sigterm-test-fails-on] The agent reporter ignores SIGTERM before it forks, so a group stop no longer loses its report (#3033) <!-- pr: #3039 -->
- [x] [a-slice-held-by-an-open] A slice held by an open wait reads as waiting: no brief or dispatch for a held branch, and the dispatch controller refuses a plan with nothing startable (#3049) <!-- pr: #3050, branch: feature/a-held-slice-reads-as-waiting -->

### Could Have

<!-- add items here -->

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

### What went well

- All 24 items reached Delivered: 12 Must Have and 12 Should Have. Twelve Should Have items joined during the sprint, and each Scope Changes line names the defect that justified it.
- Release 2.30.0 waited for one approval by a person, as the goal states. It was published on 2026-11-03 at `92bbf3e1e` and booked all 24 plans as Released.
- The plan walk moved into the domain (#2980). PR #3048 removed 8,113 lines of shell, and `plot-fleet-scan.sh` is now a 276-line launcher.
- On 2026-11-03 the loop worked without help at four points. fleetd's fixer fixed two HIGH findings on #3048. auto-deliver delivered `the-plan-walk-moves-into-the` and `every-plan-reference-shows-its-issue`. fleetd detected the red main on `f669084` and opened repair PR #3057. The review gate let no HIGH finding through.

### What could improve

- The goal says "alone", and the last day needed four interventions:
  - The desk on #3048 blocked on a design question: close the domain walk's gaps, or keep the shell arm. An Opus fix agent did the work in three pushes.
  - A person merged #3053, because the merge watcher would only have merged it on its next pass.
  - A person merged #3057 in the GitHub UI, because `plot-ask.mjs merge` refused it with `repair-branch-mismatch` (#3058).
  - `release-approve` refused #2934 with `not-release-pr` for the same cause, and then refused it with `review-missing`. A person ran `plot-review` on the release head and approved its waiting `pull_request` CI run, because the `workflow_dispatch` run reports no `validate` check.
- From 2026-10-30, every fixer and main-repair start failed with `--agent not found` (#3028). Each HIGH finding waited 19 to 100 minutes for a hand fix.
- The brief writer for `the-fleet-payload-indexes-its-plans` ended twice at the 5-minute bound with exit 124, because the slice was held by an open wait that the board read as eligible (#3049).
- A delivery commit emptied `docs/plans/active/`, and a corpus test that required an active plan turned main red (#3057).
- The domain walk kept a merged branch at `evidence: subject` while the PR index held its MERGED row, so the deliver controller refused with `scan-incomplete` (#3055, fixed by #3056).
- `pr-state` named no head branch, so the merge controller admitted no repair PR and the release controller refused the release PR (#3058, fixed by #3059).

### Action items

- Measure "alone": run one small approved plan from dispatch to Delivered with no intervention, and record each intervention it still needs.
- Decide how a desk's design question reaches a decision without a person: the unblocker answers it, or the plan must answer it before approval.
- Make the merge watcher merge a green head on the same pass in which its checks turn green.
- Make the release PR carry its own `validate` and `plot/review` without a person: review the release head, and run CI that reports to the PR.

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
- 2026-11-01: Added [the-bounded-run-group-stop-test] the group-stop test turned main red at 926339afd, and a panel reproduced a lost SIGTERM in boundedRunProcess (#3010)
- 2026-11-01: Added [the-agent-reporter-starts-a-sleep] syspolicyd checked about 256 new processes per second, and the reporter and AgentMonitor loops start a process per poll for every agent (#3024)
- 2026-11-01: Added [fleetd-s-fixer-and-main-repair] every fixer and main-repair start since 2026-10-30 failed with --agent not found, so each HIGH waited 19 to 100 minutes for a hand fix (#3028)
- 2026-11-02: Added [the-reporter-sigterm-test-fails-on] the reporter SIGTERM test turned main and PR #3036 red, and a panel reproduced a lost report in reporterShell under a group SIGTERM (#3033)
- 2026-11-02: Added [a-slice-held-by-an-open] the board read a slice held by an unmerged wait as eligible, and three dispatches of it started the brief writer, two ending at the 5-minute bound (#3049)
