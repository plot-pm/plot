# Juror verdict: testability

Position: amend

Evidence: Read the subject plan, the parent plan `docs/plans/2026-10-28-empty-jira-inbox-read-as-a.md`, issue #2813, and the diff of draft PR #2814 (head `5472779b9`). Read the code at `waiting-tickets.ts`, `fold-issue-rows.ts` and its test, `tracker-jira.ts`, `issue-refresh.ts`, `issue-index.ts`, `ownership.ts`, `plan-card.ts`, `working-agents.ts`, `board.ts`, `board/src/server/fleet.ts`, `AgentList.tsx` and `plot-dispatch/SKILL.md`. Ran four things. (1) `plot-plan-meta.sh` on the subject plan and the parent plan. (2) A probe vitest file against `waitingTickets` at the PR #2814 head and again with main's `waiting-tickets.ts`, in a scratch worktree that has since been removed. (3) A node probe against `foldIssueRows`, with type stripping. (4) `scripts/check-plan-headings.sh` in the subject worktree. Also ran read-only `gh` calls (issue 2813, PR 2814, PR list) and `git ls-remote`.

## (a) Problem statement

- Every cited line holds at current main: `tracker-jira.ts:179-181` (the `unaskable` "already person-scoped" answer), `working-agents.ts:133-136` (in `packages/board/src/app/lib/agent-rows/`), `fleet.ts:5292-5294` (`carriesDraftPlan`), `board.ts:2804-2808` (`PlanOwnerFields`), `fold-issue-rows.ts:14-18` (`replaces`), `issue-refresh.ts:259-262` and `:420`, and `plan-card.ts:49-52`. `fold-issue-rows.test.ts:23` and `:41` are the two keep-the-held-row assertions. The file is at `packages/domain/test/fold-issue-rows.test.ts`, not beside the source. The plan should give the full path, because a reader looks in `src/rules/` first.
- **Finding 4 overstates its risk.** The parent plan already puts its three slices in three waves: `Inbox`, `Duplicates`, `Draft rows`. `plot-plan-meta.sh` reports three waves with one branch each. The wave gate blocks a later wave until the earlier one lands (`plot-fleet-scan.sh:72`, *"blocked — an earlier wave has not landed"*; `plot-dispatch/SKILL.md:74`). So the two slices cannot dispatch in parallel. Only the Notes sentence *"touch separate files and merge in any order"* is wrong.
- **Finding 5 is incomplete.** `foldIssueRows` has a second production caller, `packages/domain/src/rules/issue-write-through.ts:83,88,90`. The fleet caller at `issue-refresh.ts:420` reaches it only through `foldChangedIssueRows` (`fold-issue-rows.ts:87-88`). The parent slice 2's dedup at "the index write" therefore covers two write paths, not one.
- **A cause is missing under finding 3 (executed).** `foldIssueRows` does not collapse a duplicate key that is already in `held`. The `held` loop (`fold-issue-rows.ts:38-41`) pushes every key into `order` with no check. The node probe `foldIssueRows([A@10-01, A@10-02], [])` returns `["A:a2","A:a2"]`. A duplicate that gets into the index stays there through every fold. The parent slice 2 must collapse it there, and finding 3's amendment covers only the held-against-incoming rule.
- **The `waitingTickets` duplicate is confirmed (executed).** The probe gives `["K-1","K-1","K-2"]` from duplicated rows on the no-spelling arm, both on main and at the #2814 head. On the matched arm, `unionDedup` gives `["K-1"]`.

## (b) Approach

