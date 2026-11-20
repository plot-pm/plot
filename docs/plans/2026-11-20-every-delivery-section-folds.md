# Every Delivery section folds and says why it is empty

> Every section of the Delivery tab has a 28 px fold button and a header row that toggles, also when the section is empty, every jump opens its target section before it scrolls, and an open section with no rows shows a dashed frame with one sentence of kind clear, unread or stopped that names the scope and what the filter hides.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-ui-polish
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2

## Changelog

- Every Delivery section folds: Release delivery, You, Work items, Fleet, Machine, Tickets and Not placed. Each has a 28 px fold button with a chevron that rotates on open, and a click anywhere else on the header row also toggles it. A click on a link, count or switch in the header row does only what that control does. Each reader's fold is kept in the browser.
- Every link that jumps into a section opens that section and its group first, then scrolls: the header's "open ›" links, the count, summary and phase-strip links, row anchors, the triage link and the "turn on ›" link to the fleet switches.
- An empty section still folds. Open, it shows a dashed frame with one sentence: green ✓ when nothing waits, amber ! when a reading failed, with the age of the last good reading where one exists, grey ■ when the source is stopped or cannot be read. Where the scope or the Mine filter hides rows, the sentence says so and gives the hidden count.
- An empty group inside an open section that holds rows shows its label, "— none" and its hint, so the section keeps its structure.

<!-- Board impact: the Delivery tab only (packages/board, packages/domain). No plan format, template, helper script or docs/plans layout changes. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. -->

## Motivation

Plan 2 of 7 of the sprint "Delivery UI Polish". The approved design spec is `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md` (outside this repository), with mockups in `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish/`; `header-and-sections-v2.html` is the reference. The spec is canonical for everything this plan does not restate.

Today only some sections fold, and an empty section looks like a folded one or like a failed reading. The spec's anti-goal is direct: *"Could not read" that looks like "empty", or empty that looks like folded.* This plan implements goals 2 and 4, the shared section frame and the reachability rule. Plans 3 and 4 wait on its first slice; plan 1 can run in parallel.

## Design

### Approach

**Slice 1, the frame and the reachability rule:**

