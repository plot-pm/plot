## Implementation brief — delivery-tab-matches-its-mockups (wave 2: Primitives)

- **Plan (canonical):** docs/plans/2026-11-18-delivery-tab-matches-its-mockups.md on main
- **Approved:** 2026-11-18, Jan Wloka, plan-PR #3531 merged
- **Branch:** `feature/delivery-visual-primitives` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review through the declared channel (`Review: pr`)

The six *Sections* branches wait on this one by heading order. Every wait of this branch has merged: footer (#3507), release card, My sprint scope (#3538), person cards (#3532), sprint delivery scope (#3540), and *Domain fields* (`0446dd134`). Nothing blocks the start.

### What to build

The Delivery tab does not look like its approved mockups. Measured on `main` at `b13b8852e`: no section is a card (each group is its own `rounded-lg border` list), no table shows column headers (`HeaderRow`, `FleetAgentHeader` and the Tickets header are `sr-only`), and colours are Tailwind palette classes written per component while the Plans tab already draws from the `--card-*` and `--hue-*` tokens in `index.css`. This branch lays the shared base the six *Sections* branches style on top of:

- tokens in both themes (`--card-rule`, `--hue-rose` with `-dot` and `-soft`, light `--card-meta` darkened to `oklch(53% 0.046 257.417)`);
- `styles/delivery.css` for the primitives, plus the empty `styles/delivery-{header,release,you,work-items,fleet,bottom}.css`, all imported unlayered from `index.css` right after `@import "tailwindcss";`;
- section card, header bar with bold-number-first counts, both group-heading variants, chip, dot, strip, table with visible header row from 640 px, text colours, kind cell, and the `div[data-tab-header]` wrapper with its `todo` and `status` columns;
- the five-state colour map on `SprintCard.tsx` and `FleetCard.tsx`, and `RoleChip.tsx` on `--hue-<colour>` tokens;
- the theme contrast test, the screenshot test with a `colorScheme` option on the catalogue's `open`, one catalogue scenario that fills every section, and the CI `delivery` output with the artifact upload.

The plan is canonical, and its *Theme Tokens*, *Primitives*, *Screenshots* and *Domain Fields* sections hold the exact values. This brief is orientation.

### Settled decisions — do not re-derive them

- **Tokens, not hex, and two families only.** `--card-rule` and `--hue-rose*` are the only new names. `emerald` maps to the existing `--hue-green` set, `sky` and `orange` to the existing sets. The board has no `data-theme` and no `@custom-variant` (grep finds none under `packages/board/src`), so the dark theme is `@media (prefers-color-scheme: dark)` and nothing else. A `data-theme` switch is not an option.
- **The imports are unlayered.** Tailwind 4 puts utilities in `@layer utilities`. A layered section stylesheet loses to a utility on the same property. The screenshot test asserts one computed style per stylesheet, so a layer that loses fails CI.
- **No view state is decided in a `.tsx` file or in CSS.** A class maps an existing domain field (`SliceState`, `YouMarker`, `FleetCardState`, `MachineDot`, `FreshnessState`, `ChipColour`, a group key, a count key). A lookup table like `YOU_MARKER_CLASS` is fine. A component never tests a string, a count or a threshold to choose a style. *Domain fields* has merged, so the twelve fields exist: render them, compute nothing. Check `packages/domain` for `CellPart.outcome`, `PlanRowFacts.phase`/`accent`, `PlanLine.state`/`pr`/`merged`, `TodoLine.verb`/`label`, the open-questions tone, `YouHeaderCount.words`, `SectionCount.words` and `ReleaseBlockView.counts` before you assume a name.
- **The role chip keeps the domain's colour keys.** The mockups colour `approver` teal and `idea` grey. The domain gives `approver` emerald and `idea` sky, and `brief` already holds teal, so the mockup colours would give two roles one chip.
- **One phase map: `PHASE_ACCENT`** (`PlanCard.tsx`). This branch does not touch it. The Release slice exports it.
- **A count shows its number in bold, then its `words`, in every section.** The bar prints neither `text` nor `label`. Release delivery's header is the Release slice's; this branch renders items 6 and 7 for every other section.
- **11 px is the smallest size** (the mockups' 10 px is not used). Rows are 13 px, section titles 15 px.
- **A dot never stands alone.** A dot with no visible word beside it carries `role="img"` and an `aria-label` with the word, as `MachineSection` does.
- **The fleet switches on the tab-header Fleet card stay read-only,** and the toggle stays named **My sprint**. The spec text wins over the mockups.
- **No SVG path is added.** Icons come from `glyphs.ts`.
- **The screenshot artifact is evidence, not a gate.** The PR body links `delivery-screenshots` from the CI run on the PR head. A Delivery PR never reuses `board-integration` (`needs.select.outputs.delivery == 'true'` overrides `reuse_board`). You see no render at your desk, so CI's run is your first visual feedback.
- **Selectors stay.** Every `data-*` attribute, `role`, `aria-label` and `id` that renders today stays with its value. `YOU_MARKER_CLASS` stays unchanged. The plan's *Tests and Selectors* section lists the tests that read class names; read that list against your files before you change a class. If you must change one, move that test to a `data-*` attribute in the same PR and say so in the PR body.
- **The visible header row changes what `innerText` reads.** Audit every grid `innerText` read in the integration tests (26 files on 2026-11-18). Fix a test only where it asserted the `sr-only` placement itself, and name each in the PR body.

Carried over from related work: absent is not false — a missing field renders nothing and never a default colour; and read an exit code, not emptiness.

### Done when

The plan's `## Slices` *Primitives* done-when is the specification. CI gates: `theme-contrast.test.ts` passes in both themes; `delivery-tab-screenshots.browser.test.ts` passes with no horizontal scroll at 320 px and one computed style per section stylesheet; the existing tests pass. A reviewer judges every section in its card with header bar and visible column headers, from the artifact the PR body links.

Assertions that exist because a naive implementation passes without them:

- **One computed style per stylesheet.** Without it a stylesheet the build drops, or one in a losing layer, ships silently.
- **The contrast test covers `--card-meta` on all five card backgrounds and `--hue-green` on `--card-panel-strong`.** Light `--card-meta` at the old value reads 4.35 on the two `-strong` backgrounds. A test over `--card-surface` alone passes.
- **`scrollWidth <= 320` at every section**, not only the tab header.

Plus: the board artifact is generated and refused in a PR diff (`scripts/check-no-bundle-diff.sh`); do not commit a rebuild. Add a changeset (`'@plot-pm/board'`, description first, `bumps:` block last). Name the local checks command, `node skills/plot/scripts/board/plot-local-checks.mjs`: commit, run it before each push, and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e`. This branch touches `.github/workflows/ci.yml` and `scripts/ci-job-map.jq`, not shell under `skills/`; if you touch any `.sh` file, `scripts/check-shell-lines.sh` refuses growth, so remove shell elsewhere in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Measure the plan's line ranges again at your start (`AgentList.tsx` has moved since `b13b8852e`: the tab header now sits near `:1491-1499`, the release card is `components/ReleaseCard.tsx`) and name them in the PR body.

### Scope guard

You own the files in the plan's *Primitives* `Owns:` list: `index.css`, `styles/*`, the `AgentList.tsx` pieces it names (section element, header `h2` with counts, Fleet switches slot, group headings and tags, group grids, Fleet counts line, Free line, `MACHINE_DOT_CLASS`/`MachineSection`, tab-header wrapper, not-placed block, footer dots), `HeaderRow` in `rows.tsx`, `TupleRow.tsx` (row `li`, kind cell, menu cell, By wrapper), `SprintCard.tsx`, `FleetCard.tsx`, `RoleChip.tsx`, `FleetAgentHeader`, the Tickets header row, the catalogue files, the two new tests, `scripts/ci-job-map.jq` and `ci.yml`.

The six *Sections* branches (`feature/delivery-visual-{tab-header,release,you,work-items,fleet,bottom}`) do not start until this merges. They own the section stylesheets, `TodoList.tsx`, `ReleaseCard.tsx`, `ReleaseApprove.tsx`, `DeliveryFilters.tsx`, `PlanCard.tsx:17`, `draft-plan-row.tsx`, `DeliveryRows.tsx`, `FleetAgentRow.tsx`, `FleetControls.tsx` and `TicketsSection.tsx` (below the header row). Leave those files alone.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
