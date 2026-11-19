## Implementation brief — delivery-tab-matches-its-mockups (wave 3: Sections — work items)

- **Plan (canonical):** docs/plans/2026-11-18-delivery-tab-matches-its-mockups.md on main
- **Approved:** 2026-11-18, Jan Wloka, plan-PR #3531 merged
- **Branch:** `feature/delivery-visual-work-items` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This branch is one of six under the *Sections* heading, and all six run in parallel. They wait on *Domain fields* (#3541) and *Primitives* (#3542) by heading order, and both merged on 2026-11-19, so the slice is startable. The other five (`-tab-header`, `-release`, `-you`, `-fleet`, `-bottom`) own disjoint files; none edits `index.css`.

### What to build

The Work items section does not look like `work-items-v1.html`. Measured on `origin/main` at `81fb7b9f3` on 2026-11-19: `styles/delivery-work-items.css` holds only the marker rule `[data-section="work-items"] { --delivery-section: work-items; }`. `DeliveryRows.tsx` draws every link with `LINK_CLASS = 'text-blue-600 hover:underline dark:text-blue-400'` (`:30`), and the gate marks (`RowCell`, `:65-97`) render as plain text joined by `' · '` with no colour. The mockup colours `CI ⟳` amber, `CI ✗` red and `review –` muted, spaces the marks apart, and puts the branch beneath the PR in the Where cell.

This slice styles, in the mockup's look:

- **The gate marks** (`RowCell`, the `cell.parts` branch): one span per mark, coloured by `CellPart.outcome`: `pass` green, `pending` amber, `fail` red, `none` muted. `outcome` exists on `main` (`delivery-row-form.ts:62`, set by `gatesCell` at `:282` and `:287`). Render it as a `data-gate-outcome` attribute on the mark's span and map the four values to the `delivery-text-*` classes or to `[data-gate-outcome]` rules in `delivery-work-items.css`.
- **The Where cell** with the PR link and the branch beneath it in the muted colour, styled from `[data-section="work-items"] [data-row-cell="where"]` and the `data-tuple-what` marker on each link's icon.
- **The By cell** (`RowCell`, the `cell.agent` branch): the role chip, the agent name as a link, and the fixer attempt (`data-agent-attempt`, "1/2") in the muted small colour.
- **The group columns**: Gates in At a gate, Progress in Being built, Waits on in Queued, in the mockup's column rhythm. The columns exist already; no template change.

Read the plan's *Primitives* section for the classes you build on: `.delivery-text-muted`, `.delivery-text-link`, `.delivery-text-ok`, `.delivery-text-warn`, `.delivery-text-alert`, `.delivery-chip` with `.delivery-hue-*`, `.delivery-row`, `.delivery-row-ruled`, `.delivery-kind`, `.delivery-truncate`. They live in `styles/delivery.css`. Plan *Sections* and the spec's *Work items* item are the specification; this brief orients and corrects.

### The decisions the plan settles — do not re-derive them

**`LINK_CLASS` on `data-row-do` stays unchanged.** `DeliveryRows.tsx:30` and `:54` carry it, and the You slice colours the Do verb through `[data-group] [data-row-do]` in `delivery-you.css`. If you replace `LINK_CLASS` on the `act` arm, the You slice's colour and yours race. You may move the other four arms (`href`, `anchor`, `plan`, `reveal`) from the Tailwind palette to `delivery-text-link`, but leave the `act` arm's string byte for byte.

**The outcome comes from the domain, never from the glyph.** `gatesCell` sets `outcome` from `PrReading.ci` and `PrReading.review`, not from `GATE_MARK`. Do not test `part.value.includes('✓')`, or any string, to choose a colour: that moves a view state into a `.tsx` file, which CLAUDE.md (*Every rendered state is a domain property*) forbids. The map is `outcome` → class or selector, a lookup over four values. A part with no `outcome` (the PR state, the unpushed count) takes the body colour: absent is not `none`.

**`RowCell` is shared with the Fleet slice, and you may not break it.** `FleetAgentRow.tsx` renders `RowCell` for its Agent, Role, Acting on and branch cells (`:34-41`). The Fleet slice (`feature/delivery-visual-fleet`, #3544) owns `FleetAgentRow.tsx` and reads these cells through `RowCell`. Your edit to `RowCell` reaches the Fleet cells too. Keep the `cell.agent === undefined` path, the `cell.links` path and the plain-value path rendering what they render today, and add attributes and classes only. Do not change a prop of `RowCell` or `LinkHandlers`: `AgentList.tsx` (`:1230-1246`) and `FleetAgentRow.tsx` both call it, and neither is yours to edit.

**The Where cell and the row are Primitives' markup.** `TupleRow.tsx:788` owns `data-row-cell="where"` and its links; you may not edit `TupleRow.tsx`, `AgentList.tsx` or `rows.tsx`. Style the Where cell from `delivery-work-items.css` through `[data-section="work-items"] [data-row-cell="where"]`. If the branch label does not render beneath the PR link with a selector alone, **report it** and do not change `TupleRow.tsx`. The mockup's stacked layout is a layout rule; the content is already in `tuple.links`.

**The mockups lose where the spec text disagrees.** The mockup's column headers and kind cells are 10 px; the plan fixes 11 px, and rows are 13 px. The mockup's `By` column is 100 px and its `Age` 40 px; the row's grid template is `TupleRow.tsx:90` and `:107` and is Primitives'. Keep it. A cell that cannot hold its text cuts it at the end with an ellipsis and keeps the full text as `title`. No abbreviated text where the row has room.

**The `' · '` separator between gate marks stays in the text.** `RowCell` writes it into the DOM and `delivery-rows.browser.test.ts` reads rows through `innerText`. Spacing the marks with a margin and dropping the separator changes what that read sees. Keep the separator, and style it `aria-hidden` only if no test reads it: run `grep -rn "CI ⟳\|CI ✗\| · " packages/board/test` first.

**A dot is never colour alone.** You add no dot in this slice; if you add one beside a state, it carries its word or `role="img"` with an `aria-label`.

**Tokens, not hex, and unlayered.** Every colour is a `--card-*` or `--hue-*` token, and the rules live in `styles/delivery-work-items.css`, which Primitives imports unlayered after `@import "tailwindcss"`. Where a rule and a Tailwind utility set one property on one element, remove the utility you replace. A `dark:` utility or a hex value on a Work items element is the failure this plan removes.

**Class-reading tests.** Measured on 2026-11-19, no test reads `text-blue-600` or imports `DeliveryRows`. The tests that render these cells are `delivery-rows.browser.test.ts` (reads `a[data-row-link]` at `:105`) and `agent-readings.test.ts` (unit, imports `DeliveryRows`). Both read `data-*` and roles. For every class you remove, run `grep -rn "<class>" packages/board/test` first. If a test reads one, move it to a `data-*` attribute in the same PR and say so in the PR body.

**Rules carried over unchanged:** a function you write is an arrow (leave the `function` declarations you do not rewrite — the unit is the function, not the file); absent is not false (`cell === null` renders nothing, and a cell with no `outcome` is not a `none` outcome); icons come from `glyphs.ts` only, so add no SVG path; every `data-*`, `role`, `aria-label` and `id` the board renders today stays with its value (`data-row-link`, `data-row-do`, `data-agent-attempt`, `data-link-target`).

### Done when

The plan's *Sections* done-when is the specification. CI gates: this branch's browser tests and the existing ones pass, and `delivery-tab-screenshots.browser.test.ts` passes, with no horizontal scroll at 320 px. A reviewer judges that the Work items section matches `work-items-v1.html` within the spec's text: the dark theme against the mockup, the light theme by eye against the dark mockup, from the `delivery-screenshots` artifact of the CI run on the PR head.

The assertions that exist because a naive implementation would pass without them:

- **One computed style from `delivery-work-items.css` on a real Work items element, not only the marker rule.** The screenshot test reads `--delivery-section` from `[data-section="work-items"]`, which proves the file loads. It does not prove a rule from the file beats a Tailwind utility. Assert the computed colour of a `[data-gate-outcome="pending"]` mark equals `--hue-amber`, `="fail"` equals `--hue-red`, and `="pass"` equals `--hue-green`. A utility left on the span wins silently.
- **The three outcomes compute to three different colours, and `none` is muted.** A rule that styles every mark one colour passes a render. Assert `="none"` computes to `--card-meta`.
- **A part with no outcome has no `data-gate-outcome`.** Assert the PR-state part (no `outcome`) renders without the attribute, so absent stays distinct from `none`.
- **The Do verb keeps its colour.** Assert that `[data-row-do]` still carries the same class string as before your change (`LINK_CLASS`), so the You slice's `[data-group] [data-row-do]` rule is the only thing that colours it.
- **The Fleet cells still render.** Assert in a unit or browser test that `RowCell` with a `cell.agent` still renders the role chip and the attempt span, because Fleet depends on it.
- **No horizontal scroll at 320 px.** The Where cell's branch label cuts at the end with an ellipsis. A `nowrap` without `min-w-0` passes at 1280 px and fails there.

Plus: this slice touches `.tsx` and `.css`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e`, and do not run the board's browser suites at a fleet desk. The slice adds no `.sh`; if it did, `scripts/check-shell-lines.sh` would refuse a longer shell total than its merge base. Add a changeset for `@plot-pm/board` (description first, `bumps:` block last). Do not commit a rebuilt `board-server.mjs`: `scripts/check-no-bundle-diff.sh` refuses it, and `main` builds its own bundles after each merge.

### Bookkeeping

Open the PR through `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Name in the PR body: your re-measured line ranges, any class-reading test you moved to a `data-*` attribute, the `delivery-screenshots` artifact link, and the four images for the Work items section (light, dark, 320, mockup).

### Scope guard

This branch owns: `components/DeliveryRows.tsx` (`RowCell`, the By cell's content), `styles/delivery-work-items.css`, plus the tests that cover them. Do not edit `AgentList.tsx`, `index.css`, `TupleRow.tsx`, `rows.tsx`, `FleetAgentRow.tsx`, `RoleChip.tsx`, any other `styles/*.css`, or any domain file. Add no domain field, no reading and no host call; `CellPart.outcome` already exists.

Other branches in flight, same heading: `feature/delivery-visual-tab-header` (`TodoList.tsx`, `ReleaseCard.tsx`, `DeliveryFilters.tsx`, `ReleaseApprove.tsx`, `delivery-header.css`; PR #3543), `-release` (`AgentList.tsx` Release block, `ReleasePersonCards.tsx`, `PlanCard.tsx`, `delivery-release.css`; PR #3545), `-you` (`draft-plan-row.tsx`, `delivery-you.css`), `-fleet` (`FleetAgentRow.tsx`, `FleetControls.tsx`, `delivery-fleet.css`; PR #3544), `-bottom` (`TicketsSection.tsx`, `delivery-bottom.css`). The one shared seam is `RowCell` in `DeliveryRows.tsx`, which `FleetAgentRow.tsx` calls; no file is edited by two branches.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
