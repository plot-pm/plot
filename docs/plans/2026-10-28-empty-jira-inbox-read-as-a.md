# Board: a missing Jira inbox read as a spelling mismatch; ticket rows repeat; Draft rows ignore «Mine»

> A board with no fleet never reads the reader's Jira inbox, then takes a colleague's account from the project-wide tickets as the reader's spelling. Ticket rows can appear twice, and Draft plan rows ignore the «Mine» filter.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-29-1
- **Issue:** #2808
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2809 merged
- **Started:** 2026-10-28, Jan Wloka, `bug/an-absent-inbox-guesses-no-spelling`
- **Started:** 2026-10-28, Jan Wloka, `bug/ticket-rows-appear-once`

## Changelog

- A board with no fleet reads the reader's Jira inbox, so *Waiting on you* shows the reader's own tickets instead of the project's.
- With no inbox reading, *Waiting on you* never guesses the reader's spelling from project-wide tickets, and the spelling notice never suggests a spelling `People` gives another person.
- Each ticket appears once in *Waiting on you*, whichever path read it.
- Draft plan rows obey «Mine» like every other row: rows owned by another person hide, and rows with no known owner stay visible.
- A Jira repository with no `Ticket prefixes` keeps its open tickets in *Waiting on you*, because its open read already holds only the reader's tickets.
- The `People` documentation states that a Bitbucket PR author is matched by its nickname.

<!-- Board impact: yes. Changes `waitingTickets`, `foldIssueRows`, `foldChangedIssueRows` and `issueWriteThrough` in packages/domain, the inbox outcome that fleetd writes to `issues.json` in packages/fleet, the board's no-fleet issue refresh in packages/board, and the Draft plan row's ownership. The plan format, template and docs/plans layout do not change; the `plot-config.sh` row of skills/plot/scripts/README.md gains one sentence on `People`. A board artifact rebuild follows from the board change. -->

## Motivation

Observed on the Delivery board of ewz-kus-portal (Plot 2.29.0, `Tracker: jira`, `Ticket prefixes: EWZKUS`) with two developers, jwloka and mruepp. The reader is jwloka. Jira `myself` is jan.wloka@quatico.com.

**1. A missing inbox reads as a spelling mismatch.** The reader's Jira inbox holds 0 issues. The banner reads: *The tracker names your tickets' assignee `markus.ruepp@quatico.com`; `People` declares `jira:jan.wloka@quatico.com` for jwloka — add `jira:markus.ruepp@quatico.com` to match.* `waitingTickets` (`packages/domain/src/rules/waiting-tickets.ts`) gives 0 tickets and no notice for an inbox that answered empty (`inbox: []`, `:201-203`); four independent probes in panel round 1 confirm it. The banner reproduces word for word only with `inbox: undefined`: the rule then falls back to all open project rows and takes the first assignee as the reader's spelling. The board with no fleet always takes that arm, because `refreshIssues` calls `waitingOf` with no inbox (`packages/board/src/server/fleet.ts:2096-2098`); only fleetd reads the inbox (`packages/fleet/src/shared/issue-refresh.ts:501`), and a failed first fleetd read also leaves it absent (`issue-refresh.ts:259-262`). The arm at `waiting-tickets.ts:196-198` (no `jira:` spelling declared) has the same defect. The suggested spelling already belongs to mruepp in `People`; following the advice would drop it for both people (`packages/domain/src/entities/person.ts:99-101`). `waiting-tickets.test.ts:175` pins the wrong advice as current behaviour. An absent inbox has a second meaning that the fix must keep: with no `Ticket prefixes` declared, the Jira inbox read answers `unaskable` because the open read is already person-scoped (`packages/domain/src/adapters/tracker/tracker-jira.ts:179-181`), and fleetd maps `unaskable` to `inbox: undefined` (`issue-refresh.ts:258`, `inboxSkipped()`). The `issues.json` schema documents the same collapse (`packages/domain/src/entities/issue-index.ts:166-171`).

**2. Ticket rows are duplicated.** About twelve rows (EWZKUS-3897 … 3849) appear twice in sequence. Only the matched arms of `waitingTickets` call `unionDedup` (`waiting-tickets.ts:99`); the fallback arms render `[...candidates]` (`:213`). Upstream, the paged read `walk` (`packages/domain/src/adapters/tracker/tracker-shell.ts:277-299`) drops repeated page tokens but not repeated issue keys. `foldIssueRows` (`packages/domain/src/rules/fold-issue-rows.ts:32-48`) keeps a duplicate that `held` already carries: `held` `[A, A]` stays two rows, because each held row is pushed to the order list without a check (`:38-41`). The duplicated keys are the newest tickets, which points at the held index plus the changed-since fold; Jira's cursor was clean on pages 1–2 of 3 (202 open rows). The live ewz `issues.json` was not measured.