- **Reachability rule (first, because a fold changes what every other control can reach).** A jump to an anchor inside a folded section or group opens that section and group, persists the open state through `writeCollapsed` (`packages/board/src/app/lib/agent-rows/collapse.ts:82`), and then scrolls once the anchor is mounted. Today only `jumpToReleasePlan` (`packages/board/src/app/components/AgentList.tsx:527-535`) does this, and `scrollToAnchor` (`packages/board/src/app/components/DeliveryRows.tsx:20-22`) returns without effect for an anchor that is not mounted. This slice generalises `jumpToReleasePlan` into one jump that every control uses: the You count links (`AgentList.tsx:1575`), the phase-strip links (`:1588`), the summary links (`:1605`), the held-switch "turn on ›" link to `#fleet-controls` (`:1738`), row anchor links into another section (`DeliveryRows.tsx:42-48`), the TodoList jumps until plan 4 removes `TodoList`, plan 3's summary chips, and plan 4's "open ›" and triage links.
- **The anchor-to-section mapping is a view property.** `anchorOwner(anchor, view)` in `delivery-view.ts` (`packages/board/src/app/lib/agent-rows/delivery-view.ts`) returns `{ section, group | null }` or `null` for an anchor no section owns. It covers new section anchors `delivery-section-<key>` (sections carry no id today, `AgentList.tsx:1636`), group anchors (`groupAnchor`, `delivery-view.ts:277`), item anchors (`itemAnchor`, `delivery-view.ts:384`, resolved through the view's placement), `#tickets` (`TICKETS_ANCHOR`, `packages/board/src/app/components/TicketsSection.tsx:55`), `#fleet-controls` (`AgentList.tsx:1623`) and the Not placed section. A unit test covers each section and each anchor kind; a `null` answer scrolls only.
- **The shared frame.** Every section header row holds a 28 px fold button (chevron rotates on open), the section title and the summary slot, on one line. The 28 px button is the one element with `aria-expanded` and the accessible name. The row click is a pointer shortcut and carries no `role="button"`; this replaces the `role="button"` wrapper `releaseFold` puts around interactive children today (`AgentList.tsx:1514-1528`). A section has three states: folded (one line), open (groups and rows), and open-but-empty (dashed frame, one sentence).
- **Header controls stop propagation.** Every control inside a toggling header row stops click and key propagation, as `ReleaseHeaderCounts` does (`packages/board/src/app/components/ReleasePlanParts.tsx:73-77`): the You count and phase-strip links, the summary links, and the Fleet switches and stepper (`AgentList.tsx:1622-1629`). A browser test proves that a click on a header switch or count leaves `aria-expanded` unchanged.
- **One fold rule, as a view property.** `isFoldable(level, rowCount)` and `isFolded(level, key, rowCount, collapsed, always)` in `collapse.ts` replace the inline decisions in `fold` and `releaseFold` (`AgentList.tsx:1480-1532`); both call them. Unit tests: an empty section is foldable; an empty group is not; a stored key folds an empty section (today `isFolded` returns false for it, `AgentList.tsx:1481`); the Fleet `working` and `blocked` groups never fold (`fleetOpen`, `AgentList.tsx:1713`).
- **The `isCollapsible` reversal, for sections only.** `isCollapsible(rowCount) => rowCount > 0` (`collapse.ts:107`) makes an empty group unfoldable, because folding would hide the group's hint. For **sections** that is replaced: every section folds, also when empty, and the folded header carries the explanation the hint carried (plan 3 draws it as the summary; this plan carries the empty kind's mark there until then). **Groups** inside an open section never fold when empty. Update the comment above `isCollapsible` (`collapse.ts:93-106`) and its test (`packages/board/test/unit/agent-list.test.ts:1410`, *"isCollapsible — an empty group hides nothing"*) to describe that baseline.
- **A folded section renders its header line only.** Today `WorkingCounts` and `FleetAlert` (`AgentList.tsx:1701-1706`) and `MachineSection` (`:1710`) render with no fold guard. They become fold content: `WorkingCounts` and `MachineSection` render only while open. A `FleetAlert` at prominence `alert` stays visible while Fleet is folded, in the summary slot, because that sentence is the one a person missed for an hour (`packages/board/src/app/components/FleetControls.tsx:400-403`). A browser test proves that a folded Machine section renders no `MachineSection`.
- **Seven sections.** The five of `DELIVERY_LAYOUT` (`packages/domain/src/rules/delivery-placement.ts:12-18`: `release-delivery`, `you`, `work-items`, `fleet`, `machine`) and the two the tab renders after them: *Not placed — agent branches* (`AgentList.tsx:1768`) and Tickets (`TicketsSectionView`, rendered at `AgentList.tsx:1792`, anchor `#tickets`). Tickets keeps its `#tickets` anchor on the `<section>`, so the anchor survives a fold.
- **Not placed has one control.** Today the section renders only when `view.notPlaced.length > 0 && showUnplaced` (`AgentList.tsx:1768`), where `showUnplaced` is session state (`:684`) that the footer's "details" button toggles (`:1858-1869`, `data-unplaced-toggle`). The section fold becomes its one control: `showUnplaced` is removed, the footer's "details" becomes a jump that opens the section through the reachability rule, the section takes the title "Not placed — agent branches" and the key `not-placed`, and it starts folded, so its default matches today's hidden one. It renders only when it has rows.
- **Fold state per reader.** Folds persist in `localStorage` through `collapse.ts` (`readCollapsed`, `writeCollapsed`, `collapse.ts:56,82`). `KNOWN_KEYS` (`collapse.ts:6`) derives from `DELIVERY_LAYOUT`; add the keys `tickets` and `not-placed`. `COLLAPSED_BY_DEFAULT` (`collapse.ts:17`) becomes `['free', 'not-placed']`, so every other section starts open.
- **Section toggles take their own attribute.** A section toggle carries `data-section-toggle="<key>"`; groups keep `data-group-toggle`, so group selectors in tests stay unambiguous.
- **Reduced motion.** The chevron's rotation has a `prefers-reduced-motion` alternative: it switches without animation.

**Slice 2, the empty kinds:**

