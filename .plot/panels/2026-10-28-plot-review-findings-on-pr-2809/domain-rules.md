# Juror verdict: domain rules (waitingTickets and ownership)

Position: amend

Evidence: Read the subject plan, the parent plan `2026-10-28-empty-jira-inbox-read-as-a.md`, issue #2813, the draft PR #2814 (`gh pr view` and `gh pr diff` at `5472779b9`), `waiting-tickets.ts`, `tracker-jira.ts:131-185`, `issue-refresh.ts:180-262,412-531`, `issue-index.ts:123-180`, `plot-host.sh:5280-5350`, `ownership.ts`, `person.ts`, `mine-filter.ts`, `working-agents.ts:115-136`, `board.ts:2800-2944`, `fleet.ts:1905-1950,5150-5400,6650-6690,6860-7030`, `fold-issue-rows.ts` and `fold-issue-rows.test.ts`. Ran two vitest probes against `packages/domain` extracted with `git archive` into a scratch dir, once at main (`4dbf2ed40`) and once at the #2814 head (`5472779b9`): (1) `waitingTickets` over a person-scoped Jira read with `inbox: undefined`; (2) `ownership`/`isMine` for a `plan` row whose `author` and `assignee` name different people.

## (a) Problem statement

**Finding 1 holds, and #2814 already ships the defect.** `tracker-jira.ts:179-181` answers `unaskable` "with none, the open read is already person-scoped" when no `Ticket prefixes` is declared. `plot-host.sh:5283-5292` confirms the mechanism: the open read keeps `assignee = currentUser()` exactly when `$scope` is empty. fleetd turns that `unaskable` into an absent inbox (`issue-refresh.ts:258`, `inboxSkipped()`), and the schema documents the collapse ("absent where no inbox read happened (no `Ticket prefixes` declared, or a tracker other than Jira)", `issue-index.ts:166-170`). Jira is the only `tracker-account` source (`tracker-listers.ts:20`), so the defect is confined to Jira, but it reaches every Jira repo without `Ticket prefixes`.

Executed: three open rows assigned to the reader, `inbox: undefined`, `JIRA` source:

| code | `jira:` spelling | shown | hidden | notice |
|---|---|---|---|---|
| main `4dbf2ed40` | none | 3 | 0 | null |
| main `4dbf2ed40` | declared, matching | 3 | 0 | null |
| #2814 `5472779b9` | none | 0 | 3 | "The inbox was not read — showing none of your tickets rather than the project's." |
| #2814 `5472779b9` | declared, matching | 0 | 3 | same |

The #2814 notice is also false in that case: the inbox was not asked because it is redundant, and the rows shown as "the project's" are the reader's own. For a failed read the notice is false in a second way: the inbox was read and failed.

**Finding 2's conclusion holds, but its mechanism is partly misstated.** `carriesDraftPlan` (`fleet.ts:5292-5294`) only sets `kind: 'plan'` on a row that already exists. An `idea/` branch with no open PR reaches the loose-branch loop (`fleet.ts:6893-6903`) and gets `plan: ''` (`fleet.ts:7023-7026`), so `draftPlanRows` (`working-agents.ts:133-136`, keyed on `row.plan`) does **not** suppress the Draft plan row for it. Only an open plan PR's row carries the slug (`plan: ideaSlug`, `fleet.ts:6688`) and suppresses it. The Draft-row population is also narrower than the finding implies: `draftPlans` holds Draft plans from `origin/<default>` and the working tree only. A plan that exists only on a branch feeds `fieldsBySlug` and nothing else (`board.ts:2915-2925`). Either way, no Draft plan row has an open plan PR, so "the plan PR's author" is empty, and the finding's conclusion stands. `PlanOwnerFields` (`board.ts:2804-2808`) is the right source. For these plans, `author` comes from `planAuthors` on the default branch (`board.ts:2928-2932`), and it is `''` only for a working-tree-only plan.

**Finding 3 holds.** `replaces` (`fold-issue-rows.ts:14-18`) and the tests at `fold-issue-rows.test.ts:23` and `:41` pin "the held newer row is kept".