**3. Draft plan rows ignore «Mine».** With «Mine (Jan Wloka)» on, three Draft plans stayed visible. Draft plan rows skip the filter entirely (`packages/board/src/app/components/AgentList.tsx:514,1176`), and `DraftPlanSchema` (`packages/board/src/contract/schema.ts:4180`) has no owner field. Draft plan rows come from Draft plans on the default branch or in the working tree. An `idea/` branch with no PR is a loose branch row with `plan: ''` (`packages/board/src/server/fleet.ts:7023-7026`), so it does not suppress the Draft plan row (`draftPlanRows`, `packages/board/src/app/lib/agent-rows/working-agents.ts:133-136`). Only an open plan PR's row carries the slug. So a Draft plan row has no plan PR, and its owner must come from the plan's own fields: `PlanOwnerFields` (`packages/board/src/server/board.ts:2804-2808`) already holds `assignee`, `author` and `approver` for these plans.

**Not a defect: Bitbucket PR authors.** A Bitbucket PR author arrives as `.author.nickname` (`skills/plot/scripts/plot-host.sh:4971-4983`). «Christian Kehl» on #3509, #3526 and #3527 resolves to `ckehl` through its declared display name, and `prOwnership` answers `theirs`. No `People` spelling makes a PR row `unknown`. The rows behind the issue's question 4 were not measured on the reporting board. Candidates are the Draft plan rows of problem 3, plan cards with no owner (`packages/domain/src/rules/plan-card.ts:49-52`), a PR row with an empty `pr.author`, and an empty `hostUser`.

Related: #2807 (reap keeps merged desks with worker files only).

## Design

### Approach

**Slice 1 — the inbox is read, and an absent one guesses nothing.**

- The board's no-fleet issue refresh reads the reader's tracker inbox (`issue-list --state inbox`) and passes its outcome to `waitingOf`, as fleetd does. One extra tracker call per refresh, on the same timer.
- `waitingTickets` takes the inbox read's outcome, one of `answered`, `unaskable`, `failed` and `not-read`, not only the inbox rows. `answered` uses the inbox rows. `unaskable` keeps the open rows as the reader's tickets, because the open read is already person-scoped (`tracker-jira.ts:179-181`). `failed` and `not-read` give 0 tickets, no spelling notice, and a reason the view can name. The rule never takes a spelling from project-wide rows. The same holds for the arm at `:196-198`.
- fleetd stores the outcome in `issues.json` beside `inbox` and `inboxAt`, so the board can tell `unaskable` from `not-read` when it reads the index. `IssueIndexSchema` gains that field.
- The spelling notice fires only when the inbox is non-empty and none of its rows match the reader, takes its spelling from an inbox row, and never names a spelling `People` declares for another person.
- The rule lives in the domain; domain unit tests assert each arm without a browser. Replace the expectation at `waiting-tickets.test.ts:175`.

**Slice 2 — one row per ticket key.** Enforce one row per key at both funnels: where the issue index is written and where `waitingTickets` renders every arm, not only the matched ones.

- The index write funnels through `foldIssueRows` in packages/domain (`packages/domain/src/rules/fold-issue-rows.ts`). Its callers are `foldChangedIssueRows` (`fold-issue-rows.ts:87-88`), which fleetd calls at `packages/fleet/src/shared/issue-refresh.ts:420`, and `issueWriteThrough` (`packages/domain/src/rules/issue-write-through.ts:83-90`).
- `foldIssueRows` also collapses a duplicate already in `held`, so `held` `[A, A]` folds to one row.
- Between two rows for one key, the existing `replaces` rule decides (`fold-issue-rows.ts:14-18`): a row with an `updatedAt` beats one with none, the newer `updatedAt` wins, and on a tie or where neither has one the incoming row wins. `packages/domain/test/fold-issue-rows.test.ts:23` and `:41` keep pinning that a newer held row stays.
- Regression tests feed overlapping pages, a duplicate inside `held` (`foldIssueRows([A@1, A@2], [])`), an overlapping `foldChangedIssueRows` read and an overlapping `issueWriteThrough` write. They assert that no key appears twice on any arm, and that the hidden count never exceeds the number of distinct keys.

**Slice 3 — Draft plan rows obey «Mine».** A Draft plan row carries the plan's `PlanOwnerFields` (`assignee`, `author`, `approver`, from `fieldsBySlug`) and passes them to the existing rule `ownership({ kind: 'plan', … })` (`packages/domain/src/rules/ownership.ts:135-141,267-268`). That rule answers `mine` where any of the three fields resolves to the reader, `theirs` where none does and one is a declared spelling of another person, and `unknown` otherwise. The slice adds no new precedence. The row then passes through the same `isMine` filter as other rows. The released contract holds: `unknown` stays visible (`2026-09-24-the-board-shows-me-only-my-work.md:123`). The ownership comes from a domain property, not from `.tsx`. The slice also adds one sentence to the `People` text in the `plot-config.sh` row of `skills/plot/scripts/README.md`: a Bitbucket PR author is matched by its nickname, as a plain spelling.

