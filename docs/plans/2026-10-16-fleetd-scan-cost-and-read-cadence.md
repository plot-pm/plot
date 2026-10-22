# fleetd scan cost and read cadence

> The fleet scan asks the host and git more often, and for longer, than the work it settles needs; six open findings name where.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Issue:** #1845
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1862 merged
- **Started:** 2026-10-16, Jan Wloka, `bug/the-cold-scan-converges`
- **Started:** 2026-10-16, Jan Wloka, `bug/the-tick-asks-nothing-for-an-ended-desk`
- **Started:** 2026-10-16, Jan Wloka, `bug/the-settled-walk-survives-a-burst`
- **Started:** 2026-10-16, Jan Wloka, `bug/the-design-commit-key-matches-a-real-plan`
- **Delivered:** 2026-10-17
- **Released:** 2026-10-22, v2.28.0

## Changelog

- The fleet scan completes on a repository whose cold first scan exceeds 90 s, and the tick spends host calls only on desks that can release.

<!-- Board impact: none for the plan format. Slice 3 changes what the board server keeps from a timed-out scan, so rebuild the board artifact (pnpm build:board) there. -->

## Motivation

Tracking issue #1845 collects six findings, all about what the fleet reads and how often. Each was closed in favour of #1845; the line below says what stays open on main at `c40ac9e96` (2026-10-16).

- **#1756 — a cold scan never completes (measured 2026-10-15).** On a Bitbucket repository with 26 branches and about 3,500 PRs, `plot-fleet-scan.sh --stream` takes 106 s traced and 280 s by hand. The `--state all` sweep makes 146 sequential `bb` calls of about 0.5 s. The board kills the scan at `timeoutMs: 90000` and discards `t.listing` and `t.terminal`, so the next scan starts cold and times out again.
- **#1374 — the registryd tick asks per ended desk.** `registryd.ts:997-1021` awaits `commitBeyondClaim` and `prOpen` for every unregistered desk before it reads the ending. The `hostShell` at `registryd-main.ts:1758` sits outside the tick's tally, so `report.spend` misses these calls. The issue estimates 600 uncounted `prState` calls per hour for 10 stalled desks. Open with it: the `run()` wiring has no test, a detached desk falls back to the assigned branch (`worker-loop.ts:770`, `agent-loop.ts:484`), and a released-with-no-claim answer is logged every tick.
- **#1582 — the settled walk asks only the 5 newest commits.** `ANCESTOR_ASKS_MAX = 5` (`default-branch.ts:97,129`). On 2026-10-11, 11 commits landed in 21 minutes while one CI run took 18 to 21 minutes, all 5 asked ancestors were pending, and the hold stayed. No test pins a red head over an older green, and one flake in `sandbox-scrubs-repo-root.test.mjs:64` leaks a `plot-scrub-*` entry.
- **#1652 — the issue index.** A first failed pass writes `at` (`issue-refresh.ts`), and a failed `backend()` falls back to `github` silently (`registryd-main.ts` ~2033). The exit-4 sentence from `unaskable` is dropped.
- **#1673 — the design-work rules.** An `open-pr` retry waits behind slot refusals (`design-work.ts:141-142`), `specRow` returns an entry and no section (`:168-236`), and six LOW findings on TSDoc, test names and fixtures.
- **#1685 — the spec run.** `designCommitOf` matches `/^Design:\s*(\S+)/m` against plans that carry `- **Design:** <date>, <who>, <channel>`, so every key is `''` and failure marks never reset (`auto-design.ts:334`, `design.ts:153`). The `pr-not-opened` retry starts a full agent run, `verifyStart` does not refuse while a spec run goes, and the restart command judges "spec written" by commit count.

The two groups differ in kind. #1756, #1374 and #1582 are about **cost and cadence**: how many calls a pass makes and how long it holds a result. #1652, #1673 and #1685 are **correctness findings in the read path**: a key that never matches, a section the rule does not return, a timestamp written on failure.

## Design

### Approach

Each slice is one branch and fixes findings that share a file or a rule. Per the layering rule, a decision lands in `packages/domain` first and the controller calls it. Work in the order below because slice 1 changes the one measured user-facing failure.

- **Cold scan converges (#1756).** Pick one of the three options the issue names; the choice is the first open question. The streamed `listing:` and `terminal:` lines a timed-out scan already printed are answers the host charged for. Keeping them lets the next scan resume. This follows *A Decision Reads The Index*: a bought answer is stored, a verdict is not.
- **The tick reads the ending first (#1374).** `endingAction` reads the ending, and the host is asked only for `nothing-done` candidates. The host used goes through the counted `hostShell` so `report.spend` includes it. Extract the port construction at `registryd-main.ts:1744-1769` into a factory, as `freshAgentPorts` is, and test the `startAgents && incomplete === ''` gate.
- **The settled walk survives a burst (#1582).** Take the newest completed CI run whose SHA lies on the head's first-parent line, or remember which ancestors answered pending. Add the red-head-over-green test and the wait-on-worker-pid fix for the flake.
- **The design path reads real plans (#1685, #1673).** `designCommitOf` keys by `refs.recordCommit(file, 'Design')`. `SpecStartInput` gains the answer so `open-pr` skips `slotRefusal`, and `specRow` returns `{ section, entry }`.
- **The issue index writes `at` only on an answered read (#1652).** `at` becomes nullable in `IssueIndexSchema`. `issue-refresh.ts` stays the one writer.

### Open Questions

- [x] #1756: keep streamed lines on timeout. `scanOnce` (`packages/fleet/src/shared/fleet-scan.ts`) now carries `terminal:`/`listing:` lines into `state` in a `finally` around the stream call, so a kill leaves the caches as warm as whatever it streamed before dying — resolved on `bug/the-cold-scan-converges`. A longer first-scan budget was not added: any fixed budget can still be exceeded, while this converges the second scan toward completion regardless. The parallel per-branch sweep remains out of scope, as the plan already said, pending the connector rate-limit contract.
- [ ] #1582: does the burst fix walk by completed-run listing (one host call) or by remembered pending answers (no new call, extra state)? Measure calls per refresh for each before choosing.
- [ ] Does each member keep its own review detail in its own closed thread, or does the slice copy the finding list into the slice description? Recommend the thread, so the plan stays a pointer.
- [ ] #1652 exit-4 sentence: it waits on `feature/the-tracker-lists-closed-issues`, which this plan does not verify exists. Drop that line from scope if the branch is gone.

## Slices

### Implementation

- `bug/the-cold-scan-converges` — keep what a timed-out scan streamed, or budget the first scan longer (#1756) → #1892 <!-- builds: a timed-out scan's retained listing and terminal cache -->
- `bug/the-tick-asks-nothing-for-an-ended-desk` — read the ending before the host, count the spend, test the `run()` wiring (#1374) → #1905 <!-- builds: a port factory for the registryd tick's agent start -->
- `bug/the-settled-walk-survives-a-burst` — settle past a burst of pending commits, with the red-head test and the flake fix (#1582)
- `bug/the-design-commit-key-matches-a-real-plan` — `designCommitOf`, the `open-pr` slot rule, `specRow` section, spec-written judgement (#1685, #1673) → #1927
- `bug/the-issue-index-writes-at-on-an-answer` — nullable `at`, warn on a failed backend (#1652) → #1924

## Notes

- Created from tracker issue #1845 by `/plot-idea` on 2026-10-16. No approval and no implementation exist.
- Slices 1 to 3 touch cost and cadence and are independent of each other. Slices 4 and 5 touch different packages and are independent too, so a dispatch may start all five.
- Definition of Done: docs/definition-of-done.md
