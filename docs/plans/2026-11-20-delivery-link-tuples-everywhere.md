# Every artifact on the Delivery tab is a linked tuple

> Every plan, story, slice, PR, branch, release, ticket and sprint that the Delivery tab names is a link in one bordered tuple with its Octicon, a PR and its branch form one tuple with both halves linked, and a plan or story with tickets carries one linked ticket prefix per ticket.

## Status

- **State:** Released
- **Type:** feature
- **Sprint:** delivery-ui-polish
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3583 merged
- **Started:** 2026-11-20, Jan Wloka, `feature/delivery-tuple-vocabulary`
- **Started:** 2026-11-20, Jan Wloka, `feature/delivery-tuples-in-every-row`
- **Delivered:** 2026-11-21
- **Released:** 2026-11-23, v2.36.0

## Changelog

- Every artifact the Delivery tab names is a link: plans, stories, slices, PRs, branches, releases, tickets and sprints, in rows, section headers, menus and empty-state sentences. Each shows as a bordered tuple with its GitHub icon.
- A PR and its branch show as one tuple, `[PR 3581 | bug/…]`, and both halves link.
- A plan or story with tickets carries one linked ticket prefix per ticket before the plan link, in the ticket colour. A ticket or PR number never truncates; a branch name truncates with an ellipsis and shows the full name on hover.
- Ticket rows in the Tickets section use the same tuples.

<!-- Board impact: the Delivery tab only (packages/board, packages/domain). No plan format, template, helper script or docs/plans layout changes. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. -->

## Motivation

Plan 1 of 7 of the sprint "Delivery UI Polish". The approved design spec is `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md` (outside this repository), with mockups in `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish/`; `header-and-sections-v2.html` is the reference. The spec is canonical for everything this plan does not restate.

The spec's intent: users of the Delivery tab do not understand what they can do and what they must do. Some artifacts on the tab are plain text, some are links, and a PR and its branch show as two separate things. This plan implements the spec's goal 7 and its *Link tuples* section. Plans 4 and 5 draw their header and rows with these tuples, so this plan comes first; plan 2 can run in parallel.

## Design

### Approach

Link tuples exist today. `TupleRow.tsx` (`packages/board/src/app/components/TupleRow.tsx`) draws a row's tuple, and `tuple-row.ts` (`packages/board/src/app/lib/tuple-row.ts`) holds its links: `TupleLink['what']` names `plan`, `branch`, `pr`, `ticket`, `wave` and `worktree` (`LINK_ICON_PATH`, `tuple-row.ts:208-215`). `TupleRow.tsx:27` already draws ticket prefixes through `PlanTicketKeys` (`packages/board/src/app/components/PlanTicketKeys.tsx`, with `TicketHrefContext` provided at `App.tsx:1286`, #3572). This plan extends them; it does not add a second tuple, icon or ticket vocabulary.

- **One icon vocabulary.** The icon kind comes from `linkIconKind` (`packages/domain/src/rules/link-icon.ts:52`), which already names `plan`, `slice`, `branch`, `pr`, `ticket`, `story`, `sprint` and `release`. The glyphs come from `GLYPH_PATH` (`packages/board/src/app/lib/glyphs.ts:10`), the board's one Octicon table. Add the missing Octicons from the spec: `tag` (release), `book` (story), `stack` (slice), and the sprint glyph, and extend `TupleLink['what']` and `LINK_ICON_PATH` to the kinds `linkIconKind` names.
- **PR and branch are one tuple.** `[PR 3581 | bug/…]`: one bordered pill, two segments, each with its own link and icon.
- **Ticket prefixes.** A plan or story with one or more tickets carries one linked ticket segment per ticket before the plan segment (`[#3512 | jenkins-reads-in-process]`, `[EKP-77 | EKP-78 | red-hold-…]`). The keys come from `planReference` (`packages/domain/src/rules/plan-reference.ts:268`). Ticket segments use a ticket colour distinct from PR/plan blue (spec call: purple in the mockup).
- **Truncation.** A branch segment truncates with an ellipsis and shows its full name on hover (`splitBranch`, `BRANCH_TAIL_CHARS`, `tuple-row.ts:229-262`, stay the rule). A ticket or PR number never truncates.
- **Everywhere an artifact is named.** Rows in every Delivery section, section headers, ⋯ menus, and empty-state sentences that name an artifact. Ticket rows in the Tickets section (`TicketsSectionView`, `packages/board/src/app/components/TicketsSection.tsx`) use tuples. The header that plan 4 builds and the menus that plan 5 builds use the same tuple; this plan delivers the tuple they use.
- **Every rendered state is a domain property** (CLAUDE.md). Which segments a tuple has, their kinds, their targets and the ticket keys come from domain or `agent-rows` view functions with unit tests. The component maps them and decides nothing. New domain code is arrow functions with factual TSDoc.
- **No new data sources** (spec non-goal). Every target already exists in the board payload; a tuple for an artifact with no URL in the payload stays text and the plan names that gap in Notes when the builder finds one.

### Open Questions

- [ ] Which Octicon names the sprint segment? The spec lists no sprint glyph; `linkIconKind` names `sprint`. Builder's call, from the published `@primer/octicons` set.

## Slices

### Tuple vocabulary

- `feature/delivery-tuple-vocabulary` — the tuple's segment kinds extended to every kind `linkIconKind` names, the missing Octicons in `GLYPH_PATH`, the PR+branch tuple with both segments linked, ticket segments in their own colour, and numbers that never truncate <!-- builds: TupleLink kinds release, story, slice and sprint, and the PR+branch tuple --> → #3584

### Tuples in every row

- `feature/delivery-tuples-in-every-row` — every artifact in the Delivery sections, section headers and the Tickets section's rows drawn as a tuple from one view function, with unit tests for the segments of each row kind <!-- builds: tuples in every Delivery row and section header --> → #3593

## Notes

- Created by `/plot-idea` in one batch with the other six plans of the sprint "Delivery UI Polish". Type `feature` came from the brief; the design question was answered no, because the design spec already exists outside the repository, so the plan starts in Draft.
- Deliverable search found the tuples this plan extends: `packages/board/src/app/components/TupleRow.tsx` and `packages/board/src/app/lib/tuple-row.ts`.
- Plans 4 (`delivery-tab-has-one-header`) and 5 (`delivery-rows-act-from-one-place`) wait on `feature/delivery-tuples-in-every-row`.