- **Finding 1 is already in the code under review, not only in the plan text (executed).** PR #2814 adds `if (inbox === undefined) return render([], 'The inbox was not read — …')` at the head of the tracker-account arm. My probe models a Jira repository with no `Ticket prefixes`: the inbox read answers `unaskable`, `inboxOutcomeOf` gives `inboxSkipped()` (`issue-refresh.ts:258`), and so `inbox` is undefined. The open rows are the reader's own two tickets.
  - On main: `{"n":2,"notice":null,"hidden":0}`.
  - At #2814: `{"n":0,"notice":"The inbox was not read — showing none of your tickets rather than the project's.","hidden":2}`.
  - With no `jira:` spelling declared, main gives `n:1` and #2814 gives `n:0`.
  - The PR's own test, *"a matched Jira reader with an absent inbox answers 0 tickets rather than the open rows"*, pins this regression as intended behaviour.
  - The subject plan puts finding 1 in its **second** wave and makes it a text change: it "names the signal … in the draft PR #2814's brief". Nothing in either plan stops #2814 from merging first. A brief edit cannot be checked against code, so this done-condition does not prove the fix.
- **Open question 2 has an answer in the domain, and slice 2's wording would add a second rule.** `ownership({ kind: 'plan', assignee, author, approver })` already exists (`ownership.ts:135-141`, `:267-268`). It returns `mine` where any of the three fields resolves to the reader, and `theirs` only where none does and one of them is a declared spelling of another person. The subject plan says "`PlanOwnerFields` (`author`, then `assignee`)", which invents a precedence that the existing rule does not have. The Draft row should pass its `PlanOwnerFields` to `ownership` as a `plan` row. That reuses one rule, and `unknown` stays visible as the released contract requires.
- **Amendment (4) as written introduces a defect.** The subject plan wants the parent's slice 2 "placed in a later wave … with a `waits:` annotation". The parent already has the later wave. A `waits:` that names a branch of the same plan adds nothing. The subject plan's own `<!-- waits: Plan text -->` does not parse: `waits:` takes a branch name (`plot-dispatch/SKILL.md:650-652`), and `plot-plan-meta.sh` reports it as `unread_waits: [{"branch":"bug/plan-2809-design-gaps","value":"Plan text"}]`. No gate refuses it (`check-plan-headings.sh` passes), so the error goes unnoticed. Its two waves are already in order.

## (c) Slices

- Both slices edit one file. The wave order handles that, so drop the `waits:` comment.
- **The order is wrong for the risk.** Finding 1 is the only finding with a live code consequence, through #2814. It should be decided first. It should also gate #2814, for example with `<!-- waits: bug/plan-2809-design-gaps -->` on the parent's `Inbox` slice line, which is a cross-plan `waits:` of the kind the gate exists for. The other option is a `PLOT-CORRECTION.md` on #2814's desk. Findings 3, 5, 6 and 7 are text-only and can follow.
- Finding 2 needs no person's decision now (see (d)), so it can join the text slice.

## (d) Open questions

- **Q1 (rows scope or four-valued outcome):** From the testability lens, the outcome wins. `waitingTickets` must tell four cases apart:
  - `answered` (with `[]` distinct from absent)
  - `unaskable`: the rows are person-scoped, so keep the rows
  - `failed` with no kept rows (`issue-refresh.ts:259-262`): 0 tickets, with a notice that names the failure
  - `not-read`: a skipped read after a closed-read refusal (`issue-refresh.ts:500-503`)

  A boolean rows scope cannot give `failed` and `not-read` different wording. The plan must also carry a new question. The fleet path reads `index.inbox` from the persisted index (`board/src/server/fleet.ts:2262`). `IssueIndexSchema` has `inbox` and `inboxAt` and no outcome field (`issue-index.ts:166-178`). So the signal needs a schema field written by `inboxOutcomeOf`, plus a decision on what an index without that field reads as. The obvious answer, `not-read`, gives 0 tickets on every person-scoped repository until fleetd rewrites the index. That needs a test.
- **Q2:** Answered above: use `ownership`'s `plan` arm over all three fields, with no precedence.
- **Q3:** Yes, and executed: #2814 takes the two-state position (absent inbox gives 0), and the probe shows it regresses person-scoped Jira repositories. Slice 2 does not shrink. #2814 changes.
- New question: does the parent's slice 2 also collapse duplicates already in `held`, with the `replaces` rule choosing among them? The probe shows the current fold keeps them.

