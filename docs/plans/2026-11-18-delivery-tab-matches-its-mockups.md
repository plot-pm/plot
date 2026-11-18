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
- **Rounds:** 1

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

The mockups are dark only. Each mockup colour maps to a token that exists in both themes. Contrast was measured on 2026-11-18 from `index.css` by converting each `oklch()` value to sRGB, with the dark `-soft` values composited over `--card-surface`: every pair below reads at least 4.5:1, the WCAG AA level for body text.

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
| `#2563eb` | Approve release button | `--card-primary` | 5.26 / 4.74 (its text) |
| `#232c46` | bar and strip track, not started | `--card-track` | — |
| dots | state dots | `--hue-<name>-dot` | non-text |

The decisions:

- **Two token families are added, both in both themes.** `--card-rule` is the row rule, one step lighter than `--card-border`: slate-100 in light, `rgb(51 65 85 / 0.5)` in dark. `--hue-rose`, `--hue-rose-dot` and `--hue-rose-soft` serve the `design` role chip, because `ChipColour` names `rose` (`packages/domain/src/rules/agent-roles.ts:127`) and `index.css` has no rose hue. `ChipColour` `emerald` maps to the existing `--hue-green` set, so no emerald family is added.
- **The five slice states take one colour map** for the sprint bar, the release bar, the per-person bars and the slice strip: delivered `--hue-green-dot`, at a gate `--hue-amber-dot`, being built `--hue-blue-dot`, blocked `--hue-red-dot`, not started `--card-track`. This follows the mockups and changes `SprintCard.tsx:3-9`, which colours a gate sky and a blocked slice amber.
- **The role chip keeps the domain's colour keys.** The mockups colour `approver` teal and `idea` grey. The domain gives `approver` emerald and `idea` sky (`agent-roles.ts:136-145`), and `brief` already holds teal, so the mockups' colours would give two roles one chip. The board maps each `ChipColour` to `--hue-<colour>-soft` behind `--hue-<colour>` text.
- **A gate (CSS) proves the contrast.** The *Primitives* slice adds `packages/board/test/unit/theme-contrast.test.ts`. It reads `index.css`, converts every `oklch()` and `rgb()` value, composites each alpha value over `--card-surface`, and asserts 4.5:1 for every text token on `--card-surface` and for every `--hue-<name>` on its `-soft`, in both themes. A later token change that breaks AA fails the test.

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
- `.github/workflows/ci.yml` sets `PLOT_SCREENSHOT_DIR` to `${{ runner.temp }}/delivery-screenshots` for the step *Board integration tests (vitest + Playwright)* (`ci.yml:1541-1543`) and uploads the directory as the artifact `delivery-screenshots` with `if: ${{ !cancelled() }}`. The directory is outside the private `TMPDIR` that `scripts/owned-run.sh` creates and removes, so the leak check does not see it.
- **The link is the evidence.** The slice's PR body links the `delivery-screenshots` artifact of its latest CI run and names the four images per section in it. GitHub has no REST route that uploads an image into a PR body, and a fleet agent does not run the board's browser suites at its desk (CLAUDE.md, *Testing*), so the artifact link is the done-when (Jan Wloka, 2026-11-18). A reader opens the images with `gh run download <run> -n delivery-screenshots`.

### Tests and Selectors

- **The existing browser tests stay green, and their selectors stay.** Every `data-*` attribute, `role`, `aria-label` and `id` that the board renders today stays, with its value. A slice that moves markup moves the attribute with it.
- **Classes that tests read stay as they are.** Five integration files read a class name: `tuple-row.browser.test.ts:451-452` (the status word's `text-emerald-700`), `agents-tab.browser.test.ts:1292,1351,1355` (the link target's `ring-amber-400`), `supervisor-badge.browser.test.ts`, `folded-plan-pr-fold.browser.test.ts` and `button-claims.browser.test.ts`. None of those elements is in this plan's scope, so no slice changes those classes. A slice that finds it must change one moves the test to a `data-*` attribute in the same PR and says so in the PR body.
- **The visible header row changes what `innerText` reads** for a grid. `agents-tab.browser.test.ts:890-905` and `:3730-3768` assert the column headers through `getByRole('columnheader')`, which reads the same with the row shown or hidden. The *Primitives* slice runs the delivery browser files that name `columnheader` or read a grid's `innerText` and fixes a test only where it asserted the `sr-only` placement itself.

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

- [ ] **Type.** The Type was set to `feature` without a question, because the request came through an agent. Change it if the look belongs under another Type.