- **Three empty kinds, as one view property.** `sectionEmptyKind(input): SectionEmpty | null` beside `delivery-view.ts` returns `null` for a section with rows, and otherwise `{ kind: 'clear' | 'unread' | 'stopped', sentence, note | null, hidden | null }`. The three kinds are clear (green ✓, nothing to do), unread (amber !, a reading failed) and stopped (grey ■, a source that does not run or cannot be read). It absorbs the one empty-kind decision a `.tsx` file makes today (`TicketsSection.tsx:82`). One unit test per table row, plus the non-empty case:

  | Section | Input | Empty when | Kind and sentence |
  |---|---|---|---|
  | Release delivery | `view.releasePlanCount` | 0 | clear: "No approved plan belongs to a release or sprint yet." |
  | You | `section.count` (`delivery-view.ts:617`), `fleet.issueAnswer` | 0 | clear: "Nothing waits on you."; unread when `issueAnswer` is `failed` |
  | Work items | `section.count` | 0 | clear: "No work item is at a gate, being built or queued." |
  | Fleet | `supervisorVerdict` (`packages/domain/src/rules/supervisor-reading.ts:388`) over `fleet.supervisor`, agent count | no agent rows | `up` with 0 agents: clear "No agent runs."; `down`: stopped "The fleet is not running."; `died`: stopped with the alert's detail; `unknown`: stopped with the supervisor's `note` wording, never clear |
  | Machine | `machineHealth` (`packages/domain/src/rules/machine-health.ts:216`) headroom | headroom `unmeasured` | stopped, with `machineHealth`'s own word "not measured" (`machine-health.ts:92`) |
  | Tickets | `ticketsSection` state (`packages/domain/src/rules/tickets-section.ts:32,57`) | state `rows` with 0 rows | clear: "No ticket waits for a plan."; `failed`: unread; `unsupported`: stopped with `issueAbsence`; `unasked`: unread with "The tracker has not been read yet." and no failure |
  | Not placed | `view.notPlaced` | never: it renders only with rows | — |

  `SupervisorState` is `'up' | 'down' | 'unknown' | 'died'` (`supervisor-reading.ts:58`); the mapping reads `supervisorVerdict` and adds no field. Machine adds no second "no reading" vocabulary.
- **Retry is dropped; an unread frame shows the last good reading** (operator decision, 2026-11-20). No Retry control exists in `packages/board/src/app`, and no route re-asks the tracker. An unread frame shows the failure through `issueNote` (`packages/board/src/app/lib/agent-rows/host-notes.ts:419`), which appends the age of the last good rows from `issueAgeSeconds` (`packages/board/src/contract/schema.ts:4895`, set at `packages/board/src/server/fleet.ts:9040` from `entry.issueAt`). Where `issueAgeSeconds` is `null`, no earlier reading exists in the payload, and the frame shows the failure (`issueError`) alone.
- **Empty versus hidden: the sentence names the scope and the hidden count.** Where the scope or the Mine filter hides rows, the sentence names the scope and the count that the filter hides ("Nothing waits on you in my sprints · 3 hidden by Mine"), and the frame shows the control that removes the filter (the Mine chip or the scope toggle). Inputs: the scope (`deliveryScope`, `packages/domain/src/rules/delivery-scope.ts:50-61`), the Mine mode and `mineCounts` (`packages/domain/src/rules/mine-mode.ts`), and Tickets' `hidden` count behind *show all* (`tickets-section.ts:65-73`). Release delivery reads Mine mode `all` (`releaseCards`, `packages/domain/src/rules/release-card.ts:113`), so only its scope varies.
- **Mine, per section** (operator decision, 2026-11-20). Mine applies to You, Work items, Fleet and Tickets. Mode `off` shows every row. Mode `mine` shows a row that is assigned to the reader or whose plan is the reader's, by `ownership(..., reader)` with kind `plan` over the plan's assignee, author and approver (`packages/domain/src/rules/ownership.ts:298-305`), and keeps today's rows of unknown owner. Mode `strict` keeps today's narrower rule, `isMineStrict` (`ownership.ts:326`). The modes are `DeliveryMine` (`delivery-placement.ts:32`). Unit test cells, for each of You, Work items, Fleet and Tickets: `release` × {off, mine, strict} and `my-sprint` × {off, mine, strict}, each asserting the empty kind, the sentence and the hidden count. Release delivery has the two scope cells only.
- **My sprint with several sprints** (operator decision, 2026-11-20). Where the reader owns several active sprints, the sections combine all of them, as `deliveryScope` already selects (`delivery-scope.ts:56-61`), and a scope sentence names them ("in my sprints · <a>, <b>").
- **Frame or "— none".** A section with zero rows shows the frame and no group. A section with at least one row shows every group, and an empty group shows its label, "— none" and its hint. Today `AgentList.tsx:1712` filters `group.count > 0`, so an empty group does not render; the hints already exist in `GROUP_LABELS` (`delivery-view.ts:66-76`) and reach the view as `GroupView.hint` (`delivery-view.ts:252`).
- **Fleet keeps its switches when empty.** The switch row stays visible in an open-but-empty Fleet section, above the frame.

