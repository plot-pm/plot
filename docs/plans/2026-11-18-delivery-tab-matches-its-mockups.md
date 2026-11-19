# The Delivery tab matches its mockups

> The Delivery tab gets the look of the approved brainstorm mockups, in the light and the dark theme, through twelve new domain fields, shared tokens and primitives, and one styling slice per section.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** bug-fixes-2-35-0
- **Issue:**
- **Story:** delivery-tab-reads-at-a-glance
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-11-18, Jan Wloka, plan-PR #3531 merged
- **Started:** 2026-11-19, Jan Wloka, `feature/delivery-domain-fields`
- **Started:** 2026-11-19, Jan Wloka, `feature/delivery-visual-primitives`
- **Started:** 2026-11-19, Jan Wloka, `feature/delivery-visual-tab-header`
- **Started:** 2026-11-19, Jan Wloka, `feature/delivery-visual-release`

## Changelog

- The Delivery tab looks like its design mockups: every section sits in its own card under a header bar that carries its counts, tables show their column headers, and role chips, state dots and slice strips share one palette in the light and the dark theme. Release delivery plan rows show each plan's phase, and a merged slice shows how long ago it merged.

<!-- Board impact: the board's look, plus the Phase column and the relative merge times in Release delivery. No change to the plan format, the plan template, the helper scripts or the docs/plans layout. The client bundle changes, and main rebuilds the board artifact after each merge. -->

## Motivation

The design [Delivery Tab Reads at a Glance](../superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md) has six plans, `docs/plans/2026-11-16-delivery-*.md`. They change what each section shows. They left *"Colours, spacing and the exact chip styles, within the board's existing palette"* to the builder (*Left to the Builder*), so the merged slices kept the tab's old styling. Jan Wloka approved the mockups as the look, and the tab does not look like them.

Measured on `main` at `89407abdc`, and re-checked at `b13b8852e`:

- No section is a card. Each group is its own bordered list (`rounded-lg border` at `AgentList.tsx:1685` and `:1724-1728` on `b13b8852e`), so a section reads as several boxes under a heading.
- No table shows its column headers. `HeaderRow` (`lib/agent-rows/rows.tsx:446-483`), `FleetAgentHeader` (`FleetAgentRow.tsx:5-14`) and the Tickets header (`TicketsSection.tsx:81`) are `sr-only`. The design says *"Columns carry headers"*.
- The Release delivery strip is text ("2 delivered 1 at-a-gate", `AgentList.tsx:1597-1602` on `b13b8852e`), not one block per slice.
- The colours are Tailwind palette classes written per component, for example `RoleChip.tsx:4-13`, `SprintCard.tsx:3-9`, `FleetCard.tsx:20-24` and `AgentList.tsx:13-18` and `:170-174`. The Plans tab cards already draw from theme tokens (`index.css:70-169`); the Delivery tab does not.
- The sprint bar colours a gate sky and a blocked slice amber (`SprintCard.tsx:3-9`). The mockups colour a gate amber and a blocked slice red.

## Design

### Approach

**The mockups are the target, and the spec text wins.** The eight mockups are committed beside the spec at `docs/superpowers/specs/2026-11-16-delivery-tab-mockups/`. Where a mockup and the spec text disagree, the spec text wins, as the spec says. Two known cases: the mockups show the fleet switches on the tab-header Fleet card as text ("auto-dispatch on · 3 parallel"), and the spec shows them read-only, so the read-only switches stay. The mockups label the toggle "This sprint", and the spec names it **My sprint**.

**Scope: styling and markup classes, plus twelve domain fields.** The styling slices change class names, CSS, and the markup that carries them: the section cards, the section header bars, the tab header cards (release card, sprint card, fleet card, to-do list), role and state chips, state dots, slice strip blocks, the tables (header row, column widths, row borders), the muted, link, ok, amber and red text colours, and spacing and typography. Outside the *Domain fields* slice, it adds no domain field. No slice adds a reading or a host call.

**No view state is decided in a `.tsx` file or in CSS.** CLAUDE.md, *Every rendered state is a domain property*, binds this plan. A class name or a CSS selector maps an existing domain field: a `SliceState`, a `YouMarker`, a `FleetCardState`, a `MachineDot`, a `FreshnessState`, a `ChipColour`, a group key or a count key. A map from a field to a class is a lookup table, like `YOU_MARKER_CLASS` today. A component never tests a string, a count or a threshold to choose a style. The mockups show seven states that the domain did not expose. The slice *Domain fields* adds them, twelve fields in all, as domain properties with unit tests (see *Domain Fields* below), so the styling slices map fields and compute nothing.

**Tokens, not hex.** Every colour comes from a custom property in `packages/board/src/app/index.css`, defined once for the light theme and once again under `@media (prefers-color-scheme: dark)`. The board has no other theme switch: `grep` finds no `data-theme` and no `@custom-variant` under `packages/board/src`. The Delivery tab uses the card tokens that the Plans tab already uses, so the two tabs share one palette. It also takes the Plans tab's words for colour: `Tone` and `Hue` (`packages/board/src/app/lib/card-presentation.ts:42-45`), from the released plan [one-card-grammar](2026-11-06-one-card-grammar.md). The Delivery classes are named after those values and draw on the same `--hue-<hue>`, `-dot` and `-soft` tokens that `Card.tsx`'s `hue()` helper (`Card.tsx:47`) names. They do not import `Card.tsx`'s `TONE` map (`:49-56`), because it is a component's private constant whose classes are Tailwind utilities.

**One stylesheet per section, so slices do not conflict.** The *Primitives* slice creates `packages/board/src/app/styles/delivery.css` for the primitives and one stylesheet per section, and imports all of them from `index.css` once. A later slice edits only its own stylesheet and never `index.css`. **The imports are unlayered**, directly after `@import "tailwindcss";` on `index.css:1` and before every other rule, so a section rule outranks a Tailwind utility (Tailwind 4 puts utilities in `@layer utilities`) where both set one property. The screenshot test asserts one computed style per stylesheet, so a stylesheet that the build drops or a layer that loses fails CI.

### Theme Tokens

The mockups are dark only. Each mockup colour maps to a token that exists in both themes. Contrast was recomputed on 2026-11-18 from `index.css` at `b13b8852e`: each `oklch()` value converted to sRGB, and each alpha value (the dark `-soft` values and the `--card-band`, `--card-panel` and `-strong` values) composited over `--card-surface`, the background every section card has. Every pair below reads at least 4.5:1, the WCAG AA level for body text, except light `--card-meta` on the two `-strong` backgrounds (4.35), which *Primitives* fixes (see the decisions below). The light margins are thin: green on its soft reads 4.72, and green on `--card-panel-strong` reads 4.51.