**Finding 4 holds.** #2814 changes `waiting-tickets.ts` and `waiting-tickets.test.ts`, the files that the parent's slice 2 also edits.

**Finding 5 needs one more correction.** `issue-refresh.ts:420` calls `foldChangedIssueRows`, not `foldIssueRows`. The direct callers of `foldIssueRows` are in the domain: `fold-issue-rows.ts:87-88` and `issue-write-through.ts:83-90`. The amended text should name the fleet caller as the caller of `foldChangedIssueRows`.

## (b) Approach

**Signal for finding 1: use a rows scope, not the four-valued inbox outcome.** The question `waitingTickets` must answer is "are `rows` already the reader's?". That is a property of the open read's query, and the fact that decides it is whether `Ticket prefixes` is declared (`plot-host.sh:5292`). The outcome `unaskable` means "person-scoped" only because `tracker-jira.ts:179` gates on the same fact. Inferring the scope from the outcome would couple a domain rule to one adapter's reason for refusing. The outcome has a second cost: fleetd drops it today (`issue-refresh.ts:258`), and `IssueIndexSchema` is `.strict()`, so carrying it needs a new persisted field and a schema change anyway. Concretely:

- `waitingTickets(rows, inbox, reader, source, complete, plans, rowsScope)` with `rowsScope: 'person' | 'project'`. With `person`, an absent inbox keeps today's arms (rows are the candidates). With `project`, an absent inbox gives 0 tickets and a reason.
- The supplier is the one read of `Ticket prefixes` that the connector already makes (`projectsRead` → `plot-host.sh ticket-projects`, `tracker-jira.ts:131-139`; the code comment there calls it "THE ONE READ"). The board has this value on both paths for free; it is config, not a bought answer, so "A Decision Reads The Index" is not touched. On the fleet path, fleetd should record the scope beside `rows` in `issues.json`, because the scope belongs to the read that produced those rows. An alternative is that the board re-reads config; the plan should pick one.
- The inbox outcome (`answered | failed | not-read`) is only needed to *word* the notice. It should not decide the rows.

**Owner for finding 2: no precedence; pass all three fields.** The domain already answers this question. `ownership({ kind: 'plan', assignee, author, approver })` → `planOwnership` gives `mine` when any field resolves to the reader, and `theirs` only when none does and one is declared for another person (`ownership.ts:118-127, 267-268`). Executed with `People = jwloka = Jan Wloka; mruepp = Markus Ruepp; eins78 = Max Albrecht` and a plan with `author: 'Jan Wloka'`, `assignee: 'mruepp'`: jwloka → `mine`, mruepp → `mine`, eins78 → `theirs`; an authorless plan → `unknown` (`isMine` true). The plan's "`author`, then `assignee`" would make the plan `theirs` for one of its two named people, and it drops `approver`. That contradicts the rule that the Discovery card (`ownedFromCard`, `mine-filter.ts:120-121`) and no-PR branch rows (`ownedFromRow`, `mine-filter.ts:97-101`) already use. The Draft row should carry `assignee`, `author` and `approver` in `DraftPlanSchema` (`schema.ts:4180-4189`) and go through the same `ownership`. The filter call should sit in `agent-rows/` beside `draftPlanRows`, not in `AgentList.tsx:514,1176`, so it is unit-testable ("Every rendered state is a domain property").

The released contract holds under both proposals: `unknown` stays visible (`isMine` is `!== 'theirs'`, `ownership.ts:288`).

## (c) Slices

- **#2814 is the vehicle for finding 1, not the plan text.** The plan's Open Question 3 has an answer: yes, #2814 takes the two-state position (`if (inbox === undefined) return render([], …)` before the spelling arms), and the probe above shows the regression. Slice 2 therefore does not shrink. The plan must say that #2814 does not merge until it carries the scope signal, and it should send the correction to that desk. In the current order, slice 2 waits on the docs slice, and #2814 can land first with the defect.
- The two slices of this plan edit the same parent plan file, which is the defect finding 4 names. The `waits:` ordering handles the conflict. Once this plan's PR records the two decisions, both amendments are plan text only. One slice would carry them, and `bug/` is the wrong prefix for a text-only branch.
- Nothing here needs to ship first as a separate bug, apart from holding #2814.

