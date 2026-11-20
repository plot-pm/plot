# The Delivery tab has one header in five groups

> One header card in five groups (Release, You, Work items, Fleet, Machine) replaces the to-do list, the release or sprint card and the fleet card, never folds, follows the scope selector and not the Mine filter, names its unread and stopped states, and keeps the release button in a fixed slot that looks disabled when it cannot run.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-ui-polish
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2

## Changelog

- The Delivery tab has one header card in five groups: Release, You, Work items, Fleet and Machine. It replaces the to-do list, the release or sprint card and the fleet card, and it never folds. Its numbers follow the scope selector and do not change with the Mine filter.
- The Release group summarises every active sprint in one five-state bar, one legend, one status line and one release button, and names how many sprints and people it covers. Under the My sprint scope it shows the reader's sprints in the same frame, all of them where the reader owns several.
- The release button keeps its place whatever the text or state. When it cannot run it shows a dashed outline and its reason as the status line. With no release targeted the group says which version shipped last and when.
- Each "open ›" link and the ticket triage link open their section before they scroll.
- A group whose reading failed or whose source is stopped says so, with the age of the last good reading where one exists, and never shows a zero instead.
- The Fleet group shows the automation switches' state read-only, as ✓ on or – off, and the parallel-agents value; the real switches stay in the Fleet section.

<!-- Board impact: the Delivery tab only (packages/board, packages/domain). One new payload field, `lastRelease`, built server-side from the plan files the server already reads. No plan format, template, helper script or docs/plans layout changes. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. -->

## Motivation

Plan 4 of 7 of the sprint "Delivery UI Polish". The approved design spec is `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md` (outside this repository), with mockups in `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish/`; `header-and-sections-v2.html` (top) is the reference. The spec is canonical for everything this plan does not restate.

Today the tab header holds three widgets, `TodoList`, `ReleaseCard` or `SprintCard`, and `FleetCard` (`packages/board/src/app/components/AgentList.tsx:1537-1552`), and the sections below show the same subjects again. The release card dims "Approve release" when no release PR exists, and the fleet card shows read-only copies of the fleet switches; the spec names both as controls that look usable and are not. This plan implements goal 1, goal 12 for the release button, and the spec's *Header* section. It uses plan 1's tuples and plan 2's reachability rule.

## Design

### Approach

**Shared rules for both slices:**

- **One card, five groups, never folded,** separated by vertical rules:

  | Group | Shows | Action |
  |---|---|---|
  | Release | release tuple (tag), scope line ("all sprints · 3 people"), segment bar with the five `SLICE_STATES` (delivered / blocked / at a gate / being built / not started), legend with numbers, status line ("Release PR #N ready") | the release button, in a fixed slot at the group's bottom right |
  | You | three large numbers: blocks delivery (red), input (amber), unblock (grey); below: oldest wait and the linked ticket triage count, which jumps to `#tickets` | "open ›" jumps to the section |
  | Work items | at a gate / being built / queued as numbers; oldest wait | "open ›" |
  | Fleet | agent circles coloured by state, "N working · M free"; marks (✓ on / – off) for dispatch, review, verify, design; the parallel-agents value as a number | "open ›" |
  | Machine | small meters for load, GraphQL, REST | "open ›" |

