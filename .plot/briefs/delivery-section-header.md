## Implementation brief — delivery-tab-header-and-my-sprint (wave 1: Section header)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-tab-header-and-my-sprint.md on main
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-section-header` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is the first slice of the plan and of the six-plan design (`docs/superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md`). Six slices in plans 1 to 6 wait on it: `feature/delivery-fleet-card`, `feature/delivery-tab-todo-list`, `feature/delivery-you-groups`, `feature/delivery-work-items-groups`, `feature/delivery-agent-roles` and `feature/delivery-tickets-section`. It waits on nothing.

### What to build

Today each Delivery section heading is an `<h2>` that shows an emoji, a label and one parenthesised count (`AgentList.tsx:1380-1382`), and each group heading shows its label and either its tally or, for an empty group, its hint (`AgentList.tsx:1431-1435`). Nothing summarises a section's groups in one line, and an empty group still renders a heading. This slice gives every section one header shape: the section's name, its icon from `glyphs.ts`, and one line of counts, each count linking to its group. A group with no rows carries a count of 0 and renders no body. The header lists no items and has one right-aligned controls slot, which plan 4 fills with the fleet switches.

Build on what exists. `SectionView` (`packages/board/src/app/lib/agent-rows/delivery-view.ts:159`) already holds a section's `icon`, `label`, `hint`, `groups` and `count`; `buildDeliveryView` assembles it at `:373-398` from `SECTION_LABELS` (`:23-29`, emoji icons) and `GROUP_LABELS`. Extend `SectionView` with the summary (a list of `{ group key, label, count }`) and build no second view type. Move the five section icons from the emoji in `SECTION_LABELS` to `packages/board/src/app/lib/glyphs.ts`; the table is keyed by kind of item and draws Octicons at 16 px with `fill="currentColor"`, so add entries there rather than inline SVG in the component. The plan says to apply the pattern to the sections as they stand, with the counts each section already holds: `release-delivery` counts `view.deliveredBlocks`, `you` and `work-items` count their groups, `machine` has no groups. The Fleet header counts working, blocked and free from today's `agentGroup` groups (`packages/domain/src/rules/delivery-placement.ts:262-267`, `DELIVERY_LAYOUT` at `:13-19`). Plans 2 to 6 fill the counts for their own sections; this slice adds no group.

The plan is canonical; this brief is orientation.

### The decisions the plan settles — do not re-derive them

**The summary is a domain property.** CLAUDE.md, "Every rendered state is a domain property": every count, each group's visibility and each link target must be assertable in a unit test with no render. The plan names the board's `delivery-view.ts` as the place `SectionView` lives and leaves the names to you ("Left to the Builder"), so put the pure function where it can be tested without React, following the existing pattern of `delivery-view.ts` and its neighbours in `lib/agent-rows/`. Write the function as an arrow (CLAUDE.md, "Arrow functions"); the unit is the function, so leave the neighbouring declarations alone.

**An empty group renders no body, but its count of 0 stays in the header line.** The header's "0" is what says the group is empty (design, "Every section has one shape"). Hiding the zero too would hide the fact; showing the body would repeat today's empty group heading. A naive implementation filters out count-0 groups from the summary and passes a test that only checks non-empty ones.

**A count links to its group.** Each count carries a link target to the group's heading in the body. How the link scrolls and highlights is the builder's call (plan, "Left to the Builder"); a count whose group has no body links nowhere, because there is no group to scroll to. Group headings already carry `data-delivery-group`; reuse that attribute or `scrollToAnchor` (`AgentList.tsx:1424`) rather than adding a second anchor scheme.

**The header lists no items and has one controls slot.** The slot is right-aligned and empty in this slice. Plan 4 fills it with the fleet switches. Do not move the switches from the Fleet body (`AgentList.tsx:1398-1415`, `#fleet-controls`) in this slice: `feature/delivery-fleet-card` links to that `#fleet-controls` anchor and renders the same switch components read-only, and the move belongs to plan 4.

**Icons come from `glyphs.ts` only.** "No new icons" (design, "Rules for the Whole Tab"): use the existing kinds where one fits (`release` for Release delivery, `agent` for Fleet, `plan` or `wave` for Work items) and add a glyph only where none of the table's kinds names the section. A new glyph is an Octicon copied from `@primer/octicons` at 16 px, with a one-line comment naming why, as the existing entries have.

**Do not rename, regroup or rewire.** `You`'s groups (`input-to-the-fleet`, `review-a-result`, `unblock`) change in plan 2, Work items' in plan 3, and the release line (`data-release-line`, `AgentList.tsx:1390`) in slices 4 and 7. This slice renders what exists, in the new shape.

**Rules carried over from related work:** an absent reading is not `0` — where a count depends on a reading that is `unread`, `placeDelivery`'s existing handling stays as it is and the summary does not turn it into a false zero. Read the placement's output, never re-derive a placement in the summary. The summary adds no server work and no payload field.

### Done when

The plan's Done When item for this slice is the specification: "every Delivery section shows one header line of linked counts with its icon from `glyphs.ts`, and a group with no rows does not show; the Fleet header counts working, blocked and free." Plus the plan's last item: every count, marker and disabled state has a unit test, and browser tests prove only what is seen.

Lift these assertions, because a naive implementation passes without them:

- A section with one empty group and one non-empty group: the summary holds both counts, the empty group's count is 0, and only the non-empty group renders a body. This catches an implementation that drops the zero or keeps the empty heading.
- The Fleet section's summary reads working, blocked and free from the three `agentGroup` groups, including a payload where one of them is empty. This catches a summary that counts agents without grouping them.
- A section with no groups (`release-delivery`, `machine`) yields a summary with no group counts and no dangling links.
- Every section's icon resolves to an entry in `glyphs.ts`. This catches a leftover emoji.
- One browser test proves a header shows its icon and a count link, and that a count link reaches its group. It proves the page shows it; the counts themselves are unit-tested.
- A 320 px viewport has no horizontal scroll, and both themes read (design, Constraints). Check both by looking at the rendered tab, not by reading the diff.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. Run `pnpm build:board` only to look at the result in a browser, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Add a changeset for the package `@plot-pm/board`, the description first and at least 20 characters, then the `plan: docs/plans/2026-11-16-delivery-tab-header-and-my-sprint.md` line inside the comment block (`scripts/check-changeset-packages.sh` checks the order and the package name). This slice changes no skill, so its changeset names no `bumps:` entry. This slice touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` has nothing to count; if you find you need one, pay for the growth in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the section header and its summary: `packages/board/src/app/lib/agent-rows/delivery-view.ts` (`SectionView`, `SECTION_LABELS`, `buildDeliveryView`), the heading markup in `packages/board/src/app/components/AgentList.tsx` (`:1376-1383` and the group headings at `:1431-1435`), `packages/board/src/app/lib/glyphs.ts`, and the unit and browser tests of those. It reads `packages/domain/src/rules/delivery-placement.ts` and changes it only where the Fleet counts need a domain property that is missing.

No other branch of plans 1 to 6 is pushed on 2026-11-17 (`git ls-remote origin 'feature/delivery-*'` returns nothing), and every slice that touches these files waits on this one, so a collision is not possible at merge time. `feature/sprint-owner-field` is the only slice of this plan with no wait; it holds the sprint template, `/plot-sprint`, `rules/sprint-record.ts`, `schema.ts`'s `FleetSprintSchema` and `ownership.ts`, and shares no file with this branch.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
