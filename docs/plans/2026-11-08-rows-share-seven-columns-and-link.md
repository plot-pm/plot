# Delivery tab: rows share seven columns and link to their evidence

> The You, Work items and Fleet sections render one-line row forms over `CardFacts` in seven shared columns, each column links to one kind of target, and the row code these forms replace leaves `rows.tsx`.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** ship-2-32-0
- **Issue:** #3245
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3249 merged
- **Started:** 2026-11-10, Jan Wloka, `feature/rows-share-seven-columns-and-link`

## Changelog

- The Delivery tab shows every row in the columns KIND, ITEM, WHERE, STATUS, DO, BY and AGE. Each cell links to its evidence: the plan, the branch, the PR, the CI run, the review or the agent. Pids, manifest counts and desk paths move to a details popover. The four auto switches move to the Fleet header.

Board impact: changes the Delivery tab's row components in `packages/board`; no change to the plan format, the template, the helper scripts or the `docs/plans` layout. The board artifact is rebuilt by `main`.

## Motivation

Plan 2 of 3 of the [Delivery tab design](../superpowers/specs/2026-11-08-delivery-tab-design.md), "Row forms", approved by Jan Wloka on 2026-11-08. Measured on the running board that day: one section list holds five row kinds (PLAN, SLICE, RELEASE, PR, AGENT) with five column shapes, and internals such as "4 manifests, 26 synthesized" and "worker running (pid 99253)" show as content. `rows.tsx` holds 2,959 lines.

The design is canonical. This plan implements its *Columns*, *Links by Row* and *Row Forms* sections and does not restate them.

## Design

### Approach

Depends on plan 1 (Placement), which decides the section of every work item and agent in the domain. This plan renders the rows inside those sections.

- **Domain first.** A row's cell values and link targets are properties on domain objects, so a unit test asserts each without a browser (CLAUDE.md, "Every rendered state is a domain property"). Names of the rule and its types are left to the builder, within the domain's terminology (Slice, Agent, Worker).
- **Two forms over `CardFacts`.** A work-item row (what it is, how far, what is wrong, what to do next) and an agent row (what it acts on, its state, for how long), both one line over the card grammar's five facets (`identity`, `lineage`, `progress`, `next`, `ownership`). A row shows no chip for a fact nobody asked.
- **Seven columns, one order:** KIND, ITEM, WHERE, STATUS, DO, BY, AGE. DO shows under **You** only. A cell holds a value, not a sentence.
- **Links by Row.** Each cell links to the target in the design's table; for example a slice at a gate links ITEM to the plan, WHERE to the branch and PR, STATUS to the CI run or review, and BY to the fixer or reviewer row.
- **Details popover.** Pids, manifest counts, synthesized rows, desk paths and raw branch names beyond the one link move behind it.
- **Fleet header.** Auto-dispatch, auto-review, auto-verify and auto-design move beside the parallel-agents control. A switch writes its config key through a controller. A held group says so in its own header, for example `Queued (3) · auto-dispatch off · start ›`.
- **Removal.** The row code these forms replace in `rows.tsx` is deleted in the same change; no second row path stays beside the new one.
- **Constraints.** No horizontal scroll at 320 px. Browser tests prove only what is seen; behaviour moves to unit tests.

### Settled Questions

- Plan 1, `every-work-item-and-agent-shows` (#3248), lands first: this plan's slice waits on its `feature/delivery-tab-sections` slice. Writer's call, from the design's plan order.
- Where no controller writes an auto switch's config key, building that controller is part of this plan. Writer's call, from the design: a switch writes its key through a controller, never by hand.

### Left to the Builder

- Which existing browser tests move to unit tests.
- How a link scrolls to and highlights its target.

## Slices

### Row forms

- `feature/rows-share-seven-columns-and-link` <!-- waits: feature/delivery-tab-sections --> — domain row forms and link targets for work-item and agent rows, the seven-column rendering with the details popover, the auto switches in the Fleet header, and removal of the replaced row code from `rows.tsx` → #3393

## Notes

- Created from tracker issue #3245 by `/plot-idea`; stops at Draft. The slice list above is one slice and may be split by `/plot-reslice` or at design review, since the design names five parts (forms, columns and links, popover, switches, removal).
- Sibling plans from the same design: 1. Placement, 3. Tickets and loose ends.
- Ruling, 2026-11-12, Jan Wloka: the seven-column row carries everything the plan, slice and branch rows did. Its DO column holds the row menu (Approve, Dispatch, Deliver, Reslice, Implement, Start work, with a refused entry staying focusable and saying why); each group shows a plan head over its slices with the slice fold; the row keeps the change marks, the stuck-state words, the status words of a slice being built and the dispatcher-log button. The rulings of 2026-11-10 in `docs/plans/2026-11-08-every-work-item-and-agent-shows.md` stand, and browser tests that assert those behaviours keep their subject and move to the new DOM.