- [ ] **Owners for markup no slice owns.** The Free line, the Fleet counts line and switches slot, the group tags and the Do verb sit in `AgentList.tsx` or `TupleRow.tsx`, and the plan says only `feature/delivery-visual-release` edits `AgentList.tsx`. Name an owner or a disjoint range for each, or move the hooks into *Primitives*. *(panel round 1: contradiction, deliverable)*
- [ ] **Owners for the colour map's consumers.** The five-state map changes `SprintCard.tsx` and `FleetCard.tsx`, which *Primitives* does not own. Name who applies it to the sprint bar, the release bar and the strip. *(contradiction)*
- [ ] **Two homes for the group colour.** `YOU_MARKER_CLASS` stays in *Primitives* while the You slice colours bars and Do verbs through `data-group` selectors. Pick one. *(contradiction)*
- [ ] **Paths for components that do not exist yet.** The release card and the per-person card have no file path in any `Owns`. Name them at slice start or say the PR body names them. *(deliverable)*
- [ ] **Owner of Phase and the relative merge time.** `delivery-release-progress-per-plan.md:21,47,54` already specifies both. State whether *Domain fields* closes a gap in a delivered sibling slice or whether a sibling slice builds them. *(estate)*
- [ ] **Class-reading tests, complete inventory.** Add `dead-fetch.browser.test.ts:91,153` and the unit tests (`agent-list.test.ts:1021,1338-1550`, `tuple-row.test.ts:1234`). Widen the *Primitives* audit from `columnheader` to every grid `innerText` read (26 integration files). *(contradiction, cost)*
- [ ] **The artifact link is not a gate.** The link exists only after CI finishes, can trail an auto-merge, and expires. Say it is a link to the run on the PR head, and which clause a reviewer judges versus CI. *(cost, deliverable)*
- [ ] **Screenshot upload weight.** Every PR that runs the board integration tests uploads the PNGs. Give a measured size, set `retention-days`, or scope the upload. *(cost)*
- [ ] **Contrast figures and gate scope.** The dark `-soft` figures and `--card-primary` (5.36, not 4.74) differ from a recomputation; all pass 4.5. Light margins are thin (green on soft 4.72). Add `--card-meta` on `--card-band` and `--card-panel` to the asserted pairs. *(cost)*
- [ ] **Light theme has no mockup.** Say the light theme is reviewed by eye against the dark mockup. *(cost)*
- [ ] **Token scope.** Say `ChipColour` `sky` and `orange` map to existing hue sets, and that the other 492 `dark:` uses and `server/board.ts:3723` stay as they are. *(estate)*
- [ ] **Sections wait on Primitives only by heading order.** Add one sentence on the *Sections* heading, since the branches carry no `waits:` marker. Consider splitting the screenshot harness and CI step from *Primitives*. *(deliverable, cost)*

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
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

  Done when: each new field has a unit test that asserts its value for every case its type names; `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` and `pnpm run typecheck` pass; the existing tests pass; no `.tsx` file and no stylesheet changes.

### Primitives

- `feature/delivery-visual-primitives` <!-- waits: feature/delivery-tab-footer, feature/delivery-tab-todo-list, feature/delivery-release-card, feature/delivery-my-sprint-scope, feature/delivery-release-person-cards, feature/delivery-sprint-delivery-scope --> — the tokens in both themes, the primitives stylesheet and the per-section stylesheets, the section cards, header bars, group headings, visible header rows and row rules on every Delivery section, the role chip and dot colours on tokens, the theme contrast test, and the screenshot harness with its CI artifact <!-- builds: Delivery tab theme tokens, style primitives and a screenshot harness -->

  Owns: `packages/board/src/app/index.css` (the token blocks and the stylesheet imports), new `packages/board/src/app/styles/delivery.css` and the empty per-section files `styles/delivery-{header,release,you,work-items,fleet,bottom}.css`; in `AgentList.tsx` the section element, the header `h2`, the group headings, the group grids, `YOU_MARKER_CLASS`, `MACHINE_DOT_CLASS` with `MachineSection`, the tab-header wrapper around the cards, the not-placed block, and the footer line's dots; `lib/agent-rows/rows.tsx` `HeaderRow`; `TupleRow.tsx` the row `li`; `RoleChip.tsx`; `FleetAgentRow.tsx` `FleetAgentHeader` only; the Tickets header row in `TicketsSection.tsx:81`; `test/catalogue/index.ts`, `test/catalogue/states.ts` (one new scenario), new `test/unit/theme-contrast.test.ts`, new `test/integration/delivery-tab-screenshots.browser.test.ts`; `.github/workflows/ci.yml` (one env line and one upload step).

  Done when: `theme-contrast.test.ts` passes in both themes; every Delivery section renders inside its card with its header bar and visible column headers; the existing browser tests pass; the PR body links the `delivery-screenshots` artifact, which shows the whole tab in light and dark beside `section-header.html`.

### Sections

