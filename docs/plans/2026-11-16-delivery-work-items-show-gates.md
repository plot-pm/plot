# Delivery tab: Work items show their gates

> The Work items section groups items in flight as At a gate, Being built and Queued, shows each group's own column — gates as ✓ ⟳ ✗, progress, or what a queued item waits on — and names the agent on each item with its role chip.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:**
- **Story:** delivery-tab-reads-at-a-glance
- **Review:** pr
- **Impl:** own branches

## Changelog

- The **Work items** header counts items at a gate, being built and queued, and names how long the oldest one waits.
- An item at a gate shows each gate as ✓, ⟳ or ✗, each linked to its run or review (`CI ✗ validate · review –`).
- An item being built shows its progress (`4 commits · no PR yet`); a queued item shows what it waits on (`no agent assigned`, or the earlier slice).
- The **By** column shows the agent's role chip and name, linked to its Fleet row; a fixer adds its attempt ("1/2").

Board impact: changes the Work items section's rows in `packages/board`; no change to the plan format, the template, the helper scripts or the `docs/plans` layout. Rebuild the board artifact (`pnpm build:board`) with each slice that changes the board.

## Motivation

Plan 3 of 6 of the [Delivery tab reads at a glance design](../superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md), approved by Jan Wloka on 2026-11-16, story [delivery-tab-reads-at-a-glance](../stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md). Measured on the running board that day: one column holds "complete", "merged", "waiting on approval" and "2 complete", and no column carries a header.

The design is canonical. This plan implements its *Work Items* section and the *Calls Made After Review* points listed below. It does not restate them.

## Design

### Approach

Depends on plan 1, `delivery-tab-header-and-my-sprint`, for the section-header pattern; every slice waits on its `feature/delivery-section-header` slice.

- **Header.** "<n> at a gate · <n> being built · <n> queued · oldest waits <age>", each count linking to its group.
- **Groups:** At a gate · Being built · Queued.
- **Columns:** Kind · Item · Where · (group column) · By · Age. The group column is **Gates** for At a gate, **Progress** for Being built and **Waits on** for Queued. One column holds one kind of value.
- **Gates.** Each gate (CI, review) is ✓, ⟳ or ✗, and links to its run or review. A slice PR is a gate here unless plan 2's PR rule places it under You › Blocks delivery (*Calls Made After Review*, "A PR blocks delivery; no PR is an input").
- **Item** is the plan § slice, linked. **Where** is the PR, with the branch beneath it, written in full. **By** is the agent's role chip and name, linked to its Fleet row; a fixer adds its attempt ("1/2"). The role chips are the ones plan 4 shows in Fleet; this plan adds them to the row form in `packages/domain/src/rules/delivery-row-form.ts`.
- **A slice that has not started** (no branch, no agent) is not a row here; it shows only in its plan's opened list under Release delivery (plan 5).
- **A closed PR or branch no plan names** moves to You › Unblock (plan 2), not Queued.
- **Scope.** Mine narrows Work items; the **My sprint** scope from plan 1 applies here too (*Calls Made After Review*, "One scope rule for every section").
- **Domain first.** Every gate state, link target, progress value and waits-on value is a domain property with a unit test.

### Done When

- Every group in Work items shows its own column under a header, and no column holds two kinds of value.
- An item at a gate shows one glyph per gate, each linked to its run or review, asserted in a unit test.
- A fixer row in By shows its attempt against the `Correction budget`.
- No slice without a branch or an agent shows as a Work items row.

### Settled Questions

- Every slice waits on plan 1's `feature/delivery-section-header`. Writer's call, from the design: plan 1 lays the section-header pattern every later plan uses.

### Open Questions

- [ ] Which glyph in `glyphs.ts` stands for a gate nobody has asked yet ("review –")?

### Left to the Builder

- The names of the new domain facts and their types, within the domain's terminology.
- Which existing browser tests move to unit tests.

## Slices

### Group columns

- `feature/delivery-work-items-gates` <!-- waits: feature/delivery-section-header --> — the Work items header and groups, the per-group column (Gates as ✓ ⟳ ✗ with links, Progress, Waits on), and not-started slices out of the rows <!-- builds: Work items gate, progress and waits-on cells -->

### Agent chips

- `feature/delivery-work-items-by-chips` <!-- waits: feature/delivery-section-header --> — the By column with the agent's role chip, name and Fleet link, and a fixer's attempt count <!-- builds: a By cell with role chip and fixer attempt -->

## Notes

- Created by `/plot-idea` in one batch with plans 1, 2 and 4 to 6 of the same design. Type `feature` came from the brief; the design question was answered with the default, no, so the plan starts in Draft.
- Deliverable search for "gate glyphs" and "agent role chip" found no artifact of that name in the estate.
