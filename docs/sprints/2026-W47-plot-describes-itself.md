# Sprint: Plot describes itself

> Plot can take over the software development part of the operator's home automation: a second operator follows Plot's own documents to an unattended run, and that run has a spend cap and a delivery measure.

## Status

- **State:** Active
- **Start:** 2026-11-21
- **End:** 2026-12-04
- **Owner:** eins78
<!-- Optional. The version this sprint is working toward, named before it is
     cut. With it, /plot-release refuses to cut past an unfinished Must Have
     and asks about unfinished Should Haves. Without it, nothing changes. -->
- **Release:** 2.37.0

## Sprint Goal

A reader who did not build Plot finds in Plot's own documents what the automation does. The same reader follows the documents from install to the first autonomous run without help.

The operator hands the software development part of the home automation to Plot instead of building more infrastructure for it. Two conditions come before that hand-off: a run that nobody watches has a ceiling, and the delivery is measured so that the hand-off can be judged. The research dossier "Plot as a factory" of 2026-11-20 names both (`gap-spend-cap`, `gap-delivery-metrics`).

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

- [ ] [the-default-runner-has-a-spend-cap] The default runner has a spend cap (plan PR #3698) <!-- pr: #3698, branch: feature/the-default-runner-has-a-spend-cap -->
- [x] [delivery-is-measured-from-the-plan-files] Delivery is measured from the plan files (plan PR #3698) <!-- pr: #3698, branch: feature/delivery-is-measured-from-the-plan-files -->
- [ ] [the-board-refuses-unauthenticated-remote-writes] The board refuses unauthenticated remote writes (#3311, plan PR #3699) <!-- pr: #3699, branch: bug/the-board-refuses-the-remote-write-opt-in -->

### Could Have
- [ ] [fleet-state-is-read-whole-and-from-one-home] Fleet state is read whole and from one home (#3207) <!-- pr: #3609, branch: bug/a-new-failure-on-main-starts-a-repair -->
- [x] [reports-name-their-cause-and-ci-selects-their-tests] Reports name their cause and CI selects their tests (#3160) <!-- pr: #3611, branch: bug/a-failed-sibling-tag-read-is-cannot-tell --> <!-- reconciled: released -->
- [ ] [shell-scripts-refuse-a-second-mode-and-name-the-fetch] Shell scripts refuse a second mode and name the fetch (#3138) <!-- pr: #3612, branch: bug/boardctl-and-dispatch-refuse-a-second-mode -->
- [ ] [github-refuses-a-merge-into-a-red-main] GitHub refuses a merge into a red main <!-- pr: #3691, branch: docs/the-repository-requires-plot-main -->

<!-- add items here -->
- [ ] [fleetctl-runs-in-a-submodule-checkout] fleetctl runs in a submodule checkout (#3043, plan PR #3699) <!-- pr: #3699, branch: bug/the-repo-root-reads-core-worktree -->
- [ ] [plot-init-checks-for-the-bb-cli] /plot-init checks for the bb CLI (#2533, plan PR #3699) <!-- pr: #3699, branch: bug/plot-init-proposes-the-bb-install -->
- [ ] [a-refused-bb-call-writes-no-budget-row] A refused bb call writes no budget row (#3690, plan PR #3699) <!-- pr: #3699, branch: bug/a-refused-bb-call-writes-no-budget-row -->
- [x] [a-held-board-shows-the-indexed-tickets] A held board shows the indexed tickets (#3551, plan PR #3699) <!-- pr: #3699, branch: bug/a-held-board-shows-tickets-after-its-first-render -->
- [ ] [the-checklist-badge-reads-the-newest-release] The checklist badge reads the newest release (#1839, plan PR #3699) <!-- pr: #3699, branch: bug/the-checklist-badge-orders-by-version -->

### Deferred
- [ ] [the-bitbucket-client-sends-an-access-token] The Bitbucket client sends an access token (#3689, plan PR #3699) <!-- pr: #3699, branch: bug/the-bitbucket-client-sends-an-access-token -->

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

<!-- Filled during /plot-sprint close: What went well / What could improve / Action items -->

## Notes

- This sprint runs on Jan's fleet alone: one supervisor per repository, because two supervisors would both dispatch, review and merge its slices. The second operator runs the guide's first autonomous run (`a-guide-leads-from-install-to-the-first-autonomous-run`) in a separate repository, not on this sprint's slices.
- Verification of delivered plans (`/plot-deliver --verify`) runs on each plan of the sprint as a trial.
- The sprint's close judges whether verification stays on.
- Start this sprint only when no other sprint is active: the fleet reads no scope while `docs/sprints/active/` holds more than one sprint.

### Scope Changes
- 2026-11-24: Deferred [the-bitbucket-client-sends-an-access-token] from Could — its bb change in quatico-solutions/agent-skills, a quatico-bb release and an upgrade on every machine come first; no plan builds that bb change yet

<!-- Log scope changes here: added/removed items, tier changes, with date and reason -->
<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->

<!-- Session log, decisions, links -->