Each branch below owns a disjoint set of files and one stylesheet, so the six run in parallel under one heading (Jan Wloka, 2026-11-18). `/plot-reconcile` section 7 reports this heading as an uncut slice, and that report is accepted. None of the six edits `index.css`. Only `feature/delivery-visual-release` edits `AgentList.tsx`.

- `feature/delivery-visual-tab-header` — the to-do list with its marker tags and coloured verbs, the release card with its bar, legend and Approve button, the sprint card with its bar and legend, the fleet card with its state dot, the filter chips, and the two-column header layout that stacks below 768 px <!-- builds: the tab header cards in the mockups' look --> — Owns: `components/TodoList.tsx`, the release card component, `components/SprintCard.tsx`, `components/FleetCard.tsx`, `components/DeliveryFilters.tsx` (the chip button at `:75-97`), `components/ReleaseApprove.tsx`, `styles/delivery-header.css`. Mockup: `first-five-seconds-v2.html`, `you-section-v2.html` (the to-do list). It reads the fields of item 4 under *Domain Fields*.
- `feature/delivery-visual-release` — the Release and Sprint delivery header bar, the plan rows as a table with Plan, Phase, Slices and Owner columns, the slice strip as one block per slice, the opened Done, In flight and To do lines, and the per-person cards <!-- builds: Release delivery rows and slice strip in the mockups' look --> — Owns: `AgentList.tsx` Release delivery block (`:1557-1629` on `89407abdc`), the per-person card component, `styles/delivery-release.css`. Mockup: `delivery-toggle-icons-v2.html`, `plan-slices.html`. It reads the fields of items 2 and 3 under *Domain Fields*.
- `feature/delivery-visual-you` — the group tags for Blocks delivery, Input to the fleet and Unblock, the inset bar on each row in the group's colour, the Do verb in the group's colour, the plan row's slice and question chips and first question, and the kind cell <!-- builds: the You section in the mockups' look --> — Owns: `lib/agent-rows/draft-plan-row.tsx`, `styles/delivery-you.css`. The row bars and Do colours select on the existing `data-group` attribute. Mockup: `you-section-v2.html`, `section-header.html`. It reads the fields of items 5 and 6 under *Domain Fields*.
- `feature/delivery-visual-work-items` — the gate marks, the Where cell with its branch beneath, the By cell with its chip, name and fixer attempt, and the group columns <!-- builds: Work items rows in the mockups' look --> — Owns: `components/DeliveryRows.tsx` (`RowCell`), `styles/delivery-work-items.css`. Mockup: `work-items-v1.html`. It reads the field of item 1 under *Domain Fields*.
- `feature/delivery-visual-fleet` — the agent rows with their dots, role chips, Acting on and Doing now cells, the Tokens and Time left columns with the draining bar, the Free line, and the header switches and stepper <!-- builds: Fleet rows and switches in the mockups' look --> — Owns: `components/FleetAgentRow.tsx` (`FleetAgentRow`), `components/FleetControls.tsx`, `styles/delivery-fleet.css`. The read-only switches on the fleet card take the same look, because they are the same components. Mockup: `fleet-section-v3.html`.
- `feature/delivery-visual-bottom` — the Machine line with its dot and word and the strained table, the Tickets section with its Plan it column and its "… n more" line, and the footer with its freshness dots <!-- builds: Machine, Tickets and footer in the mockups' look --> — Owns: `components/TicketsSection.tsx` (except the header row *Primitives* owns), `styles/delivery-bottom.css`. The Machine section and the footer are styled through their existing `data-*` attributes in this stylesheet; their markup classes are *Primitives*'. Mockup: `bottom-of-tab.html`.

Done when, for each branch: its section matches its mockup in both themes within the spec's text; the section has no horizontal scroll at 320 px; its browser tests and the existing ones pass; and the PR body links the `delivery-screenshots` artifact, which shows the section in light and dark beside its mockup.

## Notes

- 2026-11-18: plan written at the request of Jan Wloka. The eight mockups were copied from the writer's gitignored `.superpowers/brainstorm/20038-1794839570/content/` into `docs/superpowers/specs/2026-11-16-delivery-tab-mockups/`, and the spec's *Mockups* paragraph points there. The files were checked before the commit: no script, no URL, no e-mail address, no token; the only handles are `jwloka` and `eins78`, both in `People`.
- The six slices this plan waits on, at the time of writing: `feature/delivery-tab-footer` (#3507, open), `feature/delivery-tab-todo-list` (#3530, open), `feature/delivery-release-person-cards` (#3532, open), `feature/delivery-release-card`, `feature/delivery-my-sprint-scope` and `feature/delivery-sprint-delivery-scope` (no PR yet).
- 2026-11-18: Jan Wloka decided four open questions (see *Decisions*): one parallel Sections wave, a *Domain fields* slice before *Primitives*, the artifact link as the screenshot evidence, and 13 px rows with 11 px small text.
