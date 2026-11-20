# The Tickets section shows what the sprint delivers and what it found

> The Delivery tab's Tickets section adds two groups for the scope: the tickets the scope's plans name in `Issue:`, and the review and verification findings fleetd opened while delivering the scope, with the ticket-to-scope association as a domain property.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-ui-polish
- **Review:** pr
- **Impl:** own branches

## Changelog

- The Tickets section shows two more groups, folded by default, after the tickets with no plan: **Delivered by the sprint** and **Found during the sprint**. Both follow the scope selector (all active sprints or my sprint) and the Mine filter.
- *Delivered by the sprint* lists the tickets the scope's plans name in their `Issue:` field, with the ticket, its plan and the plan's state ("Approved · 2 of 3 slices merged", "Released"). An open ticket shows its title; a closed ticket shows its key and its plan.
- *Found during the sprint* lists the open review findings fleetd opened on the scope's PRs and the open verification findings a scope plan's `## Verification` names, with the ticket, the PR or plan it was found on, and its kind.
- The folded Tickets header adds `◎ N delivered by the sprint` and `⚑ N found`.

<!-- Board impact: the Delivery tab only (packages/board, packages/domain). The card gains the issue ids of its refuted claims, read from the plan file the server already reads; no plan format, template, helper script or docs/plans layout changes. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. -->

## Motivation

Plan 7 of 7 of the sprint "Delivery UI Polish", tier *must*. The approved design spec is `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md` (outside this repository), section *Sections outside the five-section layout*, item *Tickets of the scope* (operator requirement), and row 7 of its *Sprint breakdown*. The spec is canonical for everything this plan does not restate.

Today the Tickets section (`TicketsSectionView`, `packages/board/src/app/components/TicketsSection.tsx`, rendered at `AgentList.tsx:1792`) lists only the tickets no plan names (`ticketsSection`, `packages/domain/src/rules/tickets-section.ts:57`). A reader cannot see which tickets the sprint delivers or which findings the fleet opened while it delivered them.

## Design

### Approach

- **Two scope groups**, each its own group, folded by default, after today's "no plan" group (assigned to me by default), which stays first.
- **Delivered by the sprint.** The tickets the scope's plans name in their `Issue:` field. A card carries them as `Card.issues` (`packages/board/src/contract/schema.ts:755`). Row: ticket tuple, plan tuple (plan 1), the plan's state. A ticket the issue index carries (open) shows its title from the index; a ticket it does not carry (closed) shows its key and its plan only, because no payload holds closed tickets (no new data source).
- **Found during the sprint.** Open findings only, from the issue index:
  - **Review findings:** issues titled `plot-review: findings on PR #<n>` (`reviewIssueTitle`, `packages/domain/src/rules/review-issue.ts:20`), matched by `findOpenReviewIssue` (`review-issue.ts:33`), where PR `<n>` belongs to a slice of a scope plan (`Card.prs`, `schema.ts:595`). Row: ticket tuple, the PR tuple it was found on, kind "review finding".
  - **Verification findings:** the issue a `Claim-<n> refuted` line in a scope plan's `## Verification` names. `refutedClaims` (`packages/domain/src/rules/verification-record.ts:85`) reads those lines and returns each claim's `issue` (`RefutedClaim`, `verification-record.ts:29-41`); `plot-verify.mjs` writes them. Row: ticket tuple, the plan tuple it was found on, kind "verification finding".
- **The association is a domain property.** One domain rule takes the scope's cards, their PRs and refuted-claim issues, and the issue rows, and answers which ticket belongs to which scope group, on which plan or PR, as which kind. Unit tests cover each kind, a closed delivered ticket, a finding on a PR outside the scope, and a ticket that is both delivered and a finding. New domain code is arrow functions with factual TSDoc.
- **Scope and Mine.** Both groups follow the scope selector (`DeliveryScopeKind`, `packages/domain/src/rules/delivery-scope.ts:8`) and the Mine filter like every section, per the spec's table. With Mine on, a ticket counts as the reader's when it is assigned to the reader or its plan is the reader's (operator decision, 2026-11-20).
- **Review findings match by title.** The board's issue row carries no labels (`IssueRowSchema`, `schema.ts:3711`), so the board matches a review finding by its title alone through `findOpenReviewIssue`; the `ai-generated` label stays the tracker query's concern. No label field is added to the row (operator decision, 2026-11-20).
- **Refuted-claim issues on the card.** The board server adds the issue ids from `refutedClaims` over the plan file it already reads, as a new card field with a schema default. It is a new payload field, not a new data source (operator decision, 2026-11-20).
- **Folded summary.** The Tickets summary that plan 3 builds adds one chip per group: `◎ N delivered by the sprint`, `⚑ N found`. Zero counts show grey.
- **⋯ and tuples.** Rows use plan 1's tuples and, once plan 5's ⋯ column exists, its ⋯ menu.
- **No hidden UI.** An empty group stays visible as its label and "— none" (plan 2).
- **Board tests.** Moving assertions into unit tests updates `stubbed-tests-start-no-board.test.ts` with the reason.

### Open Questions

- [x] The spec matches review findings by the label `ai-generated` (`REVIEW_ISSUE_LABEL`, `review-issue.ts:5`) and the title. The board's issue row carries no labels (`IssueRowSchema`, `schema.ts:3711`, "No labels and no priority"), and `findOpenReviewIssue` reads titles only. Proposal: match by title alone in the board, and leave the label to the tracker query that fills the index. Reviewer to confirm, because adding labels to the row is a new payload field.
- [x] The card carries the count of refuted claims (`Card.verification.refuted`, `schema.ts:530-532`) and not the issue ids they name. Proposal: the board server adds the ids from `refutedClaims` over the plan file it already reads, as a new card field with a schema default; that is not a new data source. Reviewer to confirm.

## Slices

### Tickets of the scope

- `feature/tickets-show-what-the-sprint-delivers-and-found` <!-- waits: feature/delivery-tuples-in-every-row, feature/folded-sections-summarise-visually --> — the ticket-to-scope association as a domain rule with unit tests, the refuted-claim issue ids on the card, and the Delivered by the sprint and Found during the sprint groups folded by default with their folded-summary chips <!-- builds: scopeTickets, the association of a ticket to the scope's plans and PRs -->

## Notes

- Created by `/plot-idea` in one batch with the other six plans of the sprint "Delivery UI Polish". Type `feature` came from the brief; the design question was answered no, because the design spec already exists outside the repository, so the plan starts in Draft.
- Waits on plan 1's `feature/delivery-tuples-in-every-row` (row tuples) and plan 3's `feature/folded-sections-summarise-visually` (the Tickets folded summary), named in the `waits:` marker. Plan 3 waits on plan 2, so the scope groups land in the section frame plan 2 builds.
- Deliverable search: `refuted-issues.ts` (`packages/domain/src/rules/refuted-issues.ts`) decides which refuted claims open an issue and records them in `.plot/state/verify/<slug>.json`; this plan reads the issue ids from the plan's `## Verification` lines, as the spec says, and does not read that state file.
