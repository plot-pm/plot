# The Delivery tab matches its mockups

> The Delivery tab gets the look of the approved brainstorm mockups, in the light and the dark theme, through six new domain fields, shared tokens and primitives, and one styling slice per section.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:**
- **Story:** delivery-tab-reads-at-a-glance
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2

## Changelog

- The Delivery tab looks like its design mockups: every section sits in its own card under a header bar that carries its counts, tables show their column headers, and role chips, state dots and slice strips share one palette in the light and the dark theme.

<!-- Board impact: the board's look only. No change to the plan format, the plan template, the helper scripts or the docs/plans layout. The client bundle changes, and main rebuilds the board artifact after each merge. -->

## Motivation

The design [Delivery Tab Reads at a Glance](../superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md) has six plans, `docs/plans/2026-11-16-delivery-*.md`. They change what each section shows. They left *"Colours, spacing and the exact chip styles, within the board's existing palette"* to the builder (*Left to the Builder*), so the merged slices kept the tab's old styling. Jan Wloka approved the mockups as the look, and the tab does not look like them.

Measured on `main` at `89407abdc`:

- No section is a card. Each group is its own bordered list (`rounded-lg border` at `AgentList.tsx:1671` and `:1710-1714`), so a section reads as several boxes under a heading.
- No table shows its column headers. `HeaderRow` (`lib/agent-rows/rows.tsx:446-483`), `FleetAgentHeader` (`FleetAgentRow.tsx:5-14`) and the Tickets header (`TicketsSection.tsx:81`) are `sr-only`. The design says *"Columns carry headers"*.
- The Release delivery strip is text ("2 delivered 1 at-a-gate", `AgentList.tsx:1583-1588`), not one block per slice.
- The colours are Tailwind palette classes written per component, for example `RoleChip.tsx:4-13`, `SprintCard.tsx:3-9`, `FleetCard.tsx:21-25` and `AgentList.tsx:13-18` and `:167-172`. The Plans tab cards already draw from theme tokens (`index.css:62-183`); the Delivery tab does not.
- The sprint bar colours a gate sky and a blocked slice amber (`SprintCard.tsx:3-9`). The mockups colour a gate amber and a blocked slice red.

## Design

### Approach

**The mockups are the target, and the spec text wins.** The eight mockups are committed beside the spec at `docs/superpowers/specs/2026-11-16-delivery-tab-mockups/`. Where a mockup and the spec text disagree, the spec text wins, as the spec says. Two known cases: the mockups show the fleet switches on the tab-header Fleet card as text ("auto-dispatch on · 3 parallel"), and the spec shows them read-only, so the read-only switches stay. The mockups label the toggle "This sprint", and the spec names it **My sprint**.

**Scope: styling and markup classes, plus six domain fields.** The styling slices change class names, CSS, and the markup that carries them: the section cards, the section header bars, the tab header cards (release card, sprint card, fleet card, to-do list), role and state chips, state dots, slice strip blocks, the tables (header row, column widths, row borders), the muted, link, ok, amber and red text colours, and spacing and typography. Outside the *Domain fields* slice, it adds no domain field. No slice adds a reading or a host call.

**No view state is decided in a `.tsx` file or in CSS.** CLAUDE.md, *Every rendered state is a domain property*, binds this plan. A class name or a CSS selector maps an existing domain field: a `SliceState`, a `YouMarker`, a `FleetCardState`, a `MachineDot`, a `FreshnessState`, a `ChipColour`, a group key or a count key. A map from a field to a class is a lookup table, like `YOU_MARKER_CLASS` today. A component never tests a string, a count or a threshold to choose a style. The mockups show six states that the domain did not expose. The slice *Domain fields* adds them as domain properties with unit tests (see *Domain Fields* below), so the styling slices map fields and compute nothing.

**Tokens, not hex.** Every colour comes from a custom property in `packages/board/src/app/index.css`, defined once for the light theme and once again under `@media (prefers-color-scheme: dark)`. The board has no other theme switch: `grep` finds no `data-theme` and no `@custom-variant` under `packages/board/src`. The Delivery tab uses the card tokens that the Plans tab already uses, so the two tabs share one palette.

**One stylesheet per section, so slices do not conflict.** The *Primitives* slice creates `packages/board/src/app/styles/delivery.css` for the primitives and one stylesheet per section, and imports all of them from `index.css` once. A later slice edits only its own stylesheet and never `index.css`.

### Theme Tokens

The mockups are dark only. Each mockup colour maps to a token that exists in both themes. Contrast was recomputed on 2026-11-18 from `index.css`: each `oklch()` value converted to sRGB, and each alpha value (the dark `-soft`, `--card-band` and `--card-panel` values) composited over `--card-surface`, the background every section card has. Every pair below reads at least 4.5:1, the WCAG AA level for body text. The light margins are thin: green on its soft reads 4.72, and `--card-meta` on `--card-band` or `--card-panel` reads 4.55.

