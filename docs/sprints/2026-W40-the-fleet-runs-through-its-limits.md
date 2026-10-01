# Sprint: The fleet runs through its limits

> Three defects that stop an unattended fleet when something outside Plot pushes back: a throttled host, a harness usage limit, and an agent that outlives the command that started it.

## Status

- **State:** Active
- **Start:** 2026-10-01
- **End:** 2026-10-08
- **Release:** 2.22.3

## Sprint Goal

**An unattended fleet keeps working through a throttled host, a usage limit and a long-lived agent, and names each one for what it is.**

All three were found by operating the fleet on 2026-10-01, two of them on a Bitbucket estate. Each turns an external condition into a stopped fleet: a 429 holds every wave because a merge cannot be proven, a usage limit reads as a broken prompt, and `--start` blocks its caller for the agent's whole life.

### Must Have

- [ ] [a-merge-subject-proves-a-landing-the-host-cannot](../plans/2026-10-01-a-merge-subject-proves-a-landing-the-host-cannot.md) — [#1139](https://github.com/plot-pm/plot/issues/1139) — **A merged-and-deleted branch is proven from its merge commit.** Under a throttled host the wave gate cannot prove a merge and holds every dependent slice. A panel answered `amend` on 2026-10-01: add Bitbucket's anchored `Merged in <branch> (pull request #N)` subject to the scan's existing merge-subject detection, chosen by backend, for the wave gate only and never for a destructive decision. Measured: 122 of 200 merges found, 0 false positives.
- [ ] [a-usage-limit-is-not-a-broken-prompt](../plans/2026-10-01-a-usage-limit-is-not-a-broken-prompt.md) — [#1141](https://github.com/plot-pm/plot/issues/1141) — **A usage limit is not a broken prompt.** The worker loop retries three times at once and writes a `PLOT-BLOCKED` that prescribes fixing the prompt file. Measured on 2026-10-01: a desk-root worker hit the limit, failed, and sat free with unpushed commits.
- [ ] [a-start-returns-while-its-agent-runs](../plans/2026-10-01-a-start-returns-while-its-agent-runs.md) — [#1144](https://github.com/plot-pm/plot/issues/1144) — **`--start` returns while its agent runs.** Two dispatchers measured asleep with their wrapper as child, for 4 h and 10 min, from two installs. `/plot-fleet --start` and `--start-agents` both go through it.

- [ ] [an-open-board-follows-a-sprint-change](../plans/2026-10-01-an-open-board-follows-a-sprint-change.md) — [#1145](https://github.com/plot-pm/plot/issues/1145) — **An open board follows a sprint change.** A page loaded under the previous sprint kept filtering on it after the sprint closed, hid the new sprint's six slice rows, and showed «Sprint only» unchecked until a reload. Measured 2026-10-01.
- [x] [waiting-on-you-counts-tickets-as-tickets](../plans/2026-10-01-waiting-on-you-counts-tickets-as-tickets.md) — [#1146](https://github.com/plot-pm/plot/issues/1146) — **WAITING ON YOU counts tickets as tickets.** `sectionTally` adds each ticket to both the plan and the slice figure, so 3 plans, 6 slices and 15 tickets read `(18 plans · 21 slices)`.

- [ ] [a-handed-slice-reads-as-taken](../plans/2026-10-01-a-handed-slice-reads-as-taken.md) — [#1150](https://github.com/plot-pm/plot/issues/1150) — **A held empty claim reads as taken.** A slice whose claim a live agent holds reads `nobody has taken it` in NOT STARTED until its first commit, with the agent's activity dot beside it. Measured on this sprint's own slices, 2026-10-01.

- [ ] [a-scan-says-where-its-time-goes](../plans/2026-10-01-a-scan-says-where-its-time-goes.md) — [#1017](https://github.com/plot-pm/plot/issues/1017) — A scan takes 21-37s on 27 plans, and ~19s of it is the script's own bash — its plan a-parsed-plan-joins-the-index was rejected by a panel; it needs a rephrased plan.
- [ ] [an-assignment-is-read-where-it-is-recorded](../plans/2026-10-01-an-assignment-is-read-where-it-is-recorded.md) — [#1039](https://github.com/plot-pm/plot/issues/1039) — The only cross-tick assignment lock is the claim ref, and the queue never reads manifests
- [ ] [the-release-pr-is-checked-before-it-merges](../plans/2026-10-01-the-release-pr-is-checked-before-it-merges.md) — [#1040](https://github.com/plot-pm/plot/issues/1040) — The release PR's push-triggered validate never reports, so every release merges with --admin
- [ ] [idle-is-read-from-what-the-desk-recorded](../plans/2026-10-01-idle-is-read-from-what-the-desk-recorded.md) — [#1041](https://github.com/plot-pm/plot/issues/1041) — Reporting idle from the supervisor's tick needs persistent state the daemon does not have
- [ ] [an-approved-slice-has-a-name](../plans/2026-10-01-an-approved-slice-has-a-name.md) — [#1057](https://github.com/plot-pm/plot/issues/1057) — Board shows a slice as (unnamed): the ### heading lives on the slice branch, the board reads the main branch — its plan a-slice-row-finds-its-pr-by-head was rejected; it needs a rephrased plan.
- [ ] [a-shared-account-names-what-spends-it](../plans/2026-10-01-a-shared-account-names-what-spends-it.md) — [#1069](https://github.com/plot-pm/plot/issues/1069) — A shared Bitbucket workspace is at 2200 req/hr from another checkout, and Plot has no view of it — its plan a-spend-line-names-its-caller was rejected; it needs a rephrased plan.
- [ ] [an-empty-branch-never-reads-as-merged](../plans/2026-10-01-an-empty-branch-never-reads-as-merged.md) — [#1082](https://github.com/plot-pm/plot/issues/1082) — pr_merged "" exits 0 (merged) where the TS side answers unreachable, and no corpus test covers the pair
- [ ] [a-desk-and-its-manifest-name-each-other](../plans/2026-10-01-a-desk-and-its-manifest-name-each-other.md) — [#1085](https://github.com/plot-pm/plot/issues/1085) — A hop that creates a new desk leaves the worker monitor watching the old one
- [ ] [a-desk-and-its-manifest-name-each-other](../plans/2026-10-01-a-desk-and-its-manifest-name-each-other.md) — [#1086](https://github.com/plot-pm/plot/issues/1086) — plot_manifest_for_worktree resolves to the desk, not the main checkout, against its own comment
- [ ] [a-pr-refresh-reads-the-history-once-a-day](../plans/2026-10-01-a-pr-refresh-reads-the-history-once-a-day.md) — [#1087](https://github.com/plot-pm/plot/issues/1087) — The board's rich merged and closed PR listings take 46-68 s and intermittently 504 on GitHub GraphQL
- [ ] [an-in-session-approval-has-a-controller](../plans/2026-10-01-an-in-session-approval-has-a-controller.md) — [#1088](https://github.com/plot-pm/plot/issues/1088) — No controller records an in-session approval, so every Review: in-session plan needs an --unowned receipt
- [ ] [a-start-step-leaves-no-claim-and-no-desk](../plans/2026-10-01-a-start-step-leaves-no-claim-and-no-desk.md) — [#1090](https://github.com/plot-pm/plot/issues/1090) — A dispatch that runs /plot-implement leaves an empty claimed branch and no worker, and the board shows it delivered — the board half shipped in v2.22.0; /plot-implement still leaves an empty claim (measured again 2026-10-01).
- [ ] [a-closed-pr-carries-no-branch](../plans/2026-10-01-a-closed-pr-carries-no-branch.md) — [#1093](https://github.com/plot-pm/plot/issues/1093) — plot-open-pr.sh refuses a branch whose only PR was closed unmerged, though that PR carries no work
- [ ] [a-hold-names-the-landing-nobody-could-answer](../plans/2026-10-01-a-hold-names-the-landing-nobody-could-answer.md) — [#1094](https://github.com/plot-pm/plot/issues/1094) — An unaskable merged set holds every slice as not-claimable: a 429 reads as 'the plan blocks this'
- [ ] [the-queue-reads-the-order-the-scan-reads](../plans/2026-10-01-the-queue-reads-the-order-the-scan-reads.md) — [#1100](https://github.com/plot-pm/plot/issues/1100) — The supervisor's queue ignores waits:, so it hands out a slice the scan reports blocked
- [ ] [a-desk-and-its-manifest-name-each-other](../plans/2026-10-01-a-desk-and-its-manifest-name-each-other.md) — [#1101](https://github.com/plot-pm/plot/issues/1101) — A worker loop runs on a desk no manifest names, and the board labels it with the branch the desk has checked out
- [ ] [the-board-reads-its-own-repositorys-pr-store](../plans/2026-10-01-the-board-reads-its-own-repositorys-pr-store.md) — [#1112](https://github.com/plot-pm/plot/issues/1112) — streaming-scan.test reads the machine's real PR index, so plot-resolve-artifact.sh never pushes on a machine with open PRs
- [ ] [delivery-reads-the-last-finished-scan](../plans/2026-10-01-delivery-reads-the-last-finished-scan.md) — [#1113](https://github.com/plot-pm/plot/issues/1113) — /api/deliver answers scan-incomplete for 20 minutes while /api/fleet reports the scan complete
- [ ] [the-issue-ops-ask-who-answers](../plans/2026-10-01-the-issue-ops-ask-who-answers.md) — [#1133](https://github.com/plot-pm/plot/issues/1133) — plot-host.sh issue ops fall through to the git host for a Tracker scheme no connector lists
- [ ] [a-supervisor-restart-leaves-its-agents-running](../plans/2026-10-01-a-supervisor-restart-leaves-its-agents-running.md) — [#1148](https://github.com/plot-pm/plot/issues/1148) — On Linux, stopping the supervisor unit ends every agent it started: plot-registryd.service sets no KillMode
- [ ] [the-queue-reads-the-order-the-scan-reads](../plans/2026-10-01-the-queue-reads-the-order-the-scan-reads.md) — [#1149](https://github.com/plot-pm/plot/issues/1149) — A long supervisor tick hands out a slice merged during the tick; the agent then reports a lock violation that did not happen
- [ ] [a-start-step-leaves-no-claim-and-no-desk](../plans/2026-10-01-a-start-step-leaves-no-claim-and-no-desk.md) — [#1151](https://github.com/plot-pm/plot/issues/1151) — A worker-less checkout holding a slice's branch stops the agent it is handed to
- [ ] [an-assignment-is-read-where-it-is-recorded](../plans/2026-10-01-an-assignment-is-read-where-it-is-recorded.md) — [#1152](https://github.com/plot-pm/plot/issues/1152) — --release races the supervisor's hand-over and produces a false REGISTRY LOCK VIOLATION

- [ ] [a-draft-slice-waits-on-its-approval](../plans/2026-10-02-a-draft-slice-waits-on-its-approval.md) — [#1161](https://github.com/plot-pm/plot/issues/1161) — A Draft plan's waiting slice renders in NOT STARTED as approved — nobody has taken it.

### Should Have

### Could Have

### Deferred

## Retrospective

<!-- Filled during /plot-sprint close: What went well / What could improve / Action items -->

## Notes

### Scope Changes

<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->

- 2026-10-01: Added #1145 and #1146 to Must — two board defects found while reading this sprint on the board; the operator asked for both in 2.22.3. Neither has a plan yet.
- 2026-10-01: Added #1150 to Must — found while the fleet started this sprint's slices; the operator asked for it in 2.22.3. No plan yet.
- 2026-10-01: Added 23 open issues to Must (#1017, #1039, #1040, #1041, #1057, #1069, #1082, #1085, #1086, #1087, #1088, #1090, #1093, #1094, #1100, #1101, #1112, #1113, #1133, #1148, #1149, #1151, #1152) — the operator asked for every open ticket in 2.22.3; none has an approved plan yet. GitHub milestone `2.22.3` holds the same set.
- 2026-10-02: Added #1161 to Must — found on the board while this sprint's Draft plans declared `waits:`; the operator asked for it in 2.22.3.