## (e) Tests that prove each finding is handled

| Finding | Test that proves it | Tier |
|---|---|---|
| 1 | At #2814's head: `waitingTickets(rows, undefined, reader, JIRA, true, outcome='unaskable')` keeps the reader's rows (n=2, no notice). `failed` and `not-read` give 0 tickets and their own notices. `answered` + `[]` gives 0 tickets and no notice. `packages/domain/test/waiting-tickets.test.ts`, replacing the PR's *"matched Jira reader with an absent inbox answers 0 tickets"*. A board unit test in `unplanned-issues.test.ts`: a `ticket-projects` stub that answers `[]` (unaskable) still gives `entry.waiting` the open rows. | domain unit + board unit |
| 2 | Domain: `ownership({kind:'plan', assignee:'', author:'jwloka', approver:''}, reader)` returns `mine`; it likely exists already, so cite it. Board unit: `draftPlanRows` plus the «Mine» filter hides a Draft row whose `PlanOwnerFields` name another declared person and keeps one with all three empty (`unknown`). Optionally, one browser assertion that the row disappears under «Mine». | domain unit + board unit |
| 3 | `fold-issue-rows.test.ts:23` and `:41` unchanged and green. A new case: `foldIssueRows([A@1, A@2], [])` gives one A, the newer one. Today it gives two (executed). | domain unit |
| 4 | `plot-plan-meta.sh` on the parent shows three waves and `unread_waits: []`. A grep finds no "any order" in the parent's Notes. | read-only script |
| 5 | A grep of the parent plan: `foldIssueRows` appears beside `packages/domain`, and `issue-write-through.ts` is named as a second caller. | text check |
| 6, 7 | A grep: the "Not a defect" paragraph names `plan-card.ts`, `pr.author`, `hostUser`, and no longer says "rests on rows that were Draft plan rows". A Changelog or slice line names the `People` nickname documentation. | text check |
| subject plan | `plot-plan-meta.sh` on the subject plan gives `unread_waits: []`. Today it gives one entry (executed). | read-only script |

Findings 3 to 7 can be checked by grep and by `plot-plan-meta.sh`, which is enough for a text slice. Finding 1's done-condition, as written ("names the signal … in the brief"), cannot be checked. The plan should replace it with the domain test above, run at #2814's head.

## Amendments

1. Make finding 1 the first wave. Gate #2814 on it: a cross-plan `<!-- waits: bug/plan-2809-design-gaps -->` on the parent's `Inbox` line, or a correction on #2814's desk. State the done-condition as the unaskable-keeps-rows domain test, green at #2814's head, with the PR's *"matched Jira reader with an absent inbox answers 0 tickets"* expectation replaced.
2. Carry the new question: the outcome needs a field in `IssueIndexSchema`, and a held index without that field must not read as `not-read`/0 tickets on a person-scoped repository.
3. Replace "`author`, then `assignee`" with: the Draft row passes its `PlanOwnerFields` to `ownership` as `{ kind: 'plan' }` (`ownership.ts:267-268`), and the test is a board unit test over `draftPlanRows` plus «Mine». Close Q2.
4. Rewrite amendment (4): the parent's waves already order the slices. Replace only the Notes sentence, and add no same-plan `waits:`. Remove the subject plan's own unparseable `<!-- waits: Plan text -->`.
5. Extend amendment (3): the parent's slice 2 also collapses a duplicate already in `held`, with a `foldIssueRows([A@1, A@2], [])` test. Extend (5) to name `issue-write-through.ts` as a second `foldIssueRows` caller and `packages/domain/test/` as the test location.
6. Correct the Motivation: slice 2 of the parent (`bug/ticket-rows-appear-once`) also has no branch yet (`git ls-remote` finds none).