| Mockup colour | Use | Token | Light / dark contrast on `--card-surface` |
|---|---|---|---|
| `#131a2e`, border `#232c46` | section card, tab header card | `--card-surface`, `--card-border` | — |
| `#232c46` | header bar rule, table header rule | `--card-border` | — |
| `#1a2238` | row rule | **new** `--card-rule` | — |
| `#fff` | section title | `--card-title` | 17.84 / 17.05 |
| `#d7dbe7` | body text | `--card-body` | 10.34 / 12.02 |
| `#8a93a8`, `#6b7490` | muted text, column headers, kind cell, age | `--card-meta` | 4.77 / 6.79 |
| `#7aa2ff`, `#60a5fa` | links, input marker, Do verb | `--hue-blue` | 6.82 / 9.85 |
| `#4ade80` | ok, delivered, working | `--hue-green` | 4.94 / 12.76 |
| `#fbbf24` | amber, at a gate, fixer | `--hue-amber` | 5.05 / 12.34 |
| `#f87171` | red, blocks delivery | `--hue-red` | 6.42 / 9.29 |
| `#2a3352` on `#c9d2ea` | neutral chip | `--hue-slate-soft`, `--hue-slate` | 6.90 / 9.44 |
| `#3b2f10` on `#fbbf24` | warn chip, fixer chip | `--hue-amber-soft`, `--hue-amber` | 4.87 / 10.13 |
| `#132a4a` on `#60a5fa` | input tag, loop chip, Development | `--hue-blue-soft`, `--hue-blue` | 6.26 / 8.20 |
| `#3a1418` on `#f87171` | blocks-delivery tag | `--hue-red-soft`, `--hue-red` | 5.88 / 8.05 |
| `#2d1f4a` on `#c4a7ff` | reviewer chip | `--hue-violet-soft`, `--hue-violet` | 6.64 / 8.29 |
| `#10302a` on `#5eead4` | Testing phase | `--hue-teal-soft`, `--hue-teal` | 5.17 / 9.82 |
| `#2563eb` | Approve release button | `--card-primary` behind `--card-primary-text` | 5.26 / 5.36 (the button's text on it) |
| `#8a93a8` on a banded row | muted text on a band or panel | `--card-meta` on `--card-band`, `--card-panel` | 4.55 / 6.26 (band), 4.55 / 6.14 (panel) |
| `#232c46` | bar and strip track, not started | `--card-track` | — |
| dots | state dots | `--hue-<name>-dot` | non-text |

The decisions:

- **Two token families are added, both in both themes.** `--card-rule` is the row rule, one step lighter than `--card-border`: slate-100 in light, `rgb(51 65 85 / 0.5)` in dark. `--hue-rose`, `--hue-rose-dot` and `--hue-rose-soft` serve the `design` role chip, because `ChipColour` names `rose` (`packages/domain/src/rules/agent-roles.ts:127`) and `index.css` has no rose hue. `ChipColour` `emerald` maps to the existing `--hue-green` set, and `sky` and `orange` map to the existing `--hue-sky` and `--hue-orange` sets, so no other family is added.
- **The five slice states take one colour map** for the sprint bar, the release bar, the per-person bars and the slice strip: delivered `--hue-green-dot`, at a gate `--hue-amber-dot`, being built `--hue-blue-dot`, blocked `--hue-red-dot`, not started `--card-track`. This follows the mockups and changes `SprintCard.tsx:3-9`, which colours a gate sky and a blocked slice amber.
- **The role chip keeps the domain's colour keys.** The mockups colour `approver` teal and `idea` grey. The domain gives `approver` emerald and `idea` sky (`agent-roles.ts:136-145`), and `brief` already holds teal, so the mockups' colours would give two roles one chip. The board maps each `ChipColour` to `--hue-<colour>-soft` behind `--hue-<colour>` text.
- **The token change stays inside the Delivery tab** (Jan Wloka, 2026-11-18). The other `dark:` utilities in the board's components and the `prefers-color-scheme` block in `packages/board/src/server/board.ts:3723` stay as they are.
- **The light theme is reviewed by eye against the dark mockup** (Jan Wloka, 2026-11-18). The mockups are dark only, so no light mockup exists. A reviewer compares the light screenshot with the dark mockup for layout, hierarchy and colour roles; the contrast test covers the light theme's readability.
- **A gate (CSS) proves the contrast.** The *Primitives* slice adds `packages/board/test/unit/theme-contrast.test.ts`. It reads `index.css`, converts every `oklch()` and `rgb()` value, composites each alpha value over `--card-surface`, and asserts 4.5:1 for every text token on `--card-surface`, for every `--hue-<name>` on its `-soft`, for `--card-primary-text` on `--card-primary`, and for `--card-meta` on `--card-band` and on `--card-panel`, in both themes. A later token change that breaks AA fails the test.

### Primitives

The first slice defines these classes in `styles/delivery.css`. The names below are the builder's call; the shapes are the mockups'.

- **Section card:** the section on `--card-surface` with a `--card-border` border, 0.5 rem radius (the existing `rounded-lg`), 1 rem padding, and 0.75 rem padding below 640 px.
- **Header bar:** the section title (15 px, semibold, `--card-title`), its glyph, and its counts on one wrapping line, with a `--card-border` rule beneath. A count shows its number in bold. A count's colour maps its key: `blocks-delivery` red, `input` blue, `at-a-gate` amber, `being-built` and `working` green, every other key the body colour.
- **Group heading:** 11 px uppercase with 0.06 em letter spacing in `--card-meta`.
- **Chip:** 11 px, 1 px by 7 px padding, a full radius, `-soft` background behind the hue text. Tones: neutral, warn, input, block, and one per `ChipColour`.
- **Dot:** a 7 px circle in a `-dot` colour. **Every dot sits beside its state as words** (the design's rule): a dot that has no visible word beside it carries `role="img"` and an `aria-label` with the word, as `MachineSection` does today (`AgentList.tsx:24`).
- **Strip:** one 18 by 8 px block per slice with a 3 px gap, in the five-state colour map.
- **Table:** the existing `role="grid"` lists stay. The header row becomes visible from 640 px up: 11 px uppercase `--card-meta`, a `--card-border` rule beneath. Rows take 0.5 rem padding and a `--card-rule` rule. Groups inside a section card lose their own border and radius. Below 640 px the header row stays hidden and the cells stack, as `max-sm:grid-cols-1` does today.
- **Text colours:** muted (`--card-meta`), link (`--hue-blue`), ok (`--hue-green`), amber (`--hue-amber`), red (`--hue-red`).
- **Type scale:** rows 13 px, section titles 15 px, column headers, kind cells, chips and group headings 11 px. The mockups use 10 px for column headers and kind cells; 11 px is the smallest size here (Jan Wloka, 2026-11-18, see *Decisions*).

### Rules That Hold

- **No horizontal scroll at 320 px.** Every slice's browser test opens its section at a 320 px viewport and asserts `document.documentElement.scrollWidth <= 320`. The tab header's two columns stack below 768 px. The Fleet header's switches wrap onto the next line.
- **Icons only from `glyphs.ts`.** No slice adds an SVG path; the section and item icons stay `sectionGlyph` and the `glyphs.ts` entries.
- **No abbreviated text where the row has room.** A cell that cannot hold its text cuts it at the end with an ellipsis and keeps the full text as its `title`, never in the middle. No slice shortens a label to fit a mockup width.
- **A dot carries its state as text too**, as *Primitives* states.

### Screenshots

**Each slice's PR body links CI's `delivery-screenshots` artifact, and that link counts as done.** The artifact holds the section in both themes beside its mockup. Nobody attaches images by hand, and no merge waits for images.

- The *Primitives* slice adds a `colorScheme` option to the catalogue's `open` (`packages/board/test/catalogue/index.ts:40-60` and `:209-215`), passed to Playwright's `browser.newContext`. The option exists in Playwright and the catalogue already passes `reducedMotion` the same way.
- The *Primitives* slice adds `packages/board/test/integration/delivery-tab-screenshots.browser.test.ts`. For each section it opens the mock board (`test/catalogue/mock-board.ts`, which serves the built client and no real board) in light and in dark at 1280 px, and at 320 px in one theme. It asserts that the section renders and that the page has no horizontal scroll. Where `PLOT_SCREENSHOT_DIR` is set, it writes `<section>-light.png`, `<section>-dark.png` and `<section>-320.png` there, and renders the section's mockup file at the same width to `<section>-mock.png` through `page.setContent`.
- The *Primitives* slice adds one catalogue scenario that fills every section: a release card, a sprint card, to-do lines of all three markers, Work items in all three groups, Fleet agents in Working, Blocked and Free, a strained Machine, tickets and a footer.
- `.github/workflows/ci.yml` sets `PLOT_SCREENSHOT_DIR` to `${{ runner.temp }}/delivery-screenshots` for the step *Board integration tests (vitest + Playwright)* (`ci.yml:1541-1543`) and uploads the directory as the artifact `delivery-screenshots` with `retention-days: 7`. The upload and the env line run only when the PR changes a Delivery-tab path (Jan Wloka, 2026-11-18): the `select` job gains one output, `delivery`, from one step that greps the diff it already reads (`git diff --name-only HEAD^1 HEAD`, `ci.yml:260`) for `packages/board/src/app/`, `packages/board/test/catalogue/` and `docs/superpowers/specs/2026-11-16-delivery-tab-mockups/`. The job `board-integration` already `needs: [select, gates]` (`ci.yml:1305-1307`), so the step reads `needs.select.outputs.delivery`. A push to `main` uploads nothing. The directory is outside the private `TMPDIR` that `scripts/owned-run.sh` creates and removes, so the leak check does not see it.
- **The link is the evidence.** The slice's PR body links the `delivery-screenshots` artifact of the CI run on the PR's head commit and names the four images per section in it. The link exists only after that run finishes and expires after 7 days; it is evidence for the reviewer, not a gate. GitHub has no REST route that uploads an image into a PR body, and a fleet agent does not run the board's browser suites at its desk (CLAUDE.md, *Testing*), so the artifact link is the done-when (Jan Wloka, 2026-11-18). A reader opens the images with `gh run download <run> -n delivery-screenshots`.

### Tests and Selectors

- **The existing browser tests stay green, and their selectors stay.** Every `data-*` attribute, `role`, `aria-label` and `id` that the board renders today stays, with its value. A slice that moves markup moves the attribute with it.
- **Classes that tests read stay as they are.** These tests read a class name: in integration, `tuple-row.browser.test.ts:451-452` (the status word's `text-emerald-700`), `agents-tab.browser.test.ts:1292,1351,1355` (the link target's `ring-amber-400`), `dead-fetch.browser.test.ts:91,153` (`text-red-600`), `supervisor-badge.browser.test.ts`, `folded-plan-pr-fold.browser.test.ts` and `button-claims.browser.test.ts`; in unit, `agent-list.test.ts:1021` and `:1338-1550` (classes read from the `AgentList.tsx` source) and `tuple-row.test.ts:1234` (`text-emerald-700 dark:text-emerald-500`). Each slice reads this list against its own files before it changes a class. None of those elements is in this plan's scope, so no slice changes those classes. A slice that finds it must change one moves the test to a `data-*` attribute in the same PR and says so in the PR body.
- **The visible header row changes what `innerText` reads** for a grid. `agents-tab.browser.test.ts:890-905` and `:3730-3768` assert the column headers through `getByRole('columnheader')`, which reads the same with the row shown or hidden. The *Primitives* slice audits every grid `innerText` read in the integration tests (26 files read `innerText` on 2026-11-18), not only the files that name `columnheader`. CI runs those files on its PR; the slice fixes a test only where it asserted the `sr-only` placement itself, and names each fixed test in the PR body.

### Line Ranges

Measured on `main` at `89407abdc`. Six Delivery-tab slices are still open, and four of them edit `AgentList.tsx`, so these lines move. Each slice measures its ranges again at its start and names them in its PR body.

| File | Lines on `89407abdc` | What is there |
|---|---|---|
| `packages/board/src/app/index.css` | 62-183 | the card and hue tokens, light then dark |
| `packages/board/src/app/components/AgentList.tsx` | 13-41 | `MACHINE_DOT_CLASS` and `MachineSection` |
| | 167-172 | `YOU_MARKER_CLASS` |
| | 1046-1056 | `DeliveryFilters` placement |
| | 1471-1476 | `FleetCard` and `SprintCard` placement, the tab header |
| | 1483-1554 | the section header `h2`, its counts, the You phase strip and the Fleet switches slot |
| | 1556 | the section element |
| | 1557-1629 | Release delivery: release line, plan rows, strip, opened lines |
| | 1630-1642 | the Fleet counts line and the Machine section placement |
| | 1643-1724 | the groups: Free line, group headings with You markers, the group grids |
| | 1727-1750 | the not-placed block |
| | 1787-1833 | the footer line, which `feature/delivery-tab-footer` (#3507) rewrites |
| `packages/board/src/app/lib/agent-rows/rows.tsx` | 446-483 | `HeaderRow` |
| `packages/board/src/app/components/TupleRow.tsx` | 689-703 | the row `li` and its border |
| `packages/board/src/app/components/DeliveryRows.tsx` | 65-97 | `RowCell`, the gate marks and the By cell |
| `packages/board/src/app/components/RoleChip.tsx` | 4-33 | `COLOUR_CLASS` and `RoleChip` |
| `packages/board/src/app/components/FleetAgentRow.tsx` | 5-71 | `FleetAgentHeader` and `FleetAgentRow` |
| `packages/board/src/app/components/FleetControls.tsx` | 77-300 | the switches and the parallel-agents stepper |
| `packages/board/src/app/components/FleetCard.tsx` | 21-71 | the fleet card |
| `packages/board/src/app/components/SprintCard.tsx` | 3-58 | the sprint card and its segment colours |
| `packages/board/src/app/components/DeliveryFilters.tsx` | 75-97 | the filter chip button |
| `packages/board/src/app/lib/agent-rows/draft-plan-row.tsx` | 33-75 | the You plan row's chips and first question |
| `packages/board/src/app/components/TicketsSection.tsx` | 37-132 | the Tickets section |
| `packages/board/test/catalogue/index.ts` | 40-60, 209-215 | the `open` options and `newContext` |
| `.github/workflows/ci.yml` | 1541-1543 | the board integration test step |

Two files do not exist on `main` yet: `components/TodoList.tsx` arrives with `feature/delivery-tab-todo-list` (#3530), and the release card and the per-person cards arrive with `feature/delivery-release-card` and `feature/delivery-release-person-cards`.

### Domain Fields

Each item is a state a mockup styles that the domain did not expose on `main` at `89407abdc`. The *Domain fields* slice adds each one as a domain property with a unit test, before *Primitives*. No slice computes one of them in a component.

**Items 2 and 3 close a gap in a delivered sibling slice** (Jan Wloka, 2026-11-18). The sibling plan [delivery-release-progress-per-plan](2026-11-16-delivery-release-progress-per-plan.md) specifies the Phase column (`:21`, `:47`) and "merged 2 days ago" (`:54`). Its plan-rows slice merged as #3525 without either: on `main` at `341df638d`, `release-plan-rows.ts` has no phase and `doneDetail` writes `mergedAt.slice(0, 10)`. Its two other slices build neither: #3532 (person cards) adds `release-person-cards.ts` and changes `sprint-card.ts` and `delivery-view.ts` with no phase and no relative time, and `feature/delivery-sprint-delivery-scope` builds the Sprint delivery scope. So *Domain fields* adds both. If the sprint-scope slice lands either field first, *Domain fields* adds nothing for it and says so in its PR body. The *Release* section slice styles what the domain delivers.

1. **A gate mark has no outcome.** `CellPart` (`packages/domain/src/rules/delivery-row-form.ts:58-60`) carries `value` and `link`. The mockups colour `CI ⟳` amber, `CI ✗` red and `review –` muted. The component would have to read the glyph in `value`. Added: an outcome on `CellPart`, `pass`, `pending`, `fail` or `none`, set where `gateValue` (`:223`) builds the mark.
2. **A Release delivery plan row has no phase.** `PlanRowFacts` (`packages/domain/src/rules/release-plan-rows.ts:143-152`) has no phase, and the design names the columns Plan · Phase · Slices · Owner. Added: the plan's workflow phase on `PlanRowFacts`, read from the phase the board already holds for the plan. Its chip maps Development blue and Testing teal.
3. **An opened plan line has no state.** `PlanLine` (`release-plan-rows.ts:113-122`) carries `heading` and one `text`. The mockups colour `✓ merged` green, `⟳ at CI` amber and `● building` blue, and they link the slice and the PR apart. Added: the slice's `SliceState` and its PR number on `PlanLine`, and a relative merge time ("merged 2 days ago") from `mergedAt` and a passed-in `now`, in place of the ISO date that `doneDetail` (`:103-110`) writes today.
4. **A to-do line is one string.** `TodoLine` on `feature/delivery-tab-todo-list` carries `text` ("Approve my-plan"). The mockups colour the verb by its marker and link the item name in bold. Added: `verb` and `label` apart on `TodoLine`, beside `text`. The open PR #3530 builds `TodoLine`; the *Domain fields* slice adds the two fields if #3530 merged without them, and adds nothing to `TodoLine` if #3530 already carries them.
5. **The open-questions chip has no tone.** `openQuestionsChip` (`packages/domain/src/rules/plan-open-questions.ts:46`) returns the chip's text. The mockups colour the chip amber when a question is open and neutral when none is. Added: a tone beside the text, `warn` where a question is open and `neutral` where none is.
6. **A You header count has no label apart from its number.** `YouHeaderCount` (`packages/domain/src/rules/you-header.ts:12-19`) carries `count` and `text`, and `text` holds the number too. The other sections' `SectionCount` (`lib/agent-rows/delivery-view.ts:162-170`) carries `count` and `label` apart. Added: `label` on `YouHeaderCount`, so the header bar shows the number in bold the same way for every section.

### Decisions

- **One parallel Sections wave** (Jan Wloka, 2026-11-18). The six section branches sit under one heading, *Sections*, so they run in parallel. A `###` heading is a slice, and the fleet starts a later slice only when every earlier slice merged (`plot-fleet-scan.sh:237-241`). `/plot-reconcile` section 7 reports the *Sections* heading as an uncut slice, and that report is accepted.
- **A domain slice closes the gaps first** (Jan Wloka, 2026-11-18). *Domain fields* is its own wave before *Primitives* and adds the six fields under *Domain Fields* as domain properties with unit tests.
- **The artifact link is the screenshot evidence** (Jan Wloka, 2026-11-18). A slice's PR body links CI's `delivery-screenshots` artifact, and that link counts as done. Nobody attaches images by hand, and no merge waits for that.
- **Type size** (Jan Wloka, 2026-11-18). Rows are 13 px. Column headers, kind cells, chips and group headings are 11 px.

### Open Questions

Round 1 of `/challenge-the-plan` raised the checked items below. Jan Wloka answered all of them on 2026-11-18, and the slices follow the answers. Round 2 (panel, unattended) raised the unchecked items at the end of this list; no person has answered them yet.

- [x] **Type.** `feature` stays.
- [x] **Owners for markup no slice owns.** *Primitives* owns the Free line, the Fleet counts line, the Fleet switches slot, the group tags and the Do cell. Re-checked after the move: in *Sections*, only `feature/delivery-visual-release` edits `AgentList.tsx`, and no *Sections* branch edits `TupleRow.tsx`. *(panel round 1: contradiction, deliverable)*
- [x] **Owners for the colour map's consumers.** *Primitives* defines the five-state colour map and applies it in `SprintCard.tsx` and `FleetCard.tsx`, which it now owns. The release card's bar and the slice strip use the same classes. *(contradiction)*
- [x] **Two homes for the group colour.** The You group colour lives only in `data-group` selectors in `styles/delivery-you.css`. *Primitives* keeps `YOU_MARKER_CLASS` unchanged and does not style through it. *(contradiction)*
- [x] **Paths for components that do not exist yet.** The slice that styles the release card or the per-person card names its path in the PR body at slice start, as each `Owns` says. *(deliverable)*
- [x] **Owner of Phase and the relative merge time.** *Domain fields* closes the gap that the sibling's merged plan-rows slice left; see *Domain Fields*. *(estate)*
- [x] **Class-reading tests, complete inventory.** Added to *Tests and Selectors*, and the *Primitives* audit covers every grid `innerText` read. *(contradiction, cost)*
- [x] **The artifact link is not a gate.** The PR body links the artifact of the CI run on the PR head. Each done-when names which clause CI gates and which a reviewer judges. *(cost, deliverable)*
- [x] **Screenshot upload weight.** `retention-days: 7`, and the upload runs only when the PR changes a Delivery-tab path, through one new `select` output. *(cost)*
- [x] **Contrast figures and gate scope.** The table uses the recomputed figures, and the contrast test asserts `--card-meta` on `--card-band` and `--card-panel`. *(cost)*
- [x] **Light theme has no mockup.** A reviewer compares the light theme by eye with the dark mockup. *(cost)*
- [x] **Token scope.** `sky` and `orange` map to existing hue sets; the other `dark:` uses and `server/board.ts:3723` stay. *(estate)*
- [x] **Sections wait on Primitives only by heading order.** The *Sections* heading says so. The screenshot harness stays in *Primitives*, because *Primitives* needs it for its own done-when and a separate branch would cost a wave. *(deliverable, cost)*

- [ ] **Round 2: Release header counts.** `ReleaseBlockView.header` is one string (`delivery-view.ts:240`, `:521-522`), so the Release slice cannot show a bold coloured number without parsing it, and *Approach* forbids that. Either add a seventh *Domain Fields* item (Release header counts as `{key, count, label}`, string kept beside them) or state that the Release header stays one muted line and correct item 6's "every section". *(contradiction, deliverable; blocks `feature/delivery-visual-release`)*
- [ ] **Round 2: `now` and the phase reach `planRowFacts` through a component.** `placeMapping` (`delivery-view.ts:529-534`) takes no clock and its only caller is `AgentList.tsx:1147`, but *Domain fields* owns no `.tsx` file and its done-when forbids one. Name who passes `now` (a parameter on `placeMapping` plus the one call-site line, with the `.tsx` rule relaxed for that line) or move the relative time out of the domain slice. *(estate, deliverable, cost)*
- [ ] **Round 2: the screenshot artifact can be absent.** `board-integration` is skipped when `reuse_board` is set (`ci.yml:1308`, `:142`, `docs/plans/2026-11-09-ci-reuses-green-runs.md`), so the CI run on the PR head may hold no `delivery-screenshots` artifact. Say what the PR body links in that case, or exempt the Delivery paths from reuse. *(estate, deliverable, cost)*
- [ ] **Round 2: the Phase colour has two homes.** `PlanCard.tsx:17-24` (`PHASE_ACCENT`) colours Development green and Testing violet on the Plans tab; item 2 says blue and teal, and a chip map keyed on the word `Development` tests a string in the view. `phaseColumns` (`workflow-phases.ts:207-238`) already gives each phase an accent key. Decide which colours both tabs use and whether item 2 reuses that accent. *(estate)*
- [ ] **Round 2: reuse what exists.** The estate has three relative-time formatters (`storyDateText`, `relativeAge` and one more; item 3 names none), and the released plan `2026-11-06-one-card-grammar.md` built `Tone` and chip, dot and text-colour vocabulary on the Plans tab. State which item 3 and *Primitives* reuse. *(estate)*
- [ ] **Round 2: item 1 names the wrong builder.** `gateValue` (`delivery-row-form.ts:223-230`) returns a string; the gate-mark `CellPart`s are built in `gatesCell` (`:264-279`) from `gateMarks` (`:244`). *(estate)*
- [ ] **Round 2: the Do cell range names the By cell.** `TupleRow.tsx:845-848` is the `⋯` menu cell and `:850-862` is the By cell, which *Work items* also claims through `RowCell`; the Do verb is rendered in `DeliveryRows.tsx:53` with `LINK_CLASS`. Split the ownership and say *Work items* keeps `LINK_CLASS` on `data-row-do` unchanged. *(contradiction)*
- [ ] **Round 2: the group colour still has two homes in the cascade.** `YOU_MARKER_CLASS` stays on `data-group-marker` (`AgentList.tsx:1682-1684`) beside the `data-group` rule, and Tailwind 4 utilities sit in `@layer utilities`. State the layer the section stylesheets import into (unlayered, after `@import "tailwindcss"`) or remove the class and move the class-reading tests. The screenshot test does not catch a lost override. *(contradiction, deliverable)*
- [ ] **Round 2: "being built" takes two colours.** Line 89 colours the count green, line 78 and line 163 colour the state blue. Map the count to blue or state the exception. *(contradiction)*
- [ ] **Round 2: the group heading style matches two of four sections.** `you-section-v2.html:8` and `section-header.html:13` show a 12 px, 650-weight, body-colour, not-uppercase heading with a tag beside it. Add a variant or place it in `delivery-you.css`. *(contradiction; cosmetic)*
- [ ] **Round 2: the token table maps the section card to the wrong mockup colour.** Every section frame is `#0b1020`; `#131a2e` is the tab-header box and the to-do list. Split the row. *(contradiction; cosmetic)*
- [ ] **Round 2: new tokens against the spec's "existing palette".** `--card-rule` and the `--hue-rose` family deviate from *Left to the Builder* (spec line 241); record the deviation as a decision. *(contradiction; cosmetic)*
- [ ] **Round 2: the kind cell appears in every section.** `TupleRow.tsx:747-756` is shared by You and Work items, so a `data-group`-scoped rule in `delivery-you.css` leaves Work items unstyled; move its style to *Primitives*. *(contradiction; cosmetic)*
- [ ] **Round 2: the changelog and the board-impact comment omit two visible changes.** Item 2 adds a Phase column and item 3 replaces an ISO date with "merged 2 days ago", yet the changelog says looks only and the comment says "the board's look only". *(deliverable)*
- [ ] **Round 2: the tab-header column markup has no owner.** `first-five-seconds-v2.html:55-74` nests the sprint and fleet cards in one right-hand container beside the to-do box; `feature/delivery-visual-tab-header` may style only through its stylesheet. *Primitives* should name the wrapper structure and which card goes in each column. *(deliverable)*
- [ ] **Round 2: the relative merge time has no testable case list, and the header bar decides word order.** "Every case its type names" does not hold for a string; list the cases (minutes, hours, days, weeks, a future `mergedAt`, a missing one). `SectionCount.text` puts the number first in one section and last in the others (`delivery-view.ts:162-170`), so the bold-number bar needs the order decided in the domain. *(deliverable)*
- [ ] **Round 2: one mockup image per section, two mockups for two sections; "six fields" counts eight.** The tab-header and release slices cite two mockups each, and item 3 alone adds three fields. *(deliverable; cosmetic)*
- [ ] **Round 2: the schedule and the dependency claim.** The critical path is seven serial merges (`delivery-tab-todo-list`, `delivery-release-card`, `delivery-my-sprint-scope`, `delivery-sprint-delivery-scope`, *Domain fields*, *Primitives*, *Sections*), three of them slices nobody has written; round 1 asked for it and the Notes do not state it. *Domain fields* "shares files with all six", but #3507 (`feature/delivery-tab-footer`) touches none of its Owns files. *(cost)*
- [ ] **Round 2: the contrast gate covers an enumerated list.** `--card-meta` on `--card-band-strong` and `--card-panel-strong` reads 4.35 in light and light `--hue-green` on `--card-panel-strong` reads 4.51; assert `--card-meta` on every card background, or say the `-strong` tokens are out of scope. *(cost)*
- [ ] **Round 2: smaller cost and cite items.** The screenshot test runs on every `board-integration` run (about 32 renders); the `select` diff command is at `ci.yml:198` (file `$RUNNER_TEMP/changed.txt`), not `:260`, and `scripts/ci-job-map.jq` already maps paths to jobs; round-1 cost items 6 (no render at the desk) and 13 (built CSS holds the imported rules) have no answer. *(cost, estate)*

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "engine": "panel",
  "questionHistory": [],
  "deferredItems": [],
  "categoriesCovered": {}
}
END-CHALLENGE-THE-PLAN-METADATA -->

## Slices

### Domain fields

- `feature/delivery-domain-fields` <!-- waits: feature/delivery-tab-footer, feature/delivery-tab-todo-list, feature/delivery-release-card, feature/delivery-my-sprint-scope, feature/delivery-release-person-cards, feature/delivery-sprint-delivery-scope --> — the six fields under *Domain Fields*: the gate-mark outcome, the plan row's phase, the opened plan line's slice state, PR number and relative merge time, the to-do line's verb and label, the open-questions tone, and the You header count's label, each with a unit test <!-- builds: domain fields for the Delivery tab's styled states -->

  Owns: `packages/domain/src/rules/delivery-row-form.ts` (`CellPart`, `gateValue`), `packages/domain/src/rules/release-plan-rows.ts` (`PlanRowFacts`, `PlanLine`, `doneDetail`), `packages/domain/src/rules/todo-list.ts` (`TodoLine`, only if #3530 merged without the fields), `packages/domain/src/rules/plan-open-questions.ts` (`openQuestionsChip`), `packages/domain/src/rules/you-header.ts` (`YouHeaderCount`), `packages/domain/src/index.ts` (exports); in the board, the two view builders that pass the new readings and render nothing: `packages/board/src/app/lib/agent-rows/delivery-view.ts` (`planRowFacts` call, `:513` on `89407abdc`, gets the phase and `now`) and `packages/board/src/app/lib/agent-rows/you-header.ts` (`youHeaderOf`); tests in `packages/domain/test/{delivery-row-form,release-plan-rows,todo-list,plan-open-questions,you-header}.test.ts` and `packages/board/test/unit/delivery-view.test.ts`. No component and no stylesheet.

  Why it waits on all six: it shares files with them. Measured 2026-11-18, #3530 (`feature/delivery-tab-todo-list`) changes `delivery-row-form.ts` and `domain/src/index.ts` and adds `todo-list.ts`, and #3532 (`feature/delivery-release-person-cards`) changes `delivery-view.ts` and `domain/src/index.ts`. `feature/delivery-release-card`, `feature/delivery-my-sprint-scope` and `feature/delivery-sprint-delivery-scope` have no PR yet and build the release card, the scope and Sprint delivery over `delivery-view.ts` and `release-plan-rows.ts`. Only `plan-open-questions.ts` and `you-header.ts` touch no open slice's file, and two fields do not earn a wave of their own.

  Done when — CI gates: each new field has a unit test that asserts its value for every case its type names; `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` and `pnpm run typecheck` pass; the existing tests pass. A reviewer judges: no `.tsx` file and no stylesheet changes.

### Primitives

- `feature/delivery-visual-primitives` <!-- waits: feature/delivery-tab-footer, feature/delivery-tab-todo-list, feature/delivery-release-card, feature/delivery-my-sprint-scope, feature/delivery-release-person-cards, feature/delivery-sprint-delivery-scope --> — the tokens in both themes, the primitives stylesheet and the per-section stylesheets, the section cards, header bars, group headings, visible header rows and row rules on every Delivery section, the role chip and dot colours on tokens, the theme contrast test, and the screenshot harness with its CI artifact <!-- builds: Delivery tab theme tokens, style primitives and a screenshot harness -->

  Owns: `packages/board/src/app/index.css` (the token blocks and the stylesheet imports), new `packages/board/src/app/styles/delivery.css` and the empty per-section files `styles/delivery-{header,release,you,work-items,fleet,bottom}.css`; in `AgentList.tsx` the section element, the header `h2` with its Fleet switches slot (`:1542-1552`), the group headings with their group tags (`:1680-1704`), the group grids, the Fleet counts line (`:1630-1639`), the Free line (`:1655-1677`), `MACHINE_DOT_CLASS` with `MachineSection`, the tab-header wrapper around the cards, the not-placed block, and the footer line's dots, while `YOU_MARKER_CLASS` (`:167-172`) stays unchanged; `lib/agent-rows/rows.tsx` `HeaderRow`; `TupleRow.tsx` the row `li` (`:689-703`) and the Do cell (`:845-862`); `components/SprintCard.tsx` and `components/FleetCard.tsx`, with the five-state colour map on the sprint bar and the fleet card's state; `RoleChip.tsx`; `FleetAgentRow.tsx` `FleetAgentHeader` only; the Tickets header row in `TicketsSection.tsx:81`; `test/catalogue/index.ts`, `test/catalogue/states.ts` (one new scenario), new `test/unit/theme-contrast.test.ts`, new `test/integration/delivery-tab-screenshots.browser.test.ts`; `.github/workflows/ci.yml` (one `select` output with its step, one env line and one upload step).

  Done when — CI gates: `theme-contrast.test.ts` passes in both themes; `delivery-tab-screenshots.browser.test.ts` passes, with no horizontal scroll at 320 px; the existing tests pass. A reviewer judges: every Delivery section renders inside its card with its header bar and visible column headers, in the look of `section-header.html`, from the `delivery-screenshots` artifact of the CI run on the PR head that the PR body links.

### Sections

Each branch below owns a disjoint set of files and one stylesheet, so the six run in parallel under one heading (Jan Wloka, 2026-11-18). `/plot-reconcile` section 7 reports this heading as an uncut slice, and that report is accepted. The six branches carry no `waits:` marker: they wait on *Primitives* by heading order alone, because the fleet starts a heading only when every earlier heading merged. None of the six edits `index.css`. Only `feature/delivery-visual-release` edits `AgentList.tsx`, and none edits `TupleRow.tsx` (re-checked 2026-11-18 after *Primitives* took the shared markup).

- `feature/delivery-visual-tab-header` — the to-do list with its marker tags and coloured verbs, the release card with its bar, legend and Approve button, the filter chips, and the two-column header layout that stacks below 768 px <!-- builds: the tab header cards in the mockups' look --> — Owns: `components/TodoList.tsx`, the release card component that `feature/delivery-release-card` adds (the slice names its path in the PR body at slice start), `components/DeliveryFilters.tsx` (the chip button at `:75-97`), `components/ReleaseApprove.tsx`, `styles/delivery-header.css`. The sprint card and the fleet card are *Primitives*'; this slice styles their layout in the header only through `styles/delivery-header.css`. Mockup: `first-five-seconds-v2.html`, `you-section-v2.html` (the to-do list). It reads the fields of item 4 under *Domain Fields*.
- `feature/delivery-visual-release` — the Release and Sprint delivery header bar, the plan rows as a table with Plan, Phase, Slices and Owner columns, the slice strip as one block per slice, the opened Done, In flight and To do lines, and the per-person cards <!-- builds: Release delivery rows and slice strip in the mockups' look --> — Owns: `AgentList.tsx` Release delivery block (`:1557-1629` on `89407abdc`), the per-person card component (`components/ReleasePersonCards.tsx` as #3532 adds it; the slice names the merged path in the PR body at slice start), `styles/delivery-release.css`. It styles the Phase chip and the relative merge time that *Domain fields* adds. Mockup: `delivery-toggle-icons-v2.html`, `plan-slices.html`. It reads the fields of items 2 and 3 under *Domain Fields*.
- `feature/delivery-visual-you` — the group tags for Blocks delivery, Input to the fleet and Unblock, coloured, the inset bar on each row in the group's colour, the Do verb in the group's colour, all through `data-group` selectors, the plan row's slice and question chips and first question, and the kind cell <!-- builds: the You section in the mockups' look --> — Owns: `lib/agent-rows/draft-plan-row.tsx`, `styles/delivery-you.css`. The tags, row bars and Do colours select on the existing `data-group` attribute only; the markup is *Primitives*'. Mockup: `you-section-v2.html`, `section-header.html`. It reads the fields of items 5 and 6 under *Domain Fields*.
- `feature/delivery-visual-work-items` — the gate marks, the Where cell with its branch beneath, the By cell with its chip, name and fixer attempt, and the group columns <!-- builds: Work items rows in the mockups' look --> — Owns: `components/DeliveryRows.tsx` (`RowCell`), `styles/delivery-work-items.css`. Mockup: `work-items-v1.html`. It reads the field of item 1 under *Domain Fields*.
- `feature/delivery-visual-fleet` — the agent rows with their dots, role chips, Acting on and Doing now cells, the Tokens and Time left columns with the draining bar, and the switches and stepper <!-- builds: Fleet rows and switches in the mockups' look --> — Owns: `components/FleetAgentRow.tsx` (`FleetAgentRow`), `components/FleetControls.tsx`, `styles/delivery-fleet.css`. The read-only switches on the fleet card take the same look, because they are the same components. The Free line, the counts line and the switches slot are *Primitives*' markup, styled here through `styles/delivery-fleet.css`. Mockup: `fleet-section-v3.html`.
- `feature/delivery-visual-bottom` — the Machine line with its dot and word and the strained table, the Tickets section with its Plan it column and its "… n more" line, and the footer with its freshness dots <!-- builds: Machine, Tickets and footer in the mockups' look --> — Owns: `components/TicketsSection.tsx` (except the header row *Primitives* owns), `styles/delivery-bottom.css`. The Machine section and the footer are styled through their existing `data-*` attributes in this stylesheet; their markup classes are *Primitives*'. Mockup: `bottom-of-tab.html`.

Done when, for each branch — CI gates: its browser tests and the existing ones pass, and the screenshot test finds no horizontal scroll at 320 px. A reviewer judges: the section matches its mockup within the spec's text, the dark theme against the mockup and the light theme by eye against the dark mockup, from the `delivery-screenshots` artifact of the CI run on the PR head that the PR body links.

## Notes

- 2026-11-18: plan written at the request of Jan Wloka. The eight mockups were copied from the writer's gitignored `.superpowers/brainstorm/20038-1794839570/content/` into `docs/superpowers/specs/2026-11-16-delivery-tab-mockups/`, and the spec's *Mockups* paragraph points there. The files were checked before the commit: no script, no URL, no e-mail address, no token; the only handles are `jwloka` and `eins78`, both in `People`.
- The six slices this plan waits on, at the time of writing: `feature/delivery-tab-footer` (#3507, open), `feature/delivery-tab-todo-list` (#3530, open), `feature/delivery-release-person-cards` (#3532, open), `feature/delivery-release-card`, `feature/delivery-my-sprint-scope` and `feature/delivery-sprint-delivery-scope` (no PR yet).
- 2026-11-18: Jan Wloka decided four open questions (see *Decisions*): one parallel Sections wave, a *Domain fields* slice before *Primitives*, the artifact link as the screenshot evidence, and 13 px rows with 11 px small text.
- 2026-11-18: round 1 of `/challenge-the-plan` (four jurors, all amend) raised twelve items; Jan Wloka answered all of them, and the plan resolves each under *Open Questions*.