## (d) Open questions

- *Rows scope or four-valued outcome?* The rows scope, from `Ticket prefixes`, as argued in (b). The outcome only words the notice.
- *Which `PlanOwnerFields` value wins?* None wins. The existing `planOwnership` reads all three; see (b).
- *Does #2814 take a position?* Yes, the two-state one, and the probe shows it regresses person-scoped repos. Amend #2814.
- New: `PLOT_JIRA_JQL` overrides both the open read and the inbox read (`plot-host.sh:5326`, `:5350`). With it set, the scope does not follow `Ticket prefixes`. Should a custom JQL count as `person` scope, as `project` scope, or as unknown, with unknown keeping today's behaviour?
- New: what does the notice say for a project-scoped read whose inbox *failed*, compared with one never read on a board that has not yet run a pass? #2814 says "not read" for both.
- New: the observed three Draft rows on ewz-kus-portal are Draft plans on ewz's default branch or working tree (`board.ts:2823-2824`), not plans on `idea/` branches. Does that agree with the connectors juror's `origin/idea/<slug>` finding? If those plans exist only on `idea/` branches, they are loose branch rows (`plan: ''`, owner `other`), and slice 3 would not fix them.

## (e) Tests

- Domain unit (`waiting-tickets.test.ts`): a matrix over `rowsScope` × `inbox` (`undefined`, `[]`, non-empty) × spelling (none, matching, another person's). `person` + `undefined` keeps the reader's rows (the probe above, as a test). `project` + `undefined` gives 0 tickets and no spelling advice. `[]` gives 0 tickets and no notice on both scopes.
- Board unit (`unplanned-issues.test.ts`, which already has a `ticket-projects` fixture case): `ticket-projects` prints nothing, the inbox read answers `unaskable`, and `entry.waiting` holds the open rows. Add the fleet-path twin through `setsOf`/`waitingOf` at `fleet.ts:2262`.
- Domain unit (`ownership.test.ts`): a `plan` row with differing `author`/`assignee` is `mine` for both people (the probe above).
- Board unit (`draft-plan-row.test.ts`): a Draft plan carries `assignee`/`author`/`approver`; the «Mine» filter hides a `theirs` Draft row and keeps an `unknown` one. A Draft plan with an `idea/` branch with no PR still gets a Draft plan row (`plan: ''` on the loose row) and takes its owner from `fieldsBySlug`.
- Browser: one test that «Mine» hides a `theirs` Draft row. Visibility only; the browser test makes no decision.

## Amendments

1. Answer Open Question 3 in the plan: #2814 implements the two-state rule and regresses person-scoped Jira repos to 0 tickets. State that #2814 does not merge until it carries the scope signal, and route the correction to its desk.
2. Choose `rowsScope: 'person' | 'project'`, derived from `Ticket prefixes` (the connector's one `ticket-projects` read), as the input that decides; use the inbox outcome for the notice wording only. Name the supplier on both paths, and decide whether fleetd records the scope in `issues.json`.
3. Replace "`PlanOwnerFields` (`author`, then `assignee`)" with "`assignee`, `author` and `approver` through the existing `ownership({ kind: 'plan' })`", and close Open Question 2 with that answer.
4. Correct finding 2's mechanism: an `idea/` branch with no PR is a loose row with `plan: ''` (`fleet.ts:7023-7026`) and does not suppress a Draft row. The Draft-row population is the Draft plans on the default branch and in the working tree.
5. Correct finding 5's caller: `issue-refresh.ts:420` calls `foldChangedIssueRows`; `foldIssueRows`'s direct callers are in the domain.
6. Add the `PLOT_JIRA_JQL` scope question and the failed-versus-not-read notice question to Open Questions.
7. Merge the two text slices into one `docs/` slice once the decisions are recorded, or justify the second branch and its `bug/` prefix.
