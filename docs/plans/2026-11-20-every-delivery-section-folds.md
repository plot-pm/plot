# Every Delivery section folds and says why it is empty

> Every section of the Delivery tab has a 28 px fold button and a header row that toggles, also when the section is empty, and an open section with no rows shows a dashed frame with one sentence of kind clear, unread or stopped.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-ui-polish
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- Every Delivery section folds: Release delivery, You, Work items, Fleet, Machine, Tickets and Not placed. Each has a 28 px fold button with a chevron that rotates on open, and a click anywhere on the header row also toggles it. Each reader's fold is kept in the browser.
- An empty section still folds. Open, it shows a dashed frame with one sentence: green ✓ when nothing waits, amber ! with Retry when a reading failed, grey ■ when the source is stopped or cannot be read.
- An empty group inside an open section shows its label, "— none" and its hint, so the section keeps its structure.

<!-- Board impact: the Delivery tab only (packages/board, packages/domain). No plan format, template, helper script or docs/plans layout changes. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. -->

## Motivation

Plan 2 of 7 of the sprint "Delivery UI Polish". The approved design spec is `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md` (outside this repository), with mockups in `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish/`; `header-and-sections-v2.html` is the reference. The spec is canonical for everything this plan does not restate.

Today only some sections fold, and an empty section looks like a folded one or like a failed reading. The spec's anti-goal is direct: *"Could not read" that looks like "empty", or empty that looks like folded.* This plan implements goals 2 and 4 and the shared section frame. Plan 3 fills the folded header with a visual summary and waits on this plan; plan 1 can run in parallel.

## Design

### Approach

- **The shared frame.** Every section header row holds a 28 px fold button (chevron rotates on open), the section title and the summary slot, on one line; the whole row toggles and carries `aria-expanded`. A section has three states: folded (one line), open (groups and rows), and open-but-empty (dashed frame, one sentence).
- **Seven sections.** The five of `DELIVERY_LAYOUT` (`packages/domain/src/rules/delivery-placement.ts:12-18`: `release-delivery`, `you`, `work-items`, `fleet`, `machine`) and the two the tab renders after them: *Not placed — agent branches* (`AgentList.tsx:1767`) and Tickets (`TicketsSectionView`, `packages/board/src/app/components/TicketsSection.tsx`, rendered at `AgentList.tsx:1792`, anchor `#tickets`). Not placed shows only when it has rows; it is a diagnostic, not a standing section. Tickets keeps its `#tickets` anchor, which the You footer and plan 4's header link jump to.
- **Fold state per reader.** Folds persist in `localStorage` through `collapse.ts` (`readCollapsed`, `writeCollapsed`, `packages/board/src/app/lib/agent-rows/collapse.ts:56,82`). `KNOWN_KEYS` (`collapse.ts:6`) derives from `DELIVERY_LAYOUT`; add keys for Tickets and Not placed. `COLLAPSED_BY_DEFAULT` (`collapse.ts:17`) stays `['free']`, so every section starts open.
- **The `isCollapsible` reversal, for sections only.** `isCollapsible(rowCount) => rowCount > 0` (`collapse.ts:107`) makes an empty group unfoldable, because folding would hide the group's hint. This plan replaces that for **sections**: every section folds, also when empty, and the folded header carries the explanation the hint carried (plan 3 draws it as the summary; this plan carries the empty kind's sentence there until then). **Groups** inside an open section never fold when empty. Update the comment above `isCollapsible` (`collapse.ts:93-106`) and its test (`packages/board/test/unit/agent-list.test.ts:1410`, *"isCollapsible — an empty group hides nothing"*) to describe that baseline.
- **Empty groups render.** Today `AgentList.tsx:1711` filters `group.count > 0`, so an empty group does not render at all. Render an empty group inside an open section as its label, "— none" and the group's hint.
- **Three empty kinds, as a domain property.** Each section's empty kind and sentence come from a view function beside `delivery-view.ts` (`packages/board/src/app/lib/agent-rows/delivery-view.ts`) or a domain rule, with a unit test per kind:

  | Section | Empty kind and sentence |
  |---|---|
  | Release delivery | clear: "No approved plan belongs to a release or sprint yet." |
  | You | clear: "Nothing waits on you."; unread (amber) when the issue or ticket read failed, with Retry |
  | Work items | clear: "No work item is at a gate, being built or queued." |
  | Fleet | stopped (grey) when the fleet is not running; "no agents" when it runs with 0 |
  | Machine | "no reading" when no process has recorded a limit |
  | Tickets | clear: "No ticket waits for a plan."; unread (amber) when the issue read failed, with its note; unsupported (grey) when the tracker cannot be read, with its absence sentence |

  The three kinds are clear (green ✓, nothing to do), unread (amber !, a reading failed, with Retry) and stopped (grey ■, a source that does not run or cannot be read). Tickets' unsupported is the stopped kind. Tickets' states come from the domain's `ticketsSection` (`packages/domain/src/rules/tickets-section.ts:57`, `state: 'rows' | 'failed' | 'unsupported' | 'unasked'`).
- **Every rendered state is a domain property** (CLAUDE.md). The fold control's presence, the empty kind and its sentence are view or domain properties with unit tests; browser tests only prove they are seen. Moving assertions into unit tests updates `packages/board/test/integration/stubbed-tests-start-no-board.test.ts`, which pins the browser test count, with the reason, as #3575 did.
- **No hidden UI.** The fold button shows on every section, also when empty. Retry shows on every unread frame.
- **Reduced motion.** The chevron's rotation has a `prefers-reduced-motion` alternative: it switches without animation.

### Open Questions

- [ ] Which empty kind does Tickets' `unasked` state take ("the tracker has not been read yet", `TicketsSection.tsx:82`)? The spec names clear, unread and unsupported only. Suggestion: unread without Retry, because no read has failed. Builder's call unless the reviewer decides.
- [ ] Tickets already holds an inner fold, `… n more · show` (`foldLabel`, `tickets-section.ts`). It stays; this plan adds the section fold beside it. Confirm.

## Slices

### Fold

- `feature/every-delivery-section-folds` — the shared section frame with a 28 px fold button and a toggling header row on all seven sections, Tickets and Not placed keys in `collapse.ts`, the `isCollapsible` comment and test rewritten for sections, empty groups rendered as "— none" with their hint, and the empty kind and sentence per section as view properties with unit tests <!-- builds: sectionEmptyKind, the empty kind and sentence of each Delivery section -->

## Notes

- Created by `/plot-idea` in one batch with the other six plans of the sprint "Delivery UI Polish". Type `feature` came from the brief; the design question was answered no, because the design spec already exists outside the repository, so the plan starts in Draft.
- Plan 3 (`folded-sections-summarise-visually`) waits on `feature/every-delivery-section-folds`.
- `docs/plans/2026-11-19-release-delivery-folds-to-its-header.md` added the Release delivery fold with the key `release-delivery`; this plan keeps that key and extends the same fold to the other sections.