**Both slices:**

- **Every rendered state is a domain property** (CLAUDE.md). The fold rule, the anchor owner, the empty kind, its sentence and the hidden count are view or domain properties with unit tests; browser tests only prove they are seen.
- **No hidden UI.** The fold button shows on every section, also when empty.
- **Board tests.** The count gate pins `EXPECTED_FILES = 99` and `EXPECTED_TESTS = 719` (`packages/board/test/integration/stubbed-tests-start-no-board.test.ts:569,956`); each slice records its delta and reason there, as #3575 did. Browser tests the slices re-read: `release-delivery-fold.browser.test.ts:54-66` (the toggle moves to `data-section-toggle` and the glyphs `▾`/`▸` become a rotating chevron), `agents-tab.browser.test.ts:4780` and `spec-run-rows.browser.test.ts:60` (they click every collapsed `[data-group-toggle]`), `row-withholds.browser.test.ts:320,357,362` (they take the first `[data-group-toggle]`), `agents-tab.browser.test.ts:1915` (an empty group has no toggle; stays true), `quiet-kinds-render.browser.test.ts:85,264` and `group-activity.browser.test.ts:134,365` (group selectors, unchanged by the new section attribute). Slice 1 adds the propagation test and the folded-Machine test; slice 2 adds one browser test that the frame and a "— none" group render.

### Open Questions

- [x] Which empty kind does Tickets' `unasked` state take? Answer: unread with the sentence "The tracker has not been read yet." and no failure note, because no read has failed.
- [x] Tickets already holds an inner fold, `… n more · show` (`foldLabel`, `tickets-section.ts`). It stays; the section fold sits beside it.

## Slices

### Fold

- `feature/every-delivery-section-folds` — the reachability rule with `anchorOwner` and one jump for every link into a section, the shared section frame with a 28 px fold button that alone carries `aria-expanded`, header controls that stop propagation, `isFoldable`/`isFolded` for every section and group, fold guards on `WorkingCounts` and `MachineSection` with an `alert`-level `FleetAlert` kept visible, the `tickets` and `not-placed` keys with Not placed folded by default and `showUnplaced` removed, `data-section-toggle`, and the `isCollapsible` comment and test rewritten for sections <!-- builds: anchorOwner and isFoldable, the reachability rule and the section fold rule -->

### Empty kinds

- `feature/delivery-section-empty-kinds` — `sectionEmptyKind` per section with its input, predicate, kind and sentence, the unread frame with `issueNote`'s last-good-reading age and no Retry, the scope and hidden count in the sentence with the Mine cells, empty groups rendered as "— none" with their hint, and the Fleet switch row kept above an empty frame <!-- builds: sectionEmptyKind, the empty kind and sentence of each Delivery section -->

## Notes

- Created by `/plot-idea` in one batch with the other six plans of the sprint "Delivery UI Polish". Type `feature` came from the brief; the design question was answered no, because the design spec already exists outside the repository, so the plan starts in Draft.
- Panel round 1 (2026-11-20, unanimous `amend`) split the plan into two slices, as the testability lens proposed, so that a failure in the empty-kind work does not block plans 3 and 4. Plan 3 waits on both slices, because its folded summary shows the empty kind's mark. Plan 4 waits on `feature/every-delivery-section-folds` for the reachability rule.
- Plan 5's Release unfold, Work items grid and Fleet switches slices wait on this plan: the unfold uses the fold control, the grid places "— none" groups, and the Fleet switch row sits above the empty frame.
- Departures from the mockup `header-and-sections-v2.html`: Release delivery's empty mark is the clear ✓, not the faint `○` (`:174-175`); Machine's unmeasured state is the stopped ■ with "not measured", not a fourth glyph `?` (`:285-286`); the stopped Fleet frame carries no "Start fleet" link (`:261`), because no board controller starts fleetd (`FleetControls.tsx:37` posts only to `/api/fleet-controls`).
- Retry is dropped (operator decision, 2026-11-20): a refetch of the board payload (`load`, `packages/board/src/app/App.tsx:441`) makes the tracker answer nothing new: while a fleet runs, the board reads the `issues.json` that fleetd writes, so a refetch shows the same failure again.
- `docs/plans/2026-11-19-release-delivery-folds-to-its-header.md` added the Release delivery fold with the key `release-delivery`; this plan keeps that key and extends the same fold to the other sections.