**Out of scope, planned separately.** «Mine» hiding `unknown` rows behind a count, and an *Unassigned* section, reverse the released contract above and reach Discovery (`lanes-for-reader.ts:67`). They move to their own feature plan, which states that contract and the Bitbucket case where no login is known (`plot-host.sh account` exits 4) and every PR row reads `unknown`.

### Decisions

Decided 2026-10-28 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-28-empty-jira-inbox-read-as-a/panel.md`):

- [x] «Mine» hides unknown, the count and *Unassigned*: move to their own feature plan.
- [x] Slice 1: the no-fleet board reads the inbox, an absent inbox takes no spelling from project rows, and the notice never suggests another person's spelling.
- [x] Duplicates: fix at both funnels (index write and `waitingTickets` read) without waiting for the ewz `issues.json` measurement.
- [x] Draft plan rows ignoring «Mine»: a bug slice in this plan.
- [x] Is «Only my work» the same control as «Mine»? Yes: the chip row replaced the checkbox in #2080 (`DeliveryFilters.tsx:8-9`), with the same state and storage key.
- [x] Bitbucket PR author spelling: the nickname, matched as a plain spelling; no new `People` syntax. Slice 3 documents it in the `People` text.

Decided 2026-10-28 by Jan Wloka after plot-review #2813 on plan PR #2809 and its panel (`.plot/panels/2026-10-28-plot-review-findings-on-pr-2809/panel.md`):

- [x] The inbox signal: `waitingTickets` takes the inbox read's outcome, `answered | unaskable | failed | not-read`. `unaskable` (no `Ticket prefixes`; the open read is already person-scoped, `tracker-jira.ts:179-181`) keeps the open rows as the reader's tickets. `failed` and `not-read` give 0 tickets and no spelling guess. On the fleet path, fleetd stores the outcome in `issues.json`. The no-fleet board computes it from its own inbox read. PR #2814 currently maps `unaskable` to 0 tickets on both paths, and the fix lands on that PR (plot-review HIGH, issue #2821).
- [x] The Draft row's owner: the plan's `PlanOwnerFields` through the existing `ownership({ kind: 'plan', … })` rule; no new precedence.
- [x] One row per key keeps the existing `replaces` rule of `foldIssueRows`.

### Open Questions

- [ ] `PLOT_JIRA_JQL` replaces both the open JQL and the inbox JQL (`plot-host.sh:5326`, `:5350`). With it set, `unaskable` no longer proves that the open read is person-scoped. Does `waitingTickets` treat a custom JQL as person-scoped, as project-scoped, or as unknown?

## Slices

### Inbox

- `bug/an-absent-inbox-guesses-no-spelling` — the no-fleet board reads the inbox; `waitingTickets` takes the inbox outcome: `unaskable` keeps the open rows, `failed` and `not-read` give no tickets and no notice; fleetd stores the outcome in `issues.json`; the notice never names another person's spelling <!-- builds: an inbox read in the board's refreshIssues, an inbox outcome in waitingTickets and issues.json --> → #2814

### Duplicates

- `bug/ticket-rows-appear-once` — one row per ticket key in `foldIssueRows` (including a duplicate in `held`), through `foldChangedIssueRows` and `issueWriteThrough`, and at every `waitingTickets` arm, under the existing `replaces` rule, with regression tests

### Draft rows

- `bug/draft-rows-obey-mine` — a Draft plan row carries its `PlanOwnerFields`, `ownership({ kind: 'plan', … })` answers whose it is, and the row passes the «Mine» filter; `unknown` stays visible; the `People` text names the Bitbucket nickname match

## Notes

- Issue: https://github.com/plot-pm/plot/issues/2808. The plan names it in `Issue:` and writes nothing to the tracker.
- Earlier work in the same area: `2026-09-09-jira-inbox-is-instance-wide-the`, `2026-10-16-jira-inbox-and-issue-index`, `2026-09-24-the-board-shows-me-only-my-work` (the rule that `unknown` stays visible), `2026-10-23-only-my-work-waiting-on-you` (Released).
- The three slices are three waves, and they gate in order: `sliceVerdicts` (`packages/domain/src/rules/eligible.ts:157`) reads them as eligible, blocked, blocked. Slices 1 and 2 both change `waiting-tickets.ts` and `waiting-tickets.test.ts`, and the wave order keeps them from running at the same time.
- Amended 2026-10-28 after plot-review #2813 on plan PR #2809.
