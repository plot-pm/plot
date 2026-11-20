# The Tickets section shows what the sprint delivers and what it found

> The Delivery tab's Tickets section adds two groups for the scope: the tickets the scope's plans name in `Issue:`, and the review and verification findings fleetd opened while delivering the scope, read from a server-side payload field over the issue sets the server already holds, with the ticket-to-scope association as a domain property.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-ui-polish
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- The Tickets section shows two more groups, folded by default, after the tickets with no plan: **Delivered by the sprint** and **Found during the sprint**. Both follow the scope selector (all active sprints, or every sprint the reader owns under My sprint) and the Mine filter.
- *Delivered by the sprint* lists the tickets the scope's plans name in their `Issue:` field, with the ticket, its plan and the plan's state. A ticket the board holds shows its title, open or closed; a ticket the board does not hold shows its key and its plan, and the row does not call it closed.
- *Found during the sprint* lists the open review findings fleetd opened on the scope's PRs and the open verification findings a scope plan's `## Verification` names, with the ticket, the PR or plan it was found on, and its kind. A finding shows only here, not also among the tickets with no plan.
- While the tracker cannot be read, both groups still show what the plans name, and each count says it is unread instead of showing 0.
- The folded Tickets header adds `◎ N delivered by the sprint` and `⚑ N found`.

<!-- Board impact: the Delivery tab only (packages/board, packages/domain). Two new payload fields from what the server already reads: the issue rows the plans name, from the issue sets the server holds, and the card's refuted-claim issue ids, from the plan file the server already reads. No new external query; no plan format, template, helper script or docs/plans layout changes. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. -->

## Motivation

Plan 7 of 7 of the sprint "Delivery UI Polish", tier *must*. The approved design spec is `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md` (outside this repository), section *Sections outside the five-section layout*, item *Tickets of the scope* (operator requirement), and row 7 of its *Sprint breakdown*. The spec is canonical for everything this plan does not restate.

Today the Tickets section (`TicketsSectionView`, `packages/board/src/app/components/TicketsSection.tsx`, rendered at `AgentList.tsx:1792`) lists only the tickets no plan names (`ticketsSection`, `packages/domain/src/rules/tickets-section.ts:57`). A reader cannot see which tickets the sprint delivers or which findings the fleet opened while it delivered them.

## Design

### Approach

**Slice 1, the payload:**

- **The row set the rule reads.** Neither of today's client row sets can serve the two groups. `Fleet.issues` leaves out every ticket a plan names and stops at `ISSUE_LIMIT = 50` rows (`inboxOf`, `packages/board/src/server/fleet.ts:2170-2173`, `:257`). `Fleet.waiting.tickets` holds only the reader's selection and hides unassigned rows (`waitingTickets`, `packages/domain/src/rules/waiting-tickets.ts:105-118,141-198`), and fleetd opens its review findings with no assignee (`packages/fleet/src/shared/auto-ticket.ts:112-116`). The server holds the open and closed rows unfiltered in `entry.issueSets` (`fleet.ts:931-939`): the open set's `rows` and `complete`, and the closed rows of the last `ISSUE_INDEX_CLOSED_DAYS` (14) days (`packages/domain/src/entities/issue-index.ts:26`), which `ticketLaneData` already serves to the Discovery tab (`fleet.ts:1964-1986`).
- **New payload field `planTicketRows`.** The fleet payload gains `planTicketRows`, with a schema default of `[]` and no `ISSUE_LIMIT` cut. The server builds it from `entry.issueSets` (open `rows` and `closed.rows`), keeping a row whose key a plan's `Issue:` field names (`ticketPlansOver`, `fleet.ts:1811-1836`), whose title is a review-finding title (`reviewIssueTitle`, `packages/domain/src/rules/review-issue.ts:20`), or whose key a card's `refutedIssues` names. Each row carries its state (open or closed) and the open set's `complete` flag. It adds no tracker call: the sets are the ones the board already holds. A server test in `packages/board/test/unit/` asserts that a ticket a plan names reaches the field with its title, that a closed one in the closed set reaches it as closed, and that a review finding beyond the 50-row inbox cut reaches it.
- **New card field `refutedIssues`.** The board server adds the issue ids from `refutedClaims` (`packages/domain/src/rules/verification-record.ts:85`) as a new card field with a schema default of `[]`. It is filled where `card.verification` is, from the same `refutedClaims(delivered.text)` call (`packages/board/src/server/board.ts:3046`), which runs only for a plan with a readable delivery commit (`reads.delivered`, `board.ts:3038`), and is `[]` elsewhere (operator decision, 2026-11-20: a new payload field, not a new data source). A server test asserts that a Delivered plan with one `Claim-1 refuted — … — #1712` line yields `["1712"]` and a plan with no `## Verification` section yields `[]`.

**Slice 2, the groups:**