| Mockup colour | Use | Token | Light / dark contrast on `--card-surface` |
|---|---|---|---|
| `#0b1020`, border `#232c46` | section card (every mockup's `.dt` frame) | `--card-surface`, `--card-border` | — |
| `#131a2e`, border `#232c46` | tab-header card and to-do list (`first-five-seconds-v2.html:11`, `you-section-v2.html:26`) | `--card-surface`, `--card-border`; the mockups' step between frame and box is not reproduced | — |
| `#232c46` | header bar rule, table header rule | `--card-border` | — |
| `#1a2238` | row rule | **new** `--card-rule` | — |
| `#fff` | section title | `--card-title` | 17.84 / 17.05 |
| `#d7dbe7` | body text | `--card-body` | 10.34 / 12.02 |
| `#8a93a8`, `#6b7490` | muted text, column headers, kind cell, age | `--card-meta` | 4.77 / 6.79 (5.27 light after the darkening) |
| `#7aa2ff`, `#60a5fa` | links, input marker, Do verb | `--hue-blue` | 6.82 / 9.85 |
| `#4ade80` | ok, delivered, working | `--hue-green` | 4.94 / 12.76 |
| `#fbbf24` | amber, at a gate, fixer | `--hue-amber` | 5.05 / 12.34 |
| `#f87171` | red, blocks delivery | `--hue-red` | 6.42 / 9.29 |
| `#2a3352` on `#c9d2ea` | neutral chip | `--hue-slate-soft`, `--hue-slate` | 6.90 / 9.44 |
| `#3b2f10` on `#fbbf24` | warn chip, fixer chip | `--hue-amber-soft`, `--hue-amber` | 4.87 / 10.13 |
| `#132a4a` on `#60a5fa` | input tag, loop chip | `--hue-blue-soft`, `--hue-blue` | 6.26 / 8.20 |
| `#3a1418` on `#f87171` | blocks-delivery tag | `--hue-red-soft`, `--hue-red` | 5.88 / 8.05 |
| `#2d1f4a` on `#c4a7ff` | reviewer chip | `--hue-violet-soft`, `--hue-violet` | 6.64 / 8.29 |
| `#10302a` on `#5eead4` | brief chip | `--hue-teal-soft`, `--hue-teal` | 5.17 / 9.82 |
| `#132a4a`, `#10302a` | Phase chip | the Plans tab's `PHASE_ACCENT` (see the decisions) | non-text bar |
| `#2563eb` | Approve release button | `--card-primary` behind `--card-primary-text` | 5.26 / 5.36 (the button's text on it) |
| `#8a93a8` on a banded row | muted text on a band or panel | `--card-meta` on `--card-band`, `--card-panel` | 4.55 / 6.26 (band), 4.55 / 6.14 (panel) |
| — | muted text on a strong band or panel | `--card-meta` on `--card-band-strong`, `--card-panel-strong` | 4.35 / 5.69 (band), 4.35 / 5.04 (panel); 4.81 light after the darkening |
| `#232c46` | bar and strip track, not started | `--card-track` | — |
| dots | state dots | `--hue-<name>-dot` | non-text |

The decisions:

- **Two token families are added, both in both themes, and that deviates from the spec** (Jan Wloka, 2026-11-18). The spec's *Left to the Builder* says *"within the board's existing palette"* (spec line 241). `--card-rule` is a step of the existing slate scale and `--hue-rose` is a step of the Tailwind palette the other hues come from, so the deviation adds names, not new colours. `--card-rule` is the row rule, one step lighter than `--card-border`: slate-100 in light, `rgb(51 65 85 / 0.5)` in dark. `--hue-rose`, `--hue-rose-dot` and `--hue-rose-soft` serve the `design` role chip, because `ChipColour` names `rose` (`packages/domain/src/rules/agent-roles.ts:127`) and `index.css` has no rose hue. `ChipColour` `emerald` maps to the existing `--hue-green` set, and `sky` and `orange` map to the existing `--hue-sky` and `--hue-orange` sets, so no other family is added.
- **The five slice states take one colour map** for the sprint bar, the release bar, the per-person bars and the slice strip: delivered `--hue-green-dot`, at a gate `--hue-amber-dot`, being built `--hue-blue-dot`, blocked `--hue-red-dot`, not started `--card-track`. This follows the mockups and changes `SprintCard.tsx:3-9`, which colours a gate sky and a blocked slice amber. A header count takes the same map (Jan Wloka, 2026-11-18): the `being-built` count is blue, and `working`, a Fleet count and not a slice state, is green.
- **The role chip keeps the domain's colour keys.** The mockups colour `approver` teal and `idea` grey. The domain gives `approver` emerald and `idea` sky (`agent-roles.ts:136-145`), and `brief` already holds teal, so the mockups' colours would give two roles one chip. The board maps each `ChipColour` to `--hue-<colour>-soft` behind `--hue-<colour>` text.
- **One phase colour map: the Plans tab's `PHASE_ACCENT`** (Jan Wloka, 2026-11-18). `PHASE_ACCENT` (`packages/board/src/app/components/PlanCard.tsx:17-24`) colours Development green, Testing violet, Discovery sky, Design slate and Released orange, keyed by the accent that `phaseColumns` gives a phase (`packages/domain/src/rules/workflow-phases.ts:230-238`: the default phase's own name, or `neutral`). The Release slice exports it and draws the Phase chip as a neutral chip with a left bar in that class. No second map exists, the mockups' blue and teal are not used, and no component tests the word `Development`.
- **Light `--card-meta` is darkened everywhere** (Jan Wloka, 2026-11-18). Jan Wloka accepts the change on the Plans tab. It reads 4.35 on `--card-band-strong` and `--card-panel-strong`. *Primitives* changes the light value from `oklch(55.4% 0.046 257.417)` to `oklch(53% 0.046 257.417)`, which reads 5.27 on `--card-surface` and 4.81 on both `-strong` backgrounds. The token is shared, so the Plans tab's muted text in light darkens by the same step.
- **The token change stays inside the Delivery tab** (Jan Wloka, 2026-11-18), except the light `--card-meta` step above. The other `dark:` utilities in the board's components and the `prefers-color-scheme` block in `packages/board/src/server/board.ts:3723` stay as they are.
- **The light theme is reviewed by eye against the dark mockup** (Jan Wloka, 2026-11-18). The mockups are dark only, so no light mockup exists. A reviewer compares the light screenshot with the dark mockup for layout, hierarchy and colour roles; the contrast test covers the light theme's readability.
- **A gate (CSS) proves the contrast.** The *Primitives* slice adds `packages/board/test/unit/theme-contrast.test.ts`. It reads `index.css`, converts every `oklch()` and `rgb()` value, composites each alpha value over `--card-surface`, and asserts 4.5:1 for every text token on `--card-surface`, for every `--hue-<name>` on its `-soft`, for `--card-primary-text` on `--card-primary`, for `--card-meta` on every card background (`--card-surface`, `--card-band`, `--card-band-strong`, `--card-panel`, `--card-panel-strong`), and for `--hue-green` on `--card-panel-strong`, in both themes. A later token change that breaks AA fails the test.

### Primitives

The *Primitives* slice defines these classes in `styles/delivery.css`. The names below are the builder's call; the shapes are the mockups'.

- **Section card:** the section on `--card-surface` with a `--card-border` border, 0.5 rem radius (the existing `rounded-lg`), 1 rem padding, and 0.75 rem padding below 640 px.
- **Header bar:** the section title (15 px, semibold, `--card-title`), its glyph, and its counts on one wrapping line, with a `--card-border` rule beneath. A count shows its number in bold, then its words, in that order in every section (Jan Wloka, 2026-11-18): the domain gives each count a `count` and `words` (items 6 and 7 under *Domain Fields*), and the bar prints neither `text` nor `label`. A count's colour maps its section and key: `blocks-delivery` red, `input` blue, `at-a-gate` amber, `being-built` blue, `working` green, Release `delivered` green, Release `blocked` red, Fleet `blocked` amber, every other key the body colour.
- **Group heading, two variants** (Jan Wloka, 2026-11-18). *Plain*, for Work items and Fleet (`work-items-v1.html:10`, `fleet-section-v3.html:10`): 11 px uppercase with 0.06 em letter spacing in `--card-meta`. *Tagged*, for You (`you-section-v2.html:8`, `section-header.html:13`): 12 px, weight 650, `--card-body`, not uppercase, with the group's tag beside it. The tag's colour is the You slice's.
- **Chip:** 11 px, 1 px by 7 px padding, a full radius, `-soft` background behind the hue text. Tones: the `Tone` values `neutral`, `warn` and `alert`, and one per `Hue`; a `ChipColour` maps to its `Hue` as the decisions above say.
- **Dot:** a 7 px circle in a `-dot` colour. **Every dot sits beside its state as words** (the design's rule): a dot that has no visible word beside it carries `role="img"` and an `aria-label` with the word, as `MachineSection` does today (`AgentList.tsx:24`).
- **Strip:** one 18 by 8 px block per slice with a 3 px gap, in the five-state colour map.
- **Table:** the existing `role="grid"` lists stay. The header row becomes visible from 640 px up: 11 px uppercase `--card-meta`, a `--card-border` rule beneath. Rows take 0.5 rem padding and a `--card-rule` rule. Groups inside a section card lose their own border and radius. Below 640 px the header row stays hidden and the cells stack, as `max-sm:grid-cols-1` does today.
- **Text colours:** `muted` (`--card-meta`), link (`--hue-blue`), ok (`--hue-green`), `warn` (`--hue-amber`), `alert` (`--hue-red`), named after `Tone` where a `Tone` value exists.
- **Kind cell:** the cell `TupleRow.tsx:747-756` (`data-row-cell="kind"`) in 11 px uppercase `--card-meta`, in every section that shows it (Jan Wloka, 2026-11-18). It is shared by You and Work items rows, so its style lives here and not in a section stylesheet.
- **Tab-header columns** (Jan Wloka, 2026-11-18). *Primitives* wraps the tab-header cards (`AgentList.tsx:1484-1490` on `b13b8852e`) in `div[data-tab-header]` with two children: `div[data-tab-header-column="todo"]` holds the to-do list, and `div[data-tab-header-column="status"]` holds the release cards or the sprint card, then the fleet card, as `first-five-seconds-v2.html:55-74` nests them. The tab-header slice lays out the two columns in `styles/delivery-header.css`.
- **Type scale:** rows 13 px, section titles 15 px, column headers, kind cells, chips and group headings 11 px. The mockups use 10 px for column headers and kind cells; 11 px is the smallest size here (Jan Wloka, 2026-11-18, see *Decisions*). The Plans tab's meta text is 12 px (`one-card-grammar.md:596-597`); the Delivery tab's 11 px small text differs on purpose, because its tables are denser.

### Rules That Hold

- **No horizontal scroll at 320 px.** The screenshot test is the 320 px check: it opens every section at a 320 px viewport and asserts `document.documentElement.scrollWidth <= 320`. A *Sections* slice adds no second 320 px test. The tab header's two columns stack below 768 px. The Fleet header's switches wrap onto the next line.
- **Icons only from `glyphs.ts`.** No slice adds an SVG path; the section and item icons stay `sectionGlyph` and the `glyphs.ts` entries.
- **No abbreviated text where the row has room.** A cell that cannot hold its text cuts it at the end with an ellipsis and keeps the full text as its `title`, never in the middle. No slice shortens a label to fit a mockup width.
- **A dot carries its state as text too**, as *Primitives* states.

### Screenshots

**Each slice's PR body links CI's `delivery-screenshots` artifact, and that link counts as done.** The artifact holds the section in both themes beside its mockup. Nobody attaches images by hand, and no merge waits for images.

- The *Primitives* slice adds a `colorScheme` option to the catalogue's `open` (`packages/board/test/catalogue/index.ts:40-60` and `:209-215`), passed to Playwright's `browser.newContext`. The option exists in Playwright and the catalogue already passes `reducedMotion` the same way.
- The *Primitives* slice adds `packages/board/test/integration/delivery-tab-screenshots.browser.test.ts`. For each section it opens the mock board (`test/catalogue/mock-board.ts`, which serves the built client and no real board) in light and in dark at 1280 px, and at 320 px in one theme. It asserts that the section renders and that the page has no horizontal scroll. It also asserts one computed style from each section stylesheet, so a stylesheet missing from the built CSS fails it. Where `PLOT_SCREENSHOT_DIR` is set, it writes `<section>-light.png`, `<section>-dark.png` and `<section>-320.png` there, and renders each mockup file the section names to `<section>-mock-<n>.png` through `page.setContent`. The section-to-mockup map: tab header → `first-five-seconds-v2.html`, `you-section-v2.html`; Release delivery → `delivery-toggle-icons-v2.html`, `plan-slices.html`; You → `you-section-v2.html`, `section-header.html`; Work items → `work-items-v1.html`; Fleet → `fleet-section-v3.html`; Machine, Tickets and footer → `bottom-of-tab.html`; the whole tab → `section-header.html`. A section therefore has three images of its own and one or two mockup images.
- **Cost.** The test runs in every `board-integration` run, as one file among the board's browser files, at about 32 page renders. Only the PNG writes depend on `PLOT_SCREENSHOT_DIR`.
- The *Primitives* slice adds one catalogue scenario that fills every section: a release card, a sprint card, to-do lines of all three markers, Work items in all three groups, Fleet agents in Working, Blocked and Free, a strained Machine, tickets and a footer.
- `.github/workflows/ci.yml` sets `PLOT_SCREENSHOT_DIR` to `${{ runner.temp }}/delivery-screenshots` for the step *Board integration tests (vitest + Playwright)* (`ci.yml:1541-1543`) and uploads the directory as the artifact `delivery-screenshots` with `retention-days: 7`. The upload and the env line run only when the PR changes a Delivery-tab path (Jan Wloka, 2026-11-18). The path map has one home: `scripts/ci-job-map.jq` gains a `delivery` key beside `board` (`:22`), true where a changed path is under `packages/board/src/app`, `packages/board/test/catalogue` or `docs/superpowers/specs/2026-11-16-delivery-tab-mockups`, and true wherever every job runs. The *Map the selection to jobs* step already feeds that file the list that `git diff --name-only --no-renames HEAD^1 HEAD` writes to `$RUNNER_TEMP/changed.txt` (`ci.yml:200`, read at `:225`), and the `select` job's outputs (`ci.yml:126-141`) gain `delivery`. The job `board-integration` already `needs: [select, gates]` (`ci.yml:1305-1307`), so the env line and the upload read `needs.select.outputs.delivery`. A push to `main` uploads nothing.
- **A Delivery PR never reuses `board-integration`** (Jan Wloka, 2026-11-18). The job's condition (`ci.yml:1308`) skips it when `reuse_board` is set (`:142`, [ci-reuses-green-runs](2026-11-09-ci-reuses-green-runs.md)). It changes to run when `needs.select.outputs.delivery == 'true'` whatever `reuse_board` says, so the CI run on every head of a Delivery PR uploads its own artifact. The directory is outside the private `TMPDIR` that `scripts/owned-run.sh` creates and removes, so the leak check does not see it.
- **The link is the evidence.** The slice's PR body links the `delivery-screenshots` artifact of the CI run on the PR's head commit and names the four images per section in it. The link exists only after that run finishes and expires after 7 days; it is evidence for the reviewer, not a gate. The styling agent sees no render at its desk, so its first visual feedback is that CI run; that round trip is accepted (Jan Wloka, 2026-11-18). GitHub has no REST route that uploads an image into a PR body, and a fleet agent does not run the board's browser suites at its desk (CLAUDE.md, *Testing*), so the artifact link is the done-when (Jan Wloka, 2026-11-18). A reader opens the images with `gh run download <run> -n delivery-screenshots`.

### Tests and Selectors

- **The existing browser tests stay green, and their selectors stay.** Every `data-*` attribute, `role`, `aria-label` and `id` that the board renders today stays, with its value. A slice that moves markup moves the attribute with it.
- **Classes that tests read stay as they are.** `YOU_MARKER_CLASS` (`AgentList.tsx:170-174`, applied at `:1696-1698` on `b13b8852e`) stays on the group tag, so no class-reading test moves; the You slice's unlayered `data-group` rule overrides its colour, and the You slice's done-when asserts the tag's computed colour. These tests read a class name: in integration, `tuple-row.browser.test.ts:451-452` (the status word's `text-emerald-700`), `agents-tab.browser.test.ts:1292,1351,1355` (the link target's `ring-amber-400`), `dead-fetch.browser.test.ts:91,153` (`text-red-600`), `supervisor-badge.browser.test.ts`, `folded-plan-pr-fold.browser.test.ts` and `button-claims.browser.test.ts`; in unit, `agent-list.test.ts:1021` and `:1338-1550` (classes read from the `AgentList.tsx` source) and `tuple-row.test.ts:1234` (`text-emerald-700 dark:text-emerald-500`). Each slice reads this list against its own files before it changes a class. None of those elements is in this plan's scope, so no slice changes those classes. A slice that finds it must change one moves the test to a `data-*` attribute in the same PR and says so in the PR body.
- **The visible header row changes what `innerText` reads** for a grid. `agents-tab.browser.test.ts:890-905` and `:3730-3768` assert the column headers through `getByRole('columnheader')`, which reads the same with the row shown or hidden. The *Primitives* slice audits every grid `innerText` read in the integration tests (26 files read `innerText` on 2026-11-18), not only the files that name `columnheader`. CI runs those files on its PR; the slice fixes a test only where it asserted the `sr-only` placement itself, and names each fixed test in the PR body.

### Line Ranges

Measured on `main` at `b13b8852e`, the one baseline for this plan's line citations from round 2 on. #3530 merged at `393a68e62` and moved `AgentList.tsx` by 13 lines against `89407abdc`. Four open Delivery-tab slices remain, and they move these lines again. Each slice measures its ranges again at its start and names them in its PR body.

| File | Lines on `b13b8852e` | What is there |
|---|---|---|
| `packages/board/src/app/index.css` | 1 | `@import "tailwindcss";` |
| | 70-169 | the card and hue tokens, light then dark |
| `packages/board/src/app/components/AgentList.tsx` | 13-41 | `MACHINE_DOT_CLASS` and `MachineSection` |
| | 170-174 | `YOU_MARKER_CLASS` |
| | 1059-1069 | `DeliveryFilters` placement |
| | 1160 | the `placeMapping` call |
| | 1484-1490 | `FleetCard`, `SprintCard` and `TodoList` placement, the tab header |
| | 1497-1568 | the section header `h2`, its counts, the You phase strip and the Fleet switches slot (`:1556-1566`) |
| | 1570 | the section element |
| | 1572-1643 | Release delivery: release line, plan rows, strip, opened lines |
| | 1644-1656 | the Fleet counts line (`:1644-1653`) and the Machine section placement |
| | 1657-1738 | the groups: Free line (`:1669-1691`), group headings with You tags (`:1694-1718`), the group grids |
| | 1740-1764 | the not-placed block |
| | 1801-1838 | the footer line, which `feature/delivery-tab-footer` (#3507) rewrites |
| `packages/board/src/app/lib/agent-rows/rows.tsx` | 446-483 | `HeaderRow` |
| `packages/board/src/app/components/TupleRow.tsx` | 689-703 | the row `li` and its border |
| | 747-756 | the kind cell |
| | 845-847 | the `⋯` menu cell (`data-row-cell="do"`) |
| | 848-862 | the By cell wrapper (`data-row-cell="by"`) |
| `packages/board/src/app/components/DeliveryRows.tsx` | 30, 54 | `LINK_CLASS` and the Do verb (`data-row-do`) |
| | 65-97 | `RowCell`, the gate marks and the By cell's content |
| `packages/board/src/app/components/RoleChip.tsx` | 4-33 | `COLOUR_CLASS` and `RoleChip` |
| `packages/board/src/app/components/FleetAgentRow.tsx` | 5-71 | `FleetAgentHeader` and `FleetAgentRow` |
| `packages/board/src/app/components/FleetControls.tsx` | 77-300 | the switches and the parallel-agents stepper |
| `packages/board/src/app/components/FleetCard.tsx` | 20-71 | the fleet card |
| `packages/board/src/app/components/SprintCard.tsx` | 3-58 | the sprint card and its segment colours |
| `packages/board/src/app/components/TodoList.tsx` | 1-33 | the to-do list |
| `packages/board/src/app/components/PlanCard.tsx` | 17-24 | `PHASE_ACCENT` |
| `packages/board/src/app/components/DeliveryFilters.tsx` | 75-95 | the filter chip button |
| `packages/board/src/app/lib/agent-rows/draft-plan-row.tsx` | 33-75 | the You plan row's chips and first question |
| `packages/board/src/app/components/TicketsSection.tsx` | 37-132 | the Tickets section |
| `packages/board/src/app/lib/agent-rows/delivery-view.ts` | 162-185 | `SectionCount` and `summarise` |
| | 240, 513, 521-522, 530-534 | `ReleaseBlockView.header`, the `planRowFacts` call, the header string, `placeMapping` |
| `packages/board/test/catalogue/index.ts` | 40-60, 209-215 | the `open` options and `newContext` |
| `.github/workflows/ci.yml` | 126-142, 200, 225 | the `select` outputs, the changed-path list and the job map |
| | 1305-1308, 1541-1543 | `board-integration`'s condition and its test step |
| `scripts/ci-job-map.jq` | 17-29 | the job keys |

Two components do not exist on `main` yet: the release card arrives with `feature/delivery-release-card` (claimed, no PR on 2026-11-18), and the per-person cards arrive with `feature/delivery-release-person-cards` (#3532).

### Domain Fields

Each item is a state a mockup styles that the domain did not expose on `main` at `b13b8852e`. The *Domain fields* slice adds each one as a domain property with a unit test, before *Primitives*: **seven items, twelve fields**. No slice computes one of them in a component. *Domain fields* changes no text that the tab renders today; the styling slices render the new fields.

**Items 2 and 3 close a gap in a delivered sibling slice** (Jan Wloka, 2026-11-18). The sibling plan [delivery-release-progress-per-plan](2026-11-16-delivery-release-progress-per-plan.md) specifies the Phase column (`:21`, `:47`) and "merged 2 days ago" (`:54`). Its plan-rows slice merged as #3525 without either: on `main` at `b13b8852e`, `release-plan-rows.ts` has no phase and `doneDetail` writes `mergedAt.slice(0, 10)` (`:106`). Its two other slices build neither: #3532 (person cards) adds `release-person-cards.ts` and changes `sprint-card.ts` and `delivery-view.ts` with no phase and no relative time, and `feature/delivery-sprint-delivery-scope` builds the Sprint delivery scope. So *Domain fields* adds both. If the sprint-scope slice lands either field first, *Domain fields* adds nothing for it and says so in its PR body.

1. **A gate mark has no outcome. One field.** `CellPart` (`packages/domain/src/rules/delivery-row-form.ts:58-61`) carries `value` and `link`. The mockups colour `CI ⟳` amber, `CI ✗` red and `review –` muted. Added: `CellPart.outcome`, one of `pass`, `pending`, `fail` or `none`. `gatesCell` (`:267-283`) sets it from `gateMarks` (`:247`), and the outcome comes from `PrReading.ci` and `PrReading.review` (`delivery-placement.ts:39-42`), never from the glyph in `GATE_MARK` (`delivery-row-form.ts:175`). The Status cell's `gateValue` string (`:226-233`) gets no outcome, because the Work items gate column reads `gatesCell`.
2. **A Release delivery plan row has no phase. Two fields.** `PlanRowFacts` (`packages/domain/src/rules/release-plan-rows.ts:143-152`) has no phase, and the design names the columns Plan · Phase · Slices · Owner. Added: `PlanRowFacts.phase`, the plan's workflow phase word, which the board already holds on each row (`AgentRow.phase`, read through `mapping.rowsByItem`), and `PlanRowFacts.accent`, the default phase's own name or `neutral`, by the rule that `phaseColumns` applies (`workflow-phases.ts:236`). The Phase chip maps `accent` through `PHASE_ACCENT`.
3. **An opened plan line has no state. Three fields.** `PlanLine` (`release-plan-rows.ts:113-122`) carries `heading` and one `text`. The mockups colour `✓ merged` green, `⟳ at CI` amber and `● building` blue, and they link the slice and the PR apart. Added: `PlanLine.state` (the `SliceState`), `PlanLine.pr` (the PR number, or absent), and `PlanLine.merged`, the relative merge time. `PlanLine.text` keeps the ISO date, and `release-plan-rows.test.ts:45` keeps asserting it.
   - **The formatter is `storyDateText`** (`packages/domain/src/rules/story-date.ts:12`, exported from `domain/src/index.ts:54`), reused unchanged, so no fourth formatter is written. `relativeAge` (`card-presentation.ts:559`) is board-side, and the domain cannot import it. `ageInWords` (`default-branch.ts:380`) abbreviates ("3 d ago"), and the spec forbids abbreviated text.
   - **The cases, one unit test each:** no `mergedAt`, or one that does not parse → `merged` is absent; the same day → `merged today`; one day → `merged yesterday`; 2 to 6 days → `merged N days ago`; 7 to 29 days → `merged N weeks ago`; 30 days or more → `merged <date>` in `toLocaleDateString()` form, which the test computes the same way (Jan Wloka, 2026-11-18, accepts the locale-dependent date); a `mergedAt` later than `now` → `merged today`, because the slice clamps `now` before it calls `storyDateText`. The formatter counts whole days, so minutes and hours read `today`.
4. **A to-do line is one string. Two fields.** `TodoLine` (`packages/domain/src/rules/todo-list.ts`, on `main` since #3530 merged at `393a68e62`) carries `text` ("Approve my-plan"). #3530 merged without a verb or a label field, so *Domain fields* adds `TodoLine.verb` and `TodoLine.label` beside `text`. The mockups colour the verb by its marker and link the item name in bold.
5. **The open-questions chip has no tone. One field.** `openQuestionsChip` (`packages/domain/src/rules/plan-open-questions.ts:46`) returns the chip's text. Added: its tone, a `Tone` value: `warn` where a question is open and `neutral` where none is.
6. **A header count has no words apart from its number. Two fields.** `YouHeaderCount` (`packages/domain/src/rules/you-header.ts:12-19`) carries `count` and `text`, and `text` holds the number too. `SectionCount` (`lib/agent-rows/delivery-view.ts:162-170`) carries `label` and a `text` whose number comes first in Work items and last elsewhere (`summarise`, `:178-185`). Added: `YouHeaderCount.words` and `SectionCount.words`, the words that follow the number, so the header bar prints the number first in every section and decides no order.
7. **The Release header is one string. One field.** `ReleaseBlockView.header` (`delivery-view.ts:240`) is built as `headerText(headerCounts(plans), …)` and joined with the ticket wording (`:521-522`). Added: `ReleaseBlockView.counts`, a list of `{key, count, words}` (keys `plans`, `delivered`, `blocked`, `unread`) from a new `headerCountParts` beside `headerCounts` (`release-plan-rows.ts:215`), in the same shape as item 6. The string stays beside it.

### Decisions

- **One parallel Sections wave** (Jan Wloka, 2026-11-18). The six section branches sit under one heading, *Sections*, so they run in parallel. A `###` heading is a slice, and the fleet starts a later slice only when every earlier slice merged (`plot-fleet-scan.sh:237-241`). `/plot-reconcile` section 7 reports the *Sections* heading as an uncut slice, and that report is accepted.
- **A domain slice closes the gaps first** (Jan Wloka, 2026-11-18). *Domain fields* is its own wave before *Primitives* and adds the seven items under *Domain Fields*, twelve fields, as domain properties with unit tests.
- **The artifact link is the screenshot evidence** (Jan Wloka, 2026-11-18). A slice's PR body links CI's `delivery-screenshots` artifact, and that link counts as done. Nobody attaches images by hand, and no merge waits for that.
- **Type size** (Jan Wloka, 2026-11-18). Rows are 13 px. Column headers, kind cells, chips and group headings are 11 px.
- **Light `--card-meta` darkens on every tab** (Jan Wloka, 2026-11-18). *Primitives* changes the shared light token to `oklch(53% 0.046 257.417)`, and the Plans tab's muted text in light darkens with it; see *Theme Tokens*.
- **A merge older than 30 days shows a locale date** (Jan Wloka, 2026-11-18). The relative merge time reuses `storyDateText` unchanged, so past 30 days it reads `merged <date>` in `toLocaleDateString()` form; see item 3 under *Domain Fields*.

### Open Questions

Round 1 of `/challenge-the-plan` raised the checked items below. Jan Wloka answered all of them on 2026-11-18, and the slices follow the answers. Round 2 raised the items marked *Round 2*; Jan Wloka answered them on 2026-11-18 as well, deciding four himself and the rest as each juror suggested.

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
- [x] **Round 2: Release header counts.** Item 7 under *Domain Fields* adds `ReleaseBlockView.counts`. *(contradiction, deliverable)*
- [x] **Round 2: `now` reaches `planRowFacts` through a component.** *Domain fields* adds a `now` parameter to `placeMapping` (`delivery-view.ts:530-534`) and changes its one call (`AgentList.tsx:1160` on `b13b8852e`, `:1147` on `89407abdc`) to pass `Date.now()`, as the same component already does for `rowFormsOf` (`:1166`). The phase needs no component change. The relative time refreshes with each render. *(estate, deliverable, cost)*
- [x] **Round 2: the screenshot artifact can be absent.** A Delivery PR never reuses `board-integration`; see *Screenshots*. *(estate, deliverable, cost)*
- [x] **Round 2: the Phase colour has two homes.** One map, the Plans tab's `PHASE_ACCENT`, keyed by the `phaseColumns` accent. *(estate)*
- [x] **Round 2: reuse what exists.** Item 3 reuses `storyDateText`; the primitives take the `Tone` and `Hue` words and tokens. *(estate)*
- [x] **Round 2: item 1 names the wrong builder.** Item 1 names `gatesCell` and `gateMarks`. *(estate)*
- [x] **Round 2: the Do cell range names the By cell.** *Primitives* owns the menu cell (`TupleRow.tsx:845-847`) and the By cell wrapper (`:848-862`). *Work items* owns the By cell's content through `RowCell` and keeps `LINK_CLASS` on `data-row-do` (`DeliveryRows.tsx:30`, `:54`) unchanged. You colours `[data-group] [data-row-do]` in `delivery-you.css`. *(contradiction)*
- [x] **Round 2: the group colour still has two homes in the cascade.** The section stylesheets are imported unlayered, so the `data-group` rule is the one visible home and `YOU_MARKER_CLASS` is a dead second one; the You slice asserts the computed colour. *(contradiction, deliverable)*
- [x] **Round 2: "being built" takes two colours.** The `being-built` count is blue. *(contradiction)*
- [x] **Round 2: the group heading style matches two of four sections.** *Primitives* has a plain and a tagged variant. *(contradiction)*
- [x] **Round 2: the token table maps the section card to the wrong mockup colour.** The row is split. *(contradiction)*
- [x] **Round 2: new tokens against the spec's "existing palette".** Recorded as a decision under *Theme Tokens*. *(contradiction)*
- [x] **Round 2: the kind cell appears in every section.** Its style moves to *Primitives*. *(contradiction)*
- [x] **Round 2: the changelog and the board-impact comment omit two visible changes.** Both now name the Phase column and the relative merge time. *(deliverable)*
- [x] **Round 2: the tab-header column markup has no owner.** *Primitives* builds the two column containers. *(deliverable)*
- [x] **Round 2: the relative merge time has no testable case list, and the header bar decides word order.** Item 3 lists the cases; item 6 gives every count its `words`, number first. *(deliverable)*
- [x] **Round 2: one mockup image per section; "six fields" counts eight.** The screenshot test renders every mockup a section names; the plan counts seven items and twelve fields. *(deliverable)*
- [x] **Round 2: the schedule and the dependency claim.** The Notes state the chain. *Domain fields* drops its waits on `feature/delivery-tab-footer`, which shares no file with it, and on `feature/delivery-tab-todo-list`, which merged. *(cost)*
- [x] **Round 2: the contrast gate covers an enumerated list.** The test asserts `--card-meta` on every card background and green on `--card-panel-strong`, and light `--card-meta` is darkened to pass. *(cost)*
- [x] **Round 2: smaller cost and cite items.** The test's cost is stated; the diff is cited at `ci.yml:200` with its file; the `delivery` key goes in `scripts/ci-job-map.jq`; the missing render at the desk is accepted; the screenshot test asserts one computed style per stylesheet, which proves that the built CSS holds them. *(cost, estate)*

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

- `feature/delivery-domain-fields` <!-- waits: feature/delivery-release-card, feature/delivery-my-sprint-scope, feature/delivery-release-person-cards, feature/delivery-sprint-delivery-scope --> — the twelve fields of the seven items under *Domain Fields*: the gate-mark outcome, the plan row's phase and accent, the opened plan line's slice state, PR number and relative merge time, the to-do line's verb and label, the open-questions tone, the header counts' words, and the Release header counts, each with a unit test <!-- builds: domain fields for the Delivery tab's styled states --> → #3541

  Owns: `packages/domain/src/rules/delivery-row-form.ts` (`CellPart`, `gatesCell`, `gateMarks`), `packages/domain/src/rules/release-plan-rows.ts` (`PlanRowFacts`, `PlanLine`, `headerCountParts`), `packages/domain/src/rules/todo-list.ts` (`TodoLine`), `packages/domain/src/rules/plan-open-questions.ts` (`openQuestionsChip`), `packages/domain/src/rules/you-header.ts` (`YouHeaderCount`), `packages/domain/src/index.ts` (exports); in the board, the view builders that pass the new readings and render nothing: `packages/board/src/app/lib/agent-rows/delivery-view.ts` (`SectionCount`, `summarise`, `ReleaseBlockView`, the `planRowFacts` call at `:513`, and a `now` parameter on `placeMapping` at `:530-534`) and `packages/board/src/app/lib/agent-rows/you-header.ts` (`youHeaderOf`); one line of a component, `AgentList.tsx:1160` on `b13b8852e`, where the `placeMapping` call passes `Date.now()`; tests in `packages/domain/test/{delivery-row-form,release-plan-rows,todo-list,plan-open-questions,you-header}.test.ts` and `packages/board/test/unit/delivery-view.test.ts`. No stylesheet.

  Why it waits on four slices: it shares files with them. Measured 2026-11-18, #3532 (feature/delivery-release-person-cards) changes `delivery-view.ts` and `domain/src/index.ts`, and feature/delivery-release-card, feature/delivery-my-sprint-scope and feature/delivery-sprint-delivery-scope have no PR yet and build the release card, the scope and Sprint delivery over `delivery-view.ts`, `release-plan-rows.ts` and `AgentList.tsx`. It does not wait on feature/delivery-tab-footer (#3507), which changes `footer-fact.ts`, `contract/schema.ts`, `server/fleet.ts`, tests, and `AgentList.tsx` lines it does not touch, and none of its own files. feature/delivery-tab-todo-list merged as #3530. Only `plan-open-questions.ts` and `you-header.ts` touch no open slice's file, and two fields do not earn a wave of their own.

  Done when — CI gates: each new field has a unit test that asserts its value for every value its type names, and the relative merge time has one test per case listed under item 3; `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` and `pnpm run typecheck` pass; the existing tests pass. A reviewer judges: the only `.tsx` change is the `Date.now()` argument at the one `placeMapping` call, no stylesheet changes, and the tab renders nothing new.

### Primitives

- `feature/delivery-visual-primitives` <!-- waits: feature/delivery-tab-footer, feature/delivery-release-card, feature/delivery-my-sprint-scope, feature/delivery-release-person-cards, feature/delivery-sprint-delivery-scope --> — the tokens in both themes, the primitives stylesheet and the per-section stylesheets, the section cards, header bars with bold counts, both group-heading variants, the kind cell, the tab-header columns, visible header rows and row rules on every Delivery section, the role chip and dot colours on tokens, the theme contrast test, and the screenshot harness with its CI artifact <!-- builds: Delivery tab theme tokens, style primitives and a screenshot harness --> → #3542

  Owns: `packages/board/src/app/index.css` (the token blocks and the stylesheet imports), new `packages/board/src/app/styles/delivery.css` and the empty per-section files `styles/delivery-{header,release,you,work-items,fleet,bottom}.css`; in `AgentList.tsx` the section element, the header `h2` with its counts, which render items 6 and 7's `count` and `words` for every section but Release delivery, and its Fleet switches slot (`:1556-1566`), the group headings with their group tags (`:1694-1718`), the group grids, the Fleet counts line (`:1644-1653`), the Free line (`:1669-1691`), `MACHINE_DOT_CLASS` with `MachineSection`, the tab-header wrapper and its two columns (`:1484-1490`), the not-placed block, and the footer line's dots, while `YOU_MARKER_CLASS` (`:170-174`) stays unchanged (all on `b13b8852e`); `lib/agent-rows/rows.tsx` `HeaderRow`; `TupleRow.tsx` the row `li` (`:689-703`), the kind cell (`:747-756`), the menu cell (`:845-847`) and the By cell wrapper (`:848-862`); `components/SprintCard.tsx` and `components/FleetCard.tsx`, with the five-state colour map on the sprint bar and the fleet card's state; `RoleChip.tsx`; `FleetAgentRow.tsx` `FleetAgentHeader` only; the Tickets header row in `TicketsSection.tsx:81`; `test/catalogue/index.ts`, `test/catalogue/states.ts` (one new scenario), new `test/unit/theme-contrast.test.ts`, new `test/integration/delivery-tab-screenshots.browser.test.ts`; `scripts/ci-job-map.jq` (the `delivery` key); `.github/workflows/ci.yml` (the `delivery` output, the `board-integration` condition, one env line and one upload step).

  Done when — CI gates: `theme-contrast.test.ts` passes in both themes; `delivery-tab-screenshots.browser.test.ts` passes, with no horizontal scroll at 320 px and one computed style asserted per section stylesheet; the existing tests pass. A reviewer judges: every Delivery section renders inside its card with its header bar and visible column headers, in the look of `section-header.html`, from the `delivery-screenshots` artifact of the CI run on the PR head that the PR body links.

### Sections

Each branch below owns a disjoint set of files and one stylesheet, so the six run in parallel under one heading (Jan Wloka, 2026-11-18). `/plot-reconcile` section 7 reports this heading as an uncut slice, and that report is accepted. The six branches carry no `waits:` marker: they wait on *Primitives* by heading order alone, because the fleet starts a heading only when every earlier heading merged. None of the six edits `index.css`. Only feature/delivery-visual-release edits `AgentList.tsx`, and none edits `TupleRow.tsx` (re-checked 2026-11-18 on `b13b8852e` after *Primitives* took the shared markup, the kind cell and the By wrapper).

- `feature/delivery-visual-tab-header` — the to-do list with its marker tags and coloured verbs, the release card with its bar, legend and Approve button, the filter chips, and the two-column header layout that stacks below 768 px <!-- builds: the tab header cards in the mockups' look --> — Owns: `components/TodoList.tsx`, the release card component that `feature/delivery-release-card` adds (the slice names its path in the PR body at slice start), `components/DeliveryFilters.tsx` (the chip button at `:75-97`), `components/ReleaseApprove.tsx`, `styles/delivery-header.css`. The sprint card and the fleet card are *Primitives*'; this slice styles their layout in the header only through `styles/delivery-header.css`. It lays out the two tab-header columns that *Primitives* builds. Mockup: `first-five-seconds-v2.html`, `you-section-v2.html` (the to-do list). It reads the fields of item 4 under *Domain Fields*.
- `feature/delivery-visual-release` — the Release and Sprint delivery header bar with its bold counts, the plan rows as a table with Plan, Phase, Slices and Owner columns, the slice strip as one block per slice, the opened Done, In flight and To do lines, and the per-person cards <!-- builds: Release delivery rows and slice strip in the mockups' look --> — Owns: `AgentList.tsx` Release delivery block (`:1572-1643` on `b13b8852e`), `components/PlanCard.tsx:17` (the `export` keyword on `PHASE_ACCENT`, no value change), the per-person card component (`components/ReleasePersonCards.tsx` as #3532 adds it; the slice names the merged path in the PR body at slice start), `styles/delivery-release.css`. It renders the Phase chip through `PHASE_ACCENT` and the relative merge time that *Domain fields* adds. Mockup: `delivery-toggle-icons-v2.html`, `plan-slices.html`. It reads the fields of items 2, 3 and 7 under *Domain Fields*.
- `feature/delivery-visual-you` — the group tags for Blocks delivery, Input to the fleet and Unblock, coloured, the inset bar on each row in the group's colour, the Do verb in the group's colour, all through `data-group` selectors, the tagged group heading's tag, and the plan row's slice and question chips and first question <!-- builds: the You section in the mockups' look --> — Owns: `lib/agent-rows/draft-plan-row.tsx`, `styles/delivery-you.css`. The tags, row bars and Do colours select on the existing `data-group` attribute only, including `[data-group] [data-row-do]` for the Do verb; the markup is *Primitives*', and the kind cell's style is *Primitives*'. Its done-when adds one CI assertion: the computed colour of a `data-group-marker` under Blocks delivery equals `--hue-red`. Mockup: `you-section-v2.html`, `section-header.html`. It reads the field of item 5 under *Domain Fields*.
- `feature/delivery-visual-work-items` — the gate marks, the Where cell with its branch beneath, the By cell with its chip, name and fixer attempt, and the group columns <!-- builds: Work items rows in the mockups' look --> — Owns: `components/DeliveryRows.tsx` (`RowCell`, the By cell's content), `styles/delivery-work-items.css`. It keeps `LINK_CLASS` on `data-row-do` (`DeliveryRows.tsx:30`, `:54`) unchanged, because the You slice colours the Do verb. Mockup: `work-items-v1.html`. It reads the field of item 1 under *Domain Fields*.
- `feature/delivery-visual-fleet` — the agent rows with their dots, role chips, Acting on and Doing now cells, the Tokens and Time left columns with the draining bar, and the switches and stepper <!-- builds: Fleet rows and switches in the mockups' look --> — Owns: `components/FleetAgentRow.tsx` (`FleetAgentRow`), `components/FleetControls.tsx`, `styles/delivery-fleet.css`. The read-only switches on the fleet card take the same look, because they are the same components. The Free line, the counts line and the switches slot are *Primitives*' markup, styled here through `styles/delivery-fleet.css`. Mockup: `fleet-section-v3.html`.
- `feature/delivery-visual-bottom` — the Machine line with its dot and word and the strained table, the Tickets section with its Plan it column and its "… n more" line, and the footer with its freshness dots <!-- builds: Machine, Tickets and footer in the mockups' look --> — Owns: `components/TicketsSection.tsx` (except the header row *Primitives* owns), `styles/delivery-bottom.css`. The Machine section and the footer are styled through their existing `data-*` attributes in this stylesheet; their markup classes are *Primitives*'. Mockup: `bottom-of-tab.html`.

Done when, for each branch — CI gates: its browser tests and the existing ones pass, and the screenshot test passes, with no horizontal scroll at 320 px. A reviewer judges: the section matches its mockup within the spec's text, the dark theme against the mockup and the light theme by eye against the dark mockup, from the `delivery-screenshots` artifact of the CI run on the PR head that the PR body links.

## Notes

- 2026-11-18: plan written at the request of Jan Wloka. The eight mockups were copied from the writer's gitignored `.superpowers/brainstorm/20038-1794839570/content/` into `docs/superpowers/specs/2026-11-16-delivery-tab-mockups/`, and the spec's *Mockups* paragraph points there. The files were checked before the commit: no script, no URL, no e-mail address, no token; the only handles are `jwloka` and `eins78`, both in `People`.
- The slices this plan waits on, on 2026-11-18 at `b13b8852e`: `feature/delivery-tab-footer` (#3507, open), `feature/delivery-release-person-cards` (#3532, open), `feature/delivery-release-card` (claimed, no PR), `feature/delivery-my-sprint-scope` and `feature/delivery-sprint-delivery-scope` (no branch). `feature/delivery-tab-todo-list` merged as #3530 at `393a68e62`.
- **Schedule.** The critical path is serial: `feature/delivery-release-card` → `feature/delivery-my-sprint-scope` → `feature/delivery-sprint-delivery-scope` → *Domain fields* → *Primitives* → *Sections*, six merges from 2026-11-18. The round-2 cost juror counted seven, with `feature/delivery-tab-todo-list` first, which has merged since. Two of the six, the scope slices, have no branch yet.
- 2026-11-18: Jan Wloka decided four open questions (see *Decisions*): one parallel Sections wave, a *Domain fields* slice before *Primitives*, the artifact link as the screenshot evidence, and 13 px rows with 11 px small text.
- 2026-11-18: round 1 of `/challenge-the-plan` (four jurors, all amend) raised twelve items; Jan Wloka answered all of them, and the plan resolves each under *Open Questions*.
- 2026-11-18: round 2 of `/challenge-the-plan` (four jurors, all amend) raised twenty items. Jan Wloka decided four (the Release header counts, the `now` call site, no reuse for Delivery PRs, `PHASE_ACCENT` as the one phase map) and answered the rest as each juror suggested; the line citations were re-measured on `main` at `b13b8852e`.