- **Five bar states.** The bar and its legend keep the five segments of `SLICE_STATES` (`packages/domain/src/rules/slice-states.ts:9`), `being-built` included, as every bar `releaseCards` and `sprintCards` build today (`packages/domain/src/rules/release-card.ts:53-54,146`, `packages/domain/src/rules/sprint-card.ts:73-74`). A unit test asserts that the combined bar's segment sums equal the sum of the per-sprint bars.
- **The header reads Mine mode `all`.** Today `TodoList` and `FleetCard` read the Mine-filtered placement (`AgentList.tsx:1170-1195`, `packages/board/src/app/lib/agent-rows/delivery-readings.ts:461-465`); only `releaseCards` reads mode `all` (`release-card.ts:113`). The You, Work items and Fleet groups read a placement built with the Mine mode `off` (`DeliveryMine`, `packages/domain/src/rules/delivery-placement.ts:32`) under the scope's selection. A unit test asserts that `deliveryHeader` returns equal facts for Mine `off`, `mine` and `strict` over one fixture, and different facts for the `release` and `my-sprint` scopes. The folded section summaries of plan 3 follow Mine, so a header number and a section chip can differ by design; a unit test asserts that they agree under Mine `off`.
- **The scope selector focuses the header** (operator decisions). `DeliveryScopeKind` (`packages/domain/src/rules/delivery-scope.ts:8`) is `release` or `my-sprint`. The scope narrows the Release, You and Work items groups. Fleet and Machine show the whole machine in both scopes, because free agents, load and rate limits belong to no sprint. In `release` scope the header summarises every active sprint, and the scope line reads "all sprints · <n> people".
- **My sprint with several sprints** (operator decision, 2026-11-20). In `my-sprint` scope the header combines every active sprint the reader owns, as `deliveryScope` already selects (`delivery-scope.ts:56-61`). The scope line names them: "my sprint · <a>" for one, "my sprints · <a>, <b>" for several. The Release group shows them as `SprintCard` does today (titles, one combined bar, owner) in the same frame, and keeps `SprintCard`'s warning for an Owner that People does not declare (`unknownOwners`, `packages/board/src/app/components/SprintCard.tsx:51-55`). The action slot holds the release PR that the reader's sprints' `Release:` versions bind, or the disabled button with `unboundReason` (`release-card.ts:154,197`).
- **Unread and stopped in the header.** Each group names its unread or stopped form as a domain property, in plan 2's three kinds (clear, unread, stopped), with a unit test each:
  - Release: where any sprint in scope has no merge answer (`readingMissing`, `release-card.ts:56,148`), the bar is grey and the status line is `RELEASE_READING_MISSING` (`release-card.ts:40`); the combined bar never shows a partial count. No payload field records when the merge reading was last good, so the line shows the failure only.
  - You: where the triage count is `null` (`todoList`, `packages/domain/src/rules/todo-list.ts:99`), the clause reads "tickets unread" and never 0, followed by the age of the last good rows from `issueAgeSeconds` (`packages/board/src/contract/schema.ts:4895`) through `issueNote` (`packages/board/src/app/lib/agent-rows/host-notes.ts:419`) where that field is not `null`.
  - Fleet: `supervisorVerdict` (`packages/domain/src/rules/supervisor-reading.ts:388`) decides. `down` and `died` read "fleet stopped" and `unknown` reads "fleet state unknown", with the marks still shown. A stopped fleet never reads as `idle` with zeros (`fleetCard`, `packages/domain/src/rules/fleet-card.ts:24-31`).
  - Machine: a meter whose `load1`, `cores` or bucket is `null` (`FleetMachineSchema`, `schema.ts:4475-4481`) reads `machineHealth`'s word "not measured" (`packages/domain/src/rules/machine-health.ts:92`).
- **Retry is dropped** (operator decision, 2026-11-20). No group offers Retry; an unread group shows the time of the last good reading where the payload carries one, as above.
- **Every jump opens its section first.** "open ›" and the triage link use plan 2's reachability rule: the jump opens the target section and persists the open state before it scrolls. Targets: the section anchors `delivery-section-<key>` that plan 2 adds, and `#tickets` (`TICKETS_ANCHOR`, `packages/board/src/app/components/TicketsSection.tsx:55`). The first slice waits on plan 2's `feature/every-delivery-section-folds`.
- **Link tuples.** Every artifact the header names (release, sprint, PR, ticket count link) is a plan 1 tuple.
- **Domain properties, extending what exists.** The groups extend `todoList` (`todo-list.ts:103`), `releaseCards` (`release-card.ts:117`), `sprintCards` (`sprint-card.ts:154`), `fleetCard` (`fleet-card.ts:24`) and `machineHealth` (`machine-health.ts:216`). Inputs that exist and are reused: oldest wait from `oldestWaitsClause` and `oldestAgeMinutes` (`packages/domain/src/rules/delivery-work-columns.ts:60,66`); the Work items numbers from the groups `at-a-gate`, `being-built` and `queued` (`delivery-placement.ts:15`); the Machine labels from `machineHealth`'s buckets `graphql` → GraphQL and `core` → REST (`machine-health.ts:103-104`); the fleet circles from `fleetCard`'s `free`, `working` and `blocked`. Each number, colour, mark, scope line, unread form and disabled reason is a domain or view property with a unit test. The words `STATE_WORDS` (`packages/board/src/app/components/FleetCard.tsx:14-18`) and `SEGMENT_WORD`/`SEGMENT_CLASS` (`SprintCard.tsx`, imported by `ReleaseCard.tsx:5`, `ReleasePersonCards.tsx:2` and `ReleasePlanParts.tsx:5`) move into the domain view or a shared module that the remaining importers read; no new `.tsx` word map is added. New domain code is arrow functions with factual TSDoc.
- **No new external queries.** The header reads only fields the payload carries, plus one new field the server builds from files it already reads:

  | Field | Source |
  |---|---|
  | release cards, bars, `readingMissing`, `unboundReason` | `releaseCards`, `sprintCards` over the payload's cards and release rows |
  | You and Work items numbers, oldest wait | the placement in Mine mode `off` under the scope |
  | triage count | `todoList`'s triage count; `issueAnswer`, `issueError`, `issueAgeSeconds` |
  | fleet circles and marks, parallel agents | `fleetCard`; the fleet controls reading `FleetCard` reads today (`FleetCard.tsx:59`) |
  | supervisor state | `fleet.supervisor` through `supervisorVerdict` |
  | Machine meters | `load1`, `cores` and the host buckets of `FleetMachineSchema` (`schema.ts:4475-4481`) |
  | last release | the new `lastRelease` field, below |

