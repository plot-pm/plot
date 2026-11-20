# The Delivery tab has one header in five groups

> One header card in five groups (Release, You, Work items, Fleet, Machine) replaces the to-do list, the release or sprint card and the fleet card, never folds, follows the scope selector, and keeps the release button in a fixed slot that looks disabled when it cannot run.

## Status

- **State:** Draft
- **Type:** feature
- **Review:** pr
- **Impl:** own branches

## Changelog

- The Delivery tab has one header card in five groups: Release, You, Work items, Fleet and Machine. It replaces the to-do list, the release or sprint card and the fleet card, and it never folds.
- The Release group summarises every active sprint in one bar, one legend, one status line and one release button, and names how many sprints and people it covers. Under the My sprint scope it shows the reader's sprint in the same frame.
- The release button keeps its place whatever the text or state. When it cannot run it shows a dashed outline and its reason as the status line.
- The Fleet group shows the automation switches' state read-only, as ✓ on or – off; the real switches stay in the Fleet section.

<!-- Board impact: the Delivery tab only (packages/board, packages/domain). No plan format, template, helper script or docs/plans layout changes. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. -->

## Motivation

Plan 4 of 7 of the sprint "Delivery UI Polish". The approved design spec is `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md` (outside this repository), with mockups in `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish/`; `header-and-sections-v2.html` (top) is the reference. The spec is canonical for everything this plan does not restate.

Today the tab header holds three widgets, `TodoList`, `ReleaseCard` or `SprintCard`, and `FleetCard` (`packages/board/src/app/components/AgentList.tsx:1537-1552`), and the sections below show the same subjects again. The release card dims "Approve release" when no release PR exists, and the fleet card shows read-only copies of the fleet switches; the spec names both as controls that look usable and are not. This plan implements goal 1, goal 12 for the release button, and the spec's *Header* section. It uses plan 1's tuples.

## Design

### Approach

- **One card, five groups, never folded,** separated by vertical rules:

  | Group | Shows | Action |
  |---|---|---|
  | Release | release tuple (tag), scope line ("all sprints · 3 people"), segment bar (delivered / at gates / blocked / not started), legend with numbers, status line ("Release PR #N ready · waits on you 43 min") | the release button, in a fixed slot at the group's bottom right |
  | You | three large numbers: blocks delivery (red), input (amber), unblock (grey); below: oldest wait and the linked ticket triage count, which jumps to `#tickets` | "open ›" jumps to the section |
  | Work items | at a gate / being built / queued as numbers; oldest wait | "open ›" |
  | Fleet | agent circles coloured by state, "N working · M free"; marks (✓ on / – off) for dispatch, review, verify, design | "open ›" |
  | Machine | small meters for load, GraphQL, REST | "open ›" |

- **The Release group summarises every active sprint** (operator decision). One bar, one legend, one status line and one action slot over the plans of every active sprint, with the scope line naming how many sprints and people it covers. Where active sprints name different `Release:` versions, the group title lists them ("2.36.0 · 2.37.0") over one combined bar, and the action slot holds the release PR that is ready, if any.
- **The scope selector focuses the header** (operator decision). `DeliveryScopeKind` (`packages/domain/src/rules/delivery-scope.ts:8`) is `release` or `my-sprint`. In `release` scope the header summarises every active sprint. In `my-sprint` scope every group counts only the reader's sprint, and the Release group shows that sprint as `SprintCard` does today (title, bar, owner), in the same frame, with the action slot in the same place. The header names its scope ("all sprints · 3 people" or "my sprint · <title>"). **The Mine filter does not change the header** (spec call); only the scope selector does.
- **No release targeted.** The group keeps its size: grey bar, "No release targeted · last vX.Y.Z <date>", and the button in the same slot, drawn disabled with a dashed outline (not a dimmed fill), its reason as the status line. The reason comes from `releaseCardApprovable` (`packages/domain/src/rules/release-card.ts:209`) and `NO_RELEASE_TARGETED` (`release-card.ts:37`).
- **Fixed release slot.** The release button keeps its position whatever the text length or state (goal 12).
- **The release action is unchanged.** The button calls the existing release approval with passkey; no controller and no refusal changes (spec non-goal).
- **Fleet marks, not switches.** The header's Fleet group shows the switches' state read-only as marks. The real switches stay in the open Fleet section (`AgentList.tsx:1624-1628`); `FleetCard`'s read-only copy (`packages/board/src/app/components/FleetCard.tsx:3`, imports from `FleetControls.tsx`) leaves with `FleetCard`. Plan 5's Fleet slice moves the real switches into the section body and waits on this plan.
- **Domain properties, extending what exists.** The groups extend `todoList` (`packages/domain/src/rules/todo-list.ts:103`), `releaseCards` (`packages/domain/src/rules/release-card.ts:117`), `sprintCards` (`packages/domain/src/rules/sprint-card.ts:154`), `fleetCard` (`packages/domain/src/rules/fleet-card.ts:24`) and `machineHealth`. Each number, colour, mark, scope line and disabled reason is a domain or view property with a unit test. New domain code is arrow functions with factual TSDoc.
- **No new data sources.** Machine meters read `load1` of `cores` and the host rate-limit buckets of `FleetMachineSchema` (`packages/board/src/contract/schema.ts:4475-4481`) only.
- **Link tuples.** Every artifact the header names (release, sprint, PR, ticket count link) is a plan 1 tuple.
- **Layout.** `packages/board/src/app/styles/delivery-header.css` lays out the header today and changes with it.
- **Board tests.** Moving assertions into unit tests updates `stubbed-tests-start-no-board.test.ts` with the reason.

### Open Questions

- [ ] Several active sprints each have a ready release PR: which one does the action slot hold? The spec leaves the order to the builder.
- [ ] Do the header groups wrap to two rows on a narrow width, or stack? The spec leaves this to the builder.

## Slices

### Header

- `feature/delivery-tab-has-one-header` <!-- waits: feature/delivery-tuples-in-every-row --> — the five-group header from domain properties replacing `TodoList`, `ReleaseCard`/`SprintCard` and `FleetCard`, the Release group over every active sprint and under My sprint, the fixed release slot with a dashed disabled state and its reason, and the read-only Fleet marks <!-- builds: deliveryHeader, the five-group Delivery tab header -->

## Notes

- Created by `/plot-idea` in one batch with the other six plans of the sprint "Delivery UI Polish". Type `feature` came from the brief; the design question was answered no, because the design spec already exists outside the repository, so the plan starts in Draft.
- Waits on plan 1's slice `feature/delivery-tuples-in-every-row`, named in the `waits:` marker.
- Plan 5's slice `feature/fleet-switches-in-fleet-section` waits on this plan's slice, because this plan removes `FleetCard` and its read-only switches.