- **Two scope groups**, each its own group, folded by default, after today's "no plan" group (assigned to me by default), which stays first. The fold keys are `tickets-delivered` and `tickets-found`; they join `KNOWN_KEYS` and `COLLAPSED_BY_DEFAULT` (`packages/board/src/app/lib/agent-rows/collapse.ts:6,17`) and persist per reader like a section.
- **Delivered by the sprint.** The tickets the scope's plans name in their `Issue:` field. A card carries them as `Card.issues` (`packages/board/src/contract/schema.ts:755`). Row: ticket tuple, plan tuple (plan 1), the plan's state. A ticket in `planTicketRows` shows its title and its open or closed state. A ticket that `planTicketRows` does not hold (closed before the 14-day window, or absent from an incomplete read) shows its key and its plan only, and the row prints no "closed" word or styling: absence is not a state (CLAUDE.md, *the index never says no*).
- **The plan's state reuses `ticketPhase`.** The state cell is `ticketPhase` (`packages/domain/src/rules/ticket-phase.ts:57`) over the ticket's `TicketPlan` records (`ticket-phase.ts:4`; built per ticket by `ticketPlansOver`), as `waitingTickets` already uses it (`waiting-tickets.ts:165-169`). It is an output field of the association rule, and no `.tsx` file composes it. Unit cases: Approved with merged/total progress, Delivered, Released, and an unread pulse with `merged: null`.
- **Found during the sprint.** Open findings only, from `planTicketRows`:
  - **Review findings:** rows titled `plot-review: findings on PR #<n>`, matched by `findOpenReviewIssue` (`review-issue.ts:33`), where PR `<n>` belongs to a slice of a scope plan (`Card.prs`, `schema.ts:595`). Row: ticket tuple, the PR tuple it was found on, kind "review finding".
  - **Verification findings:** the issue that a `Claim-<n> refuted` line in a scope plan's `## Verification` names, read from the card's `refutedIssues`. Row: ticket tuple, the plan tuple it was found on, kind "verification finding".
- **A finding leaves the "no plan" group.** No `Issue:` line names a finding, so today it also lists among the tickets with no plan (`inboxOf`; `splitTicketRows`, `packages/board/src/app/lib/agent-rows/waiting-view.ts:122-139`). The association rule returns the finding keys, and the "no plan" group and its header count (`tickets-section.ts:63`) exclude them. The finding row's ⋯ keeps Create plan, because no plan names it.
- **The association is a domain property.** `scopeTickets(input)` takes the scope's cards (their `issues`, `prs`, `refutedIssues` and phase), `planTicketRows`, the issue answer, the reader and the Mine mode. It answers which ticket belongs to which scope group, on which plan or PR, as which kind, with which state text, and which keys leave the "no plan" group. Unit tests cover each kind; a closed delivered ticket; a delivered ticket that `planTicketRows` does not hold; a finding on a PR outside the scope; a ticket that is both delivered and a finding; a finding that is also unplanned, which shows only in Found; a review finding beyond the 50-row inbox cut; and an incomplete read (`complete: false`), where the group says the list may be incomplete. New domain code is arrow functions with factual TSDoc.
- **Scope** (operator decision, 2026-11-20). Both groups follow the scope selector (`DeliveryScopeKind`, `packages/domain/src/rules/delivery-scope.ts:8`). In `my-sprint` scope the scope is every active sprint the reader owns, as `deliveryScope` already selects (`delivery-scope.ts:56-61`). The groups hold only the scope's plans: Mine narrows them and never widens them to plans in no active sprint.
- **Mine** (operator decision, 2026-11-20). `ticketIsMine(ticket, plans, reader, mode)` answers per mode. Mode `off` shows every row. Mode `mine` shows a ticket assigned to the reader (`ownership` with kind `ticket`, `packages/domain/src/rules/ownership.ts:298`) or one whose plan is the reader's (`ownership` with kind `plan` over the plan's assignee, author and approver, `ownership.ts:304-305`), and keeps today's rows of unknown owner. Mode `strict` keeps today's rule, `isMineStrict` over the ticket's assignees (`ownership.ts:326`). The plan of a finding is the plan of the PR's slice or the plan whose `## Verification` names it. A key-only delivered ticket carries no assignees, so it is the reader's only through its plan. Unit cells: assigned to another and plan mine → shown in `mine`, hidden in `strict`; assigned to me and plan another's → shown in `mine` and `strict`; an unassigned finding with plan mine → shown in `mine`; a key-only ticket with plan mine → shown in `mine`; and each group over {`release`, `my-sprint`} × {`off`, `mine`, `strict`}.
- **Unread tracker, per group.** Today `TicketsSectionView` renders only the absence sentence when the state is not `rows` (`TicketsSection.tsx:77-83`); the scope groups render outside that branch. While `issueAnswer` is `failed`, `unsupported` or `unasked`, Delivered shows its key + plan rows (the keys come from `Card.issues` and need no tracker), and Found shows its verification findings as key + plan rows plus plan 2's unread or stopped notice for review findings. Each chip shows the unread form instead of a number, because an absent reading is not `0` (`tickets-section.ts:47-49`). Retry is dropped (operator decision, 2026-11-20): the unread notice shows the age of the last good rows from `issueAgeSeconds` (`schema.ts:4895`) through `issueNote` (`packages/board/src/app/lib/agent-rows/host-notes.ts:419`), and the failure alone where that field is `null`. Each state is a unit case of `scopeTickets`.
- **Review findings match by title.** The board's issue row carries no labels (`IssueRowSchema`, `schema.ts:3711`), so the board matches a review finding by its title alone through `findOpenReviewIssue`; the `ai-generated` label stays the tracker query's concern. No label field is added to the row (operator decision, 2026-11-20).
- **Folded summary.** The Tickets summary that plan 3 builds adds one chip per group: `◎ N delivered by the sprint`, `⚑ N found`. Zero counts show grey; an unread count shows the unread form.
- **⋯ and tuples.** Rows use plan 1's tuples and plan 5's ⋯ column. Each row's ⋯ is `IssueRowActions` (`packages/board/src/app/lib/agent-rows/menus.tsx:1689`), as plan 5 makes it the ⋯ of every Tickets row: a delivered row lists Open on host, and Create plan disabled with the reason that a plan names the ticket; a found row lists Open on host and Create plan, plus a link to the PR or plan it was found on.
- **No hidden UI.** An empty group stays visible as its label and "— none" (plan 2).
- **Board tests.** One browser test in `packages/board/test/integration/tickets-section.browser.test.ts` proves that both groups render folded with their label, and "— none" when empty. It is served from a catalogue state in `packages/board/test/catalogue/index.ts` with scope cards, PRs and finding issues, and starts no board. It raises `EXPECTED_TESTS = 719` (`packages/board/test/integration/stubbed-tests-start-no-board.test.ts:956`) by its `it(` count as a plain addition and leaves `EXPECTED_FILES = 99` (`:569`) unchanged.

