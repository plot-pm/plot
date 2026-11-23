# Sprint: Delivery UI Polish

> The Delivery tab shows where delivery stands at a glance and lets a user act on each item in one step.

## Status

- **State:** Closed
- **Actual End:** 2026-11-23
- **Start:** 2026-11-20
- **End:** 2026-11-21
- **Owner:** jwloka
<!-- Optional. The version this sprint is working toward, named before it is
     cut. With it, /plot-release refuses to cut past an unfinished Must Have
     and asks about unfinished Should Haves. Without it, nothing changes. -->
- **Release:** 2.36.0

## Sprint Goal

Users of the Delivery tab did not understand what they can do and what they must do. The tab answers with words and punctuation where a number, a colour or a verb would do, cuts status text off, shows controls that cannot be used, and shows the same subject twice. This sprint gives the tab one summary header in five groups, seven sections that each fold to a visual summary, rows that start with what to do and link every artifact as a tuple, one ⋯ menu in a fixed last column, a Tickets section that shows what the sprint delivers and what it found, and three activity signals with fixed meanings.

Design spec (outside the repo): `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md`, with mockups in the folder next to it.

### Must Have
- [x] [delivery-link-tuples-everywhere] Every artifact on the Delivery tab is a linked tuple <!-- pr: #3583, branch: feature/delivery-tuple-vocabulary -->
- [x] [every-delivery-section-folds] Every Delivery section folds and says why it is empty <!-- pr: #3583, branch: feature/delivery-section-empty-kinds -->
- [x] [folded-sections-summarise-visually] A folded Delivery section shows what it holds in counters and bars <!-- pr: #3583, branch: feature/folded-sections-summarise-visually -->
- [x] [delivery-tab-has-one-header] The Delivery tab has one header in five groups <!-- pr: #3583, branch: feature/delivery-header-release-group -->
- [x] [delivery-rows-act-from-one-place] Every Delivery row keeps its actions in one ⋯ menu in the last column <!-- pr: #3583, branch: feature/delivery-row-menu-column -->
- [x] [tickets-show-what-the-sprint-delivers-and-found] The Tickets section shows what the sprint delivers and what it found <!-- pr: #3583, branch: feature/scope-ticket-rows-in-the-payload -->

<!-- An item is `- [ ] <description>`. A leading `[<plan-slug>]` names the plan
     it commits to, and only a plan slug is read as one: `- [ ] [#123](url) …`
     names an issue, so it is an item with no plan and is scored on its
     checkbox. Strike a reference — `~~[<plan-slug>]~~` — to mark an item that
     left the sprint; the plan's own state then says whether it was withdrawn. -->

### Should Have
- [x] [delivery-activity-has-three-signals] Delivery activity shows as three signals with fixed meanings <!-- pr: #3583, branch: feature/delivery-activity-signals -->
- [x] [delivery-sections-count-alike] The sprint header and the Fleet section count alike <!-- pr: #3656, branch: feature/a-held-slice-names-its-hold -->

<!-- add items here -->

### Could Have
- [x] [templates-show-named-identifiers] Templates show named identifiers

<!-- add items here -->

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

### What went well

- All 9 plans were delivered, and release 2.36.0 was published on 2026-11-23 at 17:25 UTC.
- Main recovered from every red episode on the same day. The repair record admitted the one repair PR (#3685) while the default-branch hold refused every other merge.
- The fixer resolved the conflict on #3665 within 28 minutes of its desk being stopped, and the Merger app merged it.
- The review found two real HIGH defects in #3653 before it merged: the commit route rejected Bitbucket's short merge commit, and a merged same-branch plan's approval was committed locally and never pushed.

### What could improve

- Main went red four times on 2026-11-22 and 2026-11-23. Three were flaky tests: `page-hears-channel.browser.test.ts`, `worker-log.browser.test.ts` (a 30 s timeout) and the dispatch test "the wrapper's gone line follows a hop to the new desk". One was a real break: #3653 passed its PR CI, but the contract tests in `approve-batch.test.mjs` failed against the rebuilt bundle on main.
- Five PRs were merged on GitHub with the admin bypass of ruleset `main` (#3682 while main was red, then #3683, #3684, #3686 and #3687 within minutes of each other), so the default-branch hold never ran for them.
- A `plot/review` run stayed `pending` on #3658 for nine hours, from 12:51 to 22:02 UTC, and nothing noticed.
- The release PR got a new head with every merge into main, so the first release approval landed on an old head and had to wait for the merges to stop.
- The sprint ended on 2026-11-21 and closed two days late.

### Action items

- [ ] Deliver `github-refuses-a-merge-into-a-red-main`, a Could Have of the next sprint, so that the GitHub merge button shows the red-main hold.
- [ ] File an issue: PR CI runs the contract suites against freshly built bundles, so that a PR like #3653 fails before it merges.
- [ ] File an issue for the three flaky tests, with the failing run of each.
- [ ] File an issue: a `plot/review` status that stays `pending` past `Checks wait` gets a new review run.
- [ ] Hold merges into main while a release PR waits for its approval.

### Metrics

- **Must-haves completed:** 6/6
- **Should-haves completed:** 2/2
- **Could-haves completed:** 1/1
- **Deferred items:** 0
- **Scope changes during sprint:** 2
- **Duration:** planned 2 days, actual 4 days

## Notes

### Scope Changes
- 2026-11-21: Added [templates-show-named-identifiers] to Could — dispatched 2026-11-21; operator added it to count it in this sprint
- 2026-11-22: Added [delivery-sections-count-alike] to Should — the operator read the sprint header and the Fleet section as contradicting each other

<!-- Log scope changes here: added/removed items, tier changes, with date and reason -->
<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->

<!-- Session log, decisions, links -->