**Slice 1, the frame and four groups:**

- **Frame, You, Work items, Fleet, Machine.** The header card and the You, Work items, Fleet and Machine groups replace `TodoList` and `FleetCard`. `TodoList` leaves with its jumps; `reasonVerb` (`packages/domain/src/rules/delivery-row-form.ts:239`) keeps its other callers.
- **Fleet marks, not switches.** The header's Fleet group shows the switches' state read-only as marks, and the parallel-agents value as a number beside them. The real switches stay in the open Fleet section (`AgentList.tsx:1624-1628`). `FleetCard`'s read-only copy (`FleetCard.tsx:3`, imports from `FleetControls.tsx`) leaves with `FleetCard`, and so do the `readOnly` branches of `AutoDispatchSwitch`, `AutoSwitch` and `ParallelAgentsStepper` (`packages/board/src/app/components/FleetControls.tsx:79-115`), whose only caller is `FleetCard`. Plan 5's Fleet slice moves the real switches into the section body and waits on this slice.

**Slice 2, the Release group:**

- **The Release group summarises every active sprint** (operator decision). One bar, one legend, one status line and one action slot over the plans of every active sprint, with the scope line naming how many sprints and people it covers. Where active sprints name different `Release:` versions, the group title lists them ("2.36.0 · 2.37.0") over one combined bar. `releaseCards` builds one card per version today (`release-card.ts:93-117`); the combined group is a new shape over those cards, with its own unit tests beside `packages/domain/test/release-card.test.ts`. It replaces `ReleaseCard` and `SprintCard`.
- **Release approval stays in the header only** (operator decision, 2026-11-20). The release button in this group is the one place a release is approved. No You row offers "Approve release", and `placeDelivery` keeps sending release items to `releases` and to no section (`delivery-placement.ts:434-437`).
- **The status line is one domain function.** `releaseStatusLine(group, prReading, passkey, now)` returns the text and the button state. Today the choice is made inside `ReleaseApprove.tsx:16-24`, from a passkey `useEffect`. Unit tests: ready; disabled with each `releaseApprovable` reason; passkey unread; no release targeted. The line reads "Release PR #N ready" with no wait time: no payload field records when the release PR became ready (`ReleasePrReading`, `packages/domain/src/rules/release-approvable.ts:13-20`), and the release row's `updatedAt` (`schema.ts:2958`) is the PR's last update, not its ready time.
- **The release action is unchanged.** `ReleaseApprove` (`ReleaseCard.tsx:4`) is reused unchanged in the slot. It calls the existing release approval with passkey; no controller and no refusal changes (spec non-goal).
- **Fixed release slot.** The release button keeps its position whatever the text length or state (goal 12).
- **No release targeted · last vX.Y.Z <date>** (operator decision, 2026-11-20). The group keeps its size: grey bar, "No release targeted · last vX.Y.Z <date>", and the button in the same slot, drawn disabled with a dashed outline (not a dimmed fill), its reason as the status line. The reason comes from `releaseCardApprovable` (`release-card.ts:209-214`) and `NO_RELEASE_TARGETED` (`release-card.ts:37`).
- **The new `lastRelease` field.** The board payload gains `lastRelease: { tag, date } | null`, with a schema default of `null`. The server builds it in `board.ts` from every plan's `Released: <date>, vX.Y.Z` record (`meta.released_raw`, which `phaseDateOf` already reads, `packages/board/src/server/board.ts:1609-1612`). Those records hold the tag and date that the release entry points read from git through the `Refs` port, `tagsContaining` and `tagDate` (`packages/domain/src/ports/refs.ts:881,889`, called at `packages/board/src/server/entry/deliver.ts:950,962`). The payload path itself reads no tag today, and the field adds no tag read and no tracker query. A domain rule `lastRelease(records)` picks the highest version, with unit tests: no Released plan gives `null` and the clause reads "No release targeted" alone; two releases on one day; an unparseable record is skipped. A server test asserts the field over a fixture with two Released plans.

