# Round 2 — contradiction lens

Subject: `docs/plans/2026-11-18-delivery-tab-matches-its-mockups.md` at `8dcb2ed85`. Siblings: 4 read, 0 unread.

Position: amend

## Findings

### 1. The Release header bar cannot show a bold, coloured number without a component splitting a string (blocks, for `feature/delivery-visual-release`)

- Plan: *Primitives › Header bar* (line 89): "A count shows its number in bold. A count's colour maps its key". *Domain Fields* item 6 (line 166): "so the header bar shows the number in bold the same way for every section". *Approach* (line 42): "A component never tests a string".
- Source: the Release header is one string. `ReleaseBlockView.header: string` (`packages/board/src/app/lib/agent-rows/delivery-view.ts:240`), built as `headerText(headerCounts(plans), …)` and then concatenated with the ticket wording (`:521-522`). AgentList renders it as `{block.header}` in `data-release-line`. The mockup `delivery-toggle-icons-v2.html:17` shows `<span class="n ok">15</span><span class="muted">of 21 slices delivered</span>`, which is a bold green number apart from muted words.
- Contradiction: item 6 only splits the You header. No *Domain Fields* item gives the Release header keyed counts. The Release slice owns "the Release and Sprint delivery header bar", but it can reach the mockup only by parsing the string, and the plan forbids that.
- Change: add a seventh *Domain Fields* item: Release header counts as `{key, count, label}` from `headerCounts` (`release-plan-rows.ts`), with the string kept beside them. Or state that the Release header stays one muted line, and correct item 6's "every section".

### 2. "The Do cell (`:845-862`)" names the wrong markup, and the By cell gets two owners (misleads)

- Plan: *Primitives* Owns (line 219): "`TupleRow.tsx` the row `li` (`:689-703`) and the Do cell (`:845-862`)". Round-1 answer (line 180): "*Primitives* owns … the Do cell". *Work items* (line 230): "the By cell with its chip, name and fixer attempt", Owns `DeliveryRows.tsx (RowCell)`. *You* (line 229): "the Do verb in the group's colour".
- Source: `TupleRow.tsx:845-848` is `data-row-cell="do"`, a `w-5` cell that holds the `⋯` menu. `:850-862` is `data-row-cell="by"`, the By cell. The Do *verb* is rendered by `DeliveryRows.tsx:53` (`Linked`, case `act`, `data-row-do`, `className={LINK_CLASS}` from `:30`), which is in the *Work items* slice's file. `RowCell` is also used by `FleetAgentRow.tsx:34-46` and by `AgentList.tsx:1176-1192`.
- Contradiction: Primitives' range covers the By cell that Work items also claims. The Do verb that You colours carries its colour class in the Work items file, so You's `data-group` rule fights a class that another parallel slice may change.
- Change: Primitives owns the menu cell `:845-848` and the By cell's wrapper `:850-862`. Work items owns the By cell's content through `RowCell`. Add one sentence: Work items keeps `LINK_CLASS` on `data-row-do` unchanged, and You colours `[data-group] [data-row-do]` in `delivery-you.css`.

### 3. The group colour still has two homes (misleads; this is a round-1 answer that is incomplete)

- Plan line 182: "The You group colour lives only in `data-group` selectors … *Primitives* keeps `YOU_MARKER_CLASS` unchanged and does not style through it."
- Source: `AgentList.tsx:1682-1684` still applies `YOU_MARKER_CLASS[…]` (`text-red-600 dark:text-red-400` and the others, `:167-172`) to the group tag `data-group-marker`. That gives the tag a Tailwind colour class and a `data-group` rule on the same element. `index.css:1` is `@import "tailwindcss"`, so which colour shows depends on cascade-layer order. The plan does not state that order.
- Change: either Primitives removes the colour class from the tag and moves the class-reading tests (line 118) to `data-group-marker`, or the plan states that `styles/delivery*.css` is imported unlayered, so it overrides the utility layer, and that the colour therefore has one *visible* home and a dead second one.

### 4. "Being built" takes two colours (misleads)

- Plan line 89: count colour "`being-built` and `working` green". Line 78: the five-state map gives "being built `--hue-blue-dot`". Line 163: "`● building` blue".
- Source: the mockups disagree with each other. `work-items-v1.html:27` shows the count `n ok` (green), `section-header.html:51` shows it uncoloured, and `plan-slices.html:30` and `delivery-toggle-icons-v2.html:24` show `● building` as `#60a5fa` (blue).
- Contradiction: the plan says "The five slice states take one colour map", but its header-bar rule gives the same state a second colour.
- Change: map the `being-built` count to blue, which matches the one map, and keep `working` green. Or state the exception and the reason for it.

### 5. The group-heading primitive matches only two of the four sections that have groups (cosmetic)

- Plan line 90: "Group heading: 11 px uppercase with 0.06 em letter spacing in `--card-meta`."
- Source: `work-items-v1.html:10` and `fleet-section-v3.html:10` match this. `you-section-v2.html:8` and `section-header.html:13` show `.grp { font-size:12px; font-weight:650 }`, in the body colour, not uppercase, with the tag beside it.
- Change: say that You's group headings take the tag style in `delivery-you.css` and are not uppercase. Or add a second group-heading variant to *Primitives*.

