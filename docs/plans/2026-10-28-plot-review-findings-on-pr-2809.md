# plot-review: findings on PR #2809 close in the plan and its slices

> The reviewer found 4 MEDIUM and 3 LOW gaps in the plan that PR #2809 merged. This plan decides each one and amends the plan, or the slice built from it, before the wording ships as code.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #2813
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- The plan `2026-10-28-empty-jira-inbox-read-as-a` names the signal that tells `waitingTickets` an absent inbox from a person-scoped read, takes a Draft plan row's owner from `PlanOwnerFields`, states the existing fold rule, orders its slices, and cites the right package.

<!-- Board impact: none. This plan edits one plan file and, through its second slice, the inputs of two slices that change `waitingTickets` and the Draft plan row owner. The plan format, template, helper scripts and docs/plans layout do not change. -->

## Motivation

plot-review found HIGH 0, MEDIUM 4, LOW 3 on PR #2809 at `11c3d6e22d636c240dddbeb483dd097387514d84` (issue #2813). The PR adds only a plan, its active-index symlink and the panel's round-1 verdicts, so no finding breaks main. Each finding is a gap in the plan's design, and the plan is Approved: its slices are built from its wording. Slice 1 is in flight as draft PR #2814 and slice 3 has no branch yet.

**MEDIUM**

1. **Two states where the domain needs three.** The plan says `waitingTickets` "distinguishes an inbox that answered from one that is absent". `inbox === undefined` also means "the open read is already person-scoped": `tracker-jira.ts:179-181` answers `unaskable` for a repository with no `Ticket prefixes`. A slice built from the plan's wording answers 0 tickets for every such repository, where the open rows are the reader's own. The plan names no input that tells the two cases apart; the domain-rules juror asked for one (amendment 2) and the plan did not carry it.
2. **Slice 3 takes the owner from an empty source.** The plan says a Draft plan row's owner is "the plan PR's author where a plan PR exists". `draftPlanRows` (`working-agents.ts:133-136`) gives a row only where no branch row carries the plan's slug, and any `idea/` branch already is a `plan` branch row (`carriesDraftPlan`, `fleet.ts:5292-5294`). A Draft plan row therefore has no plan PR, its owner stays `unknown`, and «Mine» keeps showing it. `PlanOwnerFields` (`board.ts:2804-2808`, `fieldsBySlug`) already holds `assignee`, `author` and `approver` for these plans.
3. **Slice 2's tie-break contradicts the fold rule.** The plan says "a later row for the same key replaces the earlier one". `foldIssueRows` keeps the row with the newer `updatedAt` and replaces only on a tie or where the held row has none (`fold-issue-rows.ts:14-18`); `fold-issue-rows.test.ts:23` and `:41` pin that. Followed word for word, the slice breaks those tests or lets an older reading overwrite a newer one.
4. **Slices 1 and 2 share a file.** The plan says the slices "touch separate files and merge in any order". Slice 1 rewrites the tracker-account arms of `waitingTickets` (`waiting-tickets.ts:196-221`) and replaces `waiting-tickets.test.ts:175`; slice 2 adds dedup to every arm of the same function and test file. With `Impl: own branches` the two dispatch in parallel and conflict.

**LOW**

5. The plan puts `foldIssueRows` in `packages/fleet`. It lives in `packages/domain/src/rules/fold-issue-rows.ts`; only its caller is in `packages/fleet/src/shared/issue-refresh.ts:420`.
6. The "Not a defect" paragraph says the issue's question 4 "rests on rows that were Draft plan rows". The panel's own "Shared blind spot" section says nobody saw the reporting board's state, and the jurors named other candidates: authorless plan cards (`plan-card.ts:49-52`), an empty `pr.author`, an empty `hostUser`.
7. The panel asked that `People` document that a Bitbucket author is matched by its nickname. The plan records the decision but no slice or Changelog line delivers the documentation.

## Design

### Approach

**Slice 1 — the plan text.** Edit `docs/plans/2026-10-28-empty-jira-inbox-read-as-a.md` only:

- (3) Slice 2 states that one row per key uses `foldIssueRows`'s existing `replaces` rule (newer `updatedAt` wins; a tie or a held row with no `updatedAt` takes the later row), and the regression tests keep `fold-issue-rows.test.ts:23` and `:41`.
- (4) Slice 2 is placed in a later wave than slice 1 in `## Slices`, with a `waits:` annotation, and the Notes line "separate files, any order" is replaced by the shared-file statement.
- (5) The board-impact comment and slice 2 name `packages/domain` for `foldIssueRows` and `packages/fleet` for its caller.
- (6) The "Not a defect" paragraph lists the candidates the panel named and drops the causal claim.
- (7) Slice 3 or a new line in the Changelog carries the `People` documentation that a Bitbucket author is matched by its nickname, as a plain spelling.

**Slice 2 — the two design gaps.** Findings 1 and 2 change what a slice builds, so a person decides them before the text changes (see Open Questions). The slice then:

- (1) names the signal in the parent plan's slice 1 and in the draft PR #2814's brief: either a rows scope on the read, or the inbox outcome `answered | unaskable | failed | not-read`, and who supplies it on the no-fleet path. A domain unit test per outcome asserts that `unaskable` on a person-scoped read keeps the open rows.
- (2) replaces "the plan PR's author" in the parent plan's slice 3 with `PlanOwnerFields` (`author`, then `assignee`), read through a domain property, with a test that a Draft plan row with an `idea/` branch and no PR gets an owner.

### Open Questions

- [ ] Finding 1: is the signal a rows scope or the four-valued inbox outcome? The outcome also carries the `failed` case that fleetd's first read can leave absent (`issue-refresh.ts:259-262`).
- [ ] Finding 2: which `PlanOwnerFields` value is the owner when `author` and `assignee` differ?
- [ ] Does the draft PR #2814 already take a position on finding 1? If it does, the plan text follows the PR and slice 2 shrinks to finding 2.

## Slices

### Plan text

- `docs/plan-2809-text` — amend the parent plan for findings 3 to 7 <!-- builds: corrected slice 2 tie-break, slice order and package names in the parent plan -->

### Design gaps

- `bug/plan-2809-design-gaps` — name the inbox scope signal and the Draft row owner source in the parent plan and its slices <!-- waits: Plan text -->

## Notes

- Issue: https://github.com/plot-pm/plot/issues/2813. The plan names it in `Issue:` and writes nothing to the tracker.
- Parent plan: `docs/plans/2026-10-28-empty-jira-inbox-read-as-a.md` (Approved, issue #2808, plan PR #2809 merged). Its slice 1 is draft PR #2814.
- The findings were checked against the code at `11c3d6e22`: `waiting-tickets.ts:196-226`, `fleet.ts:1922` and `:2098`, `person.ts:99-101`, `waiting-tickets.test.ts:175`, `plot-host.sh:4971-4983`, `AgentList.tsx:514,1176`.