**Both slices:**

- **Layout.** `packages/board/src/app/styles/delivery-header.css` lays out the header today and changes with it.
- **Board tests.** Each browser assertion of a decision moves to a unit test of `deliveryHeader` or `releaseStatusLine`; each file keeps or gains one browser test that the header renders the fact. The count gate pins `EXPECTED_FILES = 99` and `EXPECTED_TESTS = 719` (`packages/board/test/integration/stubbed-tests-start-no-board.test.ts:569,956`); each slice records its delta and reason there. Files that change:
  - Slice 1: `delivery-tab-header.browser.test.ts:37,48,60,82` (the two-column to-do layout; rewritten for the five-group card); `delivery-fleet-look.browser.test.ts:100` and `fleet-settings.browser.test.ts:330-346` (the fleet card's read-only switches; the assertions move to the Fleet section's real switches, which keep their `aria-valuenow` behaviour); `delivery-tab-sections.browser.test.ts:149-165` (the to-do lines and the triage link); `delivery-tab-screenshots.browser.test.ts:36,48,109` (it reads `--delivery-section` from `[data-tab-header]`, `delivery-header.css:5`); unit tests `packages/board/test/unit/fleet-card.test.ts` (4 `it(`) and `todo-list-markup.test.ts` (3), which render the removed components and are rewritten for the header.
  - Slice 2: `release-approve.browser.test.ts:55-59,61,82,89` (the button through `[data-release-card-version]` and the to-do line; the passkey test moves to the header's release slot unchanged); `delivery-filters.browser.test.ts:128-129` (sprint card against release card per scope); unit test `release-cards-of.test.ts` (5).
  - Browser tests that stay or are added: the release slot's position under two text lengths, the dashed outline on a disabled button (computed `border-style`), and no horizontal scroll at 320 px.

### Open Questions

- [ ] Several active sprints each have a ready release PR: which one does the action slot hold? Proposal: the lowest version first. The status line then names the other ready PRs as tuples ("+1 more ready · [PR …]"), so none is hidden, and the slot moves to the next once the first is approved. Release approval has no other place (operator decision 1), so this needs the operator.
- [ ] Do the header groups wrap to two rows on a narrow width, or stack? The spec leaves this to the builder.

## Slices

### Header

- `feature/delivery-tab-has-one-header` <!-- waits: feature/delivery-tuples-in-every-row, feature/every-delivery-section-folds --> — the header card with the You, Work items, Fleet and Machine groups from domain properties in Mine mode `off`, replacing `TodoList` and `FleetCard` and the `readOnly` switch branches, "open ›" and the triage link through plan 2's reachability rule, the unread and stopped form of each group, and the read-only Fleet marks with the parallel-agents value <!-- builds: deliveryHeader, the Delivery tab header's frame and four groups -->

### Release group

- `feature/delivery-header-release-group` — the Release group over every active sprint and over every sprint the reader owns under My sprint, with the five-state combined bar, the scope line, `releaseStatusLine`, the fixed release slot with a dashed disabled state and its reason, the `lastRelease` payload field, and the removal of `ReleaseCard` and `SprintCard` <!-- builds: releaseStatusLine and lastRelease, the header's Release group -->

## Notes

- Created by `/plot-idea` in one batch with the other six plans of the sprint "Delivery UI Polish". Type `feature` came from the brief; the design question was answered no, because the design spec already exists outside the repository, so the plan starts in Draft.
- Panel round 1 (2026-11-20, unanimous `amend`) split the plan into two slices, as the testability lens proposed: the frame with four groups, which plan 5's Fleet slice waits on, and the Release group, which carries the largest test set.
- The first slice waits on plan 1's `feature/delivery-tuples-in-every-row` and on plan 2's `feature/every-delivery-section-folds` (the reachability rule), named in the `waits:` marker.
- Plan 5's `feature/fleet-switches-in-fleet-section` waits on `feature/delivery-tab-has-one-header`, because that slice removes `FleetCard` and its read-only switches. Plan 6 waits on the same slice for the Fleet group label.
- The spec's mockup legend (`header-and-sections-v2.html:129`) shows four bar states; the bar keeps five, because `SLICE_STATES` has five and dropping `being-built` would lose or miscount slices.
- The parallel-agents value stays in the header as a read-only number, because `FleetCard` shows it today (`FleetCard.tsx:59`) and spec goal 10 names it among the switches.