### Open Questions

- [x] Review findings match by title alone in the board; the label stays with the tracker query (operator decision, 2026-11-20).
- [x] The refuted-claim issue ids reach the board as a new card field, `refutedIssues`, from the plan file the server already reads (operator decision, 2026-11-20).

## Slices

### Payload

- `feature/scope-ticket-rows-in-the-payload` — the `planTicketRows` fleet field over `entry.issueSets` open and closed rows, uncapped, with its server test, and the card's `refutedIssues` from `refutedClaims` where `card.verification` is filled, with its server test <!-- builds: planTicketRows and refutedIssues, the payload fields the scope groups read -->

### Tickets of the scope

- `feature/tickets-show-what-the-sprint-delivers-and-found` <!-- waits: feature/delivery-tuples-in-every-row, feature/folded-sections-summarise-visually, feature/delivery-row-menu-column --> — `scopeTickets` and `ticketIsMine` as domain rules with unit tests, the Delivered by the sprint and Found during the sprint groups folded by default with their fold keys, findings removed from the "no plan" group, the per-group unread state, the ⋯ of each row, and the folded-summary chips <!-- builds: scopeTickets, the association of a ticket to the scope's plans and PRs -->

## Notes

- Created by `/plot-idea` in one batch with the other six plans of the sprint "Delivery UI Polish". Type `feature` came from the brief; the design question was answered no, because the design spec already exists outside the repository, so the plan starts in Draft.
- Panel round 1 (2026-11-20, unanimous `amend`) found that the spec's premise "no payload holds closed tickets" is false: `ticketLaneData` serves closed rows of the last 14 days (`fleet.ts:1963-1986`) and `GET /api/issues/closed` serves up to 1000 (`packages/board/src/server/index.ts:568`). The plan reads closed rows from `entry.issueSets` instead of rendering every delivered ticket key-only. The payload slice was split out as the testability lens proposed; it needs no waits and changes no UI.
- The second slice waits on plan 1's `feature/delivery-tuples-in-every-row` (row tuples), plan 3's `feature/folded-sections-summarise-visually` (the Tickets folded summary) and plan 5's `feature/delivery-row-menu-column` (the ⋯ of the new rows), named in the `waits:` marker. Plan 3 waits on plan 2, so the scope groups land in the section frame plan 2 builds.
- The state cell uses `ticketPhase`'s words ("in progress 2/3", "released") rather than the spec's example "Approved · 2 of 3 slices merged", so that the Tickets section and *Waiting on you* use one vocabulary.
- Known limit: `refutedIssues` is filled only for a plan whose delivery commit the server reads (`board.ts:3038`). A Released scope plan with an open refuted-claim issue therefore lists no verification finding; the server reads no plan text for verification outside Delivered plans today.
- Deliverable search: `refuted-issues.ts` (`packages/domain/src/rules/refuted-issues.ts`) decides which refuted claims open an issue and records them in `.plot/state/verify/<slug>.json`; this plan reads the issue ids from the plan's `## Verification` lines, as the spec says, and does not read that state file.