### 6. The token table maps the wrong mockup colour to the section card (cosmetic)

- Plan line 54: "`#131a2e`, border `#232c46` | section card, tab header card".
- Source: every section mockup's frame is `.dt { background:#0b1020 }` (one hit in each of the 8 files). `#131a2e` occurs only in the tab-header `.box` (`first-five-seconds-v2.html:11`) and the to-do `.todo` (`you-section-v2.html:26`).
- Change: split the row: `#0b1020` → section card, and `#131a2e` → tab-header card and to-do list. Both may still map to `--card-surface`, but the table should say so.

### 7. New tokens against the spec's "existing palette" (cosmetic)

- Plan line 38: "the spec text wins". Line 77 adds `--card-rule` and the `--hue-rose` family.
- Spec line 241 (*Left to the Builder*): "Colours, spacing and the exact chip styles, within the board's existing palette."
- Change: record this as a decision that names the deviation, for example that rose is a Tailwind palette colour and `--card-rule` is a step of an existing slate. Otherwise the plan breaks its own "spec wins" rule without saying so.

### 8. The kind cell is given to the You slice but appears in every section (cosmetic)

- Plan line 229: You owns "the kind cell". Line 96: kind cells are 11 px.
- Source: the kind cell is `TupleRow.tsx:747-756` (`data-row-cell="kind"`), the same cell on Work items rows. `work-items-v1.html:24` gives Work items a Kind column with `.kind` styling.
- Contradiction: a rule in `delivery-you.css` scoped by `data-group` leaves the kind cell in Work items unstyled. An unscoped rule there styles another slice's section.
- Change: move the kind cell's style into the *Primitives* stylesheet.

### 9. Mixed baselines (cosmetic)

- Line Ranges (line 123) are measured at `89407abdc`. *Domain Fields* (line 159) cites `main` at `341df638d`. `git diff --stat 89407abdc 341df638d` shows `AgentList.tsx` +11 lines, so the cited ranges are already off on current `main`. The plan already tells each slice to measure again, so this only needs one consistent baseline commit named.

## Claims checked and found true

- `YOU_MARKER_CLASS` at `AgentList.tsx:167-172`; `MachineSection`'s `role="img"` with `aria-label` at `:24`; the Fleet switches slot at `:1542`; the Free line at `:1657-1658`; `data-group` at `:1657` and `:1706`.
- `doneDetail` at `release-plan-rows.ts:103-110` writes `mergedAt.slice(0, 10)`. `PlanLine` is at `:113` and `PlanRowFacts` at `:143`. `CellPart` is at `delivery-row-form.ts:58` and `gateValue` at `:223`. Note: `gateValue` returns one `string | null`, so the outcome has to be set where the `CellPart` is built, not inside `gateValue`. `openQuestionsChip` is at `plan-open-questions.ts:46`, and `YouHeaderCount` has no `label`.
- `origin/feature/delivery-tab-todo-list`: `TodoLine` carries `text` and no `verb` or `label`. The branch adds `packages/domain/src/rules/todo-list.ts` and `packages/domain/test/todo-list.test.ts`. It also adds `packages/board/src/app/lib/agent-rows/todo-list.ts`, which the *Domain fields* Owns does not list. That is harmless while the domain alone computes the fields.
- `origin/feature/delivery-release-person-cards` adds `components/ReleasePersonCards.tsx`. `origin/feature/delivery-tab-footer` adds `data-footer-line` and `data-freshness-state`, so the Bottom slice's "existing `data-*` attributes" for the footer hold once #3507 merges. On `89407abdc` the footer `<p>` (`AgentList.tsx:1787`) has none.
- The domain test files the plan names exist under `packages/domain/test/`.
- None of #3507, #3530 or #3532 is on `origin/main` (`341df638d`), so the `waits:` markers are correct.
- No contradiction found with the four siblings. The footer and Machine dot words in `delivery-machine-tickets-footer.md:42,51` fit the token families. The Phase and "merged 2 days ago" ownership matches `delivery-release-progress-per-plan.md:21,47,54`.

## What I looked at and did not

Read: the whole plan; round-1 `panel.md`; the Slices and Notes of the four siblings and a grep of them for colour words; a grep of the spec, and spec lines 238-248; the CSS blocks and the relevant markup of all 8 mockups; `index.css:1-140`; `AgentList.tsx` (`:1-30`, `:160-175`, `:1480-1560`, `:1625-1700`, `:1785-1795`); `TupleRow.tsx:740-870`; `DeliveryRows.tsx:20-100`; `delivery-view.ts` (`:1-20`, `:155-200`, `:505-525`); `you-header.ts` in both the domain and the board; `delivery-row-form.ts:215-240`; the diff stats of the three open sibling branches, read with read-only `git` commands.

Not looked at: the tests that read classes (line 118); `rows.tsx` `HeaderRow`; `SprintCard.tsx`, `FleetCard.tsx`, `RoleChip.tsx` and `FleetControls.tsx`; `ci.yml`; `test/catalogue/index.ts`. I ran no build, no test and no browser, and I recomputed no contrast figure.
