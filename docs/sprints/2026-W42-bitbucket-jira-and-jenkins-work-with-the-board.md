# Sprint: Bitbucket, Jira and Jenkins work with the board

> A project hosted on Bitbucket, tracked in Jira and built on Jenkins works with the board as well as a GitHub project does.

## Status

- **State:** Active
- **Start:** 2026-10-16
- **End:** 2026-10-23
- **Release:** 2.28.0

## Sprint Goal

**A project hosted on Bitbucket, tracked in Jira and built on Jenkins works with the board as well as a GitHub project does.**

The board and the fleet were built against GitHub, GitHub issues and GitHub Actions. The three connector plans close the gaps that stop a Bitbucket, Jira and Jenkins project from using the same lifecycle: the host connector (#1848), the tracker connector (#1849) and the CI connector (#1867). The ticket index and the ticket rows make the assigned tickets of such a project visible and current on the board.

### Must Have

- [x] [bitbucket-parity-and-app-identities] Host connector: Bitbucket parity and App identities (#1848)
- [x] [jira-inbox-and-issue-index] Tracker connector: Jira inbox and issue index (#1849)
- [x] [the-agent-s-ci-wait-never] Jenkins CI: the agent's CI wait settles, and a Jenkins check binds to a commit (#1867)
- [x] [plot-reads-as-an-unknown-tracker] `Tracker: plot` reads the git host's issues, not an unknown tracker (#2077)
- [x] [bitbucket-jenkins-pr-list-rows-past] Bitbucket + Jenkins: pr-list rows past the lookup cap read unbound (#2154)
- [x] [a-sha-bound-run-reports-the] Jenkins: a sha-bound run reports the PR head, not the merge base, and builds that never ran are not listed (#2153)
- [x] [pr-state-and-pr-list-never] Bitbucket: the desk reads mergeable from a local merge-tree check (#2156)
- [x] [plot-on-a-bitbucket-repository-lists] Bitbucket with `Tracker: plot` lists tickets, and a Plot sprint has a `Sprint owner` (#2169)
- [x] [bitbucket-jenkins-a-pr-list-row] Bitbucket + Jenkins: a row past the lookup cap reads "not looked up", not Jenkins unknown (#2170)
- [x] [merge-commit-not-in-this-clone] Reconcile: a merge commit not in this clone (#2155)
- [x] [plot-pr-merged-sh-asks-gh] `plot-pr-merged.sh` asks the host through `plot-host.sh`, not `gh` (#2186)
- [x] [pr-state-and-pr-merged-miss] Bitbucket: pr-state and pr-merged ask per branch, so old merged PRs read merged (#2187)
- [x] [pr-state-and-pr-list-still] Bitbucket: pr-state and pr-list answer mergeable outside the desk (#2188)
- [x] [a-sprint-cannot-be-read-as] Jira tracker: a Plot sprint reads as a Jira Release (fixVersion) (#2212)
- [x] [jira-issue-list-limit-above-one] Jira: issue-list --limit above one page pages or says so (#2213)
- [x] [resolve-the-release-of-a-pr] Reconcile: resolve the release of a PR merged into a deleted branch (#2215)
- [x] [bitbucket-with-tracker-plot-the-message] Bitbucket with `Tracker: plot`: the message names the working configuration (#2216)
- [x] [jenkins-run-for-sha-can-answer] Jenkins: run-for-sha skips builds that never ran (#2214) <!-- pr: #2225, branch: bug/jenkins-run-for-sha-can-answer -->
- [x] [a-sha-lookup-matches-a-build] Jenkins: a sha lookup matches a build on its built revision, not its merge base (#2229)
- [x] [sprint-release-comparison-drops-must-haves] Sprint/Release comparison drops Must Haves whose Jira key is not on an Issue: line (#2248)
- [x] [reconcile-23-checks-no-plan-under] Reconcile §23 checks no plan under a Jira tracker (#2249)
- [x] [jira-credentials-are-not-found-in] Jira credentials are not found in a worktree or fleet desk (#2250)
- [x] [jira-issue-list-answers-an-unknown] Jira issue-list answers an unknown fix version and a cut result silently (#2251)
- [x] [check-helper-table-sh-misses-a] check-helper-table.sh misses a new bundle on its PR and turns main red after the merge (#2260)
- [x] [reconcile-23-ignores-a-plan-s] Reconcile §23 ignores a plan's ticket: frontmatter key (#2269)
- [x] [sprint-to-release-drift-lists-should] Sprint-to-Release drift lists Should and Could items as not in the sprint (#2279)
- [ ] [release-gate-names-an-unfinished-must] Release gate names an unfinished Must Have with no plan as [] (#2281)
- [ ] [reconcile-23-tells-a-released-plan] Reconcile §23 tells a Released plan to release, and reads a window of open issues (#2283)
- [x] [reconcile-does-not-report-a-plan] Reconcile does not report a plan linked in both active and delivered (#2284)
- [x] [reconcile-on-bitbucket-reads-merged-branches] Reconcile on Bitbucket reads merged branches as orphans past 50 merged PRs (#2282)
- [x] [jenkins-run-for-sha-on-the] Jenkins run-for-sha on the default branch reports no answer when the branch builds in another job (#2278)
- [ ] [plot-review-status-sh-exits-1] plot-review-status.sh exits 1 with no output on a sprint item without a plan (#2280)
- [ ] [fleet-work-leaves-the-main-checkout] Fleet work leaves the main checkout dirty and behind its HEAD (#2311)

### Should Have

- [x] [the-ticket-index-updates-incrementally-and] The ticket index updates incrementally and takes Plot's own issue writes at once (#1856)
- [x] [ticket-rows-show-type-and-owner] Ticket rows show type and owner under one "Assigned to you" sub-header (#1837)
- [x] [one-review-issue-per-pr-a] Tooling: one review issue per PR, a sprint goal the board reads, and a pid read that waits (#1952: #1881, #1883, #1909)

### Could Have

- [x] [row-placement-and-wording-1677-1791] Waiting on you: row placement and wording (#1830)
- [x] [fleetd-scan-cost-and-read-cadence] fleetd scan cost and read cadence (#1845)
- [x] [the-ready-line-waits-for-every] Board: the ready line waits for every address, and a released desk says why (#1951: #1900, #1916)
- [x] [a-fresh-agent-after-a-wait] Fleet: a new free agent after a wait-bound end, safe supervisor endings, and slice waits (#1950: #1903, #1917, #1273)

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

<!-- Filled during /plot-sprint close: What went well / What could improve / Action items -->

## Notes

### Scope Changes

<!-- Log scope changes here: added/removed items, tier changes, with date and reason -->
<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->

- 2026-10-16: Tiers set by Jan Wloka: Must are the three connector plans; Should are the ticket index and the ticket rows; Could are #1830 and #1845.
- 2026-10-17: Added [one-review-issue-per-pr-a] as a Should: it stops plot-review opening one follow-up issue per PR head (#1881), the flood measured during this sprint.
- 2026-10-17: Added [the-ready-line-waits-for-every] and [a-fresh-agent-after-a-wait] as Could by Jan Wloka: both plans are approved, and their fixes keep the board and the fleet running during the sprint.
- 2026-10-21: Added ten plans as Must by Jan Wloka: [plot-reads-as-an-unknown-tracker], [bitbucket-jenkins-pr-list-rows-past], [a-sha-bound-run-reports-the], [pr-state-and-pr-list-never], [plot-on-a-bitbucket-repository-lists], [bitbucket-jenkins-a-pr-list-row], [merge-commit-not-in-this-clone], [plot-pr-merged-sh-asks-gh], [pr-state-and-pr-merged-miss], [pr-state-and-pr-list-still]. The field tests on ewz-kus-portal (Bitbucket, Jira, Jenkins) on 2026-10-19 to 2026-10-21 found each defect; all ten are delivered. Jan Wloka ruled that the release waits for every gap the tests found, including a sprint read as a Jira Release (#2212) and #2213–#2216, whose plans join when they are dispatched.
- 2026-10-21: Added [a-sprint-cannot-be-read-as], [jira-issue-list-limit-above-one], [resolve-the-release-of-a-pr], [bitbucket-with-tracker-plot-the-message] and [jenkins-run-for-sha-can-answer] as Must by Jan Wloka, before their plans are approved or dispatched. Jan Wloka overrode the dispatched-only rule for mid-sprint additions: the release 2.28.0 waits for these five gaps from the ewz-kus-portal field test of 2026-10-21 (#2212, #2213, #2214, #2215, #2216). <!-- pr: #2225, branch: bug/jenkins-run-for-sha-can-answer -->
- 2026-10-21: Added [a-sha-lookup-matches-a-build] as Must by Jan Wloka: the challenge of [jenkins-run-for-sha-can-answer] split this defect out of #2214, and the release waits for every gap the ewz-kus-portal tests found (#2229). <!-- pr: #2225, branch: bug/jenkins-run-for-sha-can-answer -->
- 2026-10-21: Added [sprint-release-comparison-drops-must-haves], [reconcile-23-checks-no-plan-under], [jira-credentials-are-not-found-in] and [jira-issue-list-answers-an-unknown] as Must by Jan Wloka: the fifth ewz-kus-portal field test found them with the project on `Tracker: jira` and `Sprint owner: plot` (#2248, #2249, #2250, #2251).
- 2026-10-21: Added [check-helper-table-sh-misses-a] as Must by Jan Wloka: the helper-table gate missed two new bundles on their PRs and turned main red twice during this sprint (#2260).
- 2026-10-21: Added [reconcile-23-ignores-a-plan-s] as Must by Jan Wloka: §23 must read the `ticket:` key that [sprint-release-comparison-drops-must-haves] adds, or 33 of 40 ewz plans read "not checked" (#2269).
- 2026-10-21: Added [sprint-to-release-drift-lists-should] as Must by Jan Wloka: the sixth ewz-kus-portal field test found that the Release-to-sprint drift lists 6 Should and Could items as missing from `kafka-gp-sync` (#2279).
- 2026-10-21: Added [release-gate-names-an-unfinished-must], [reconcile-23-tells-a-released-plan] and [reconcile-does-not-report-a-plan] as Must by Jan Wloka: the sixth ewz-kus-portal field test found them (#2281, #2283, #2284).
- 2026-10-21: Added [reconcile-on-bitbucket-reads-merged-branches] as Must by Jan Wloka: the sixth ewz-kus-portal field test found a merged branch reported as an orphan past the first 50 merged PRs (#2282).
- 2026-10-21: Added [jenkins-run-for-sha-on-the] and [plot-review-status-sh-exits-1] as Must by Jan Wloka: the sixth ewz-kus-portal field test found them (#2278, #2280).
- 2026-10-22: Added [fleet-work-leaves-the-main-checkout] as Must by Jan Wloka: fleet work left the board's checkout with 22 stale tracked files and a desk's draft, so the board showed delivered plans as in progress (#2311).
