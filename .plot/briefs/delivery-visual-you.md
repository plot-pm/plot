## Implementation brief — delivery-tab-matches-its-mockups (wave 3: Sections — you)

- **Plan (canonical):** docs/plans/2026-11-18-delivery-tab-matches-its-mockups.md on main
- **Approved:** 2026-11-18, Jan Wloka, plan-PR #3531 merged
- **Branch:** `feature/delivery-visual-you` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This branch is one of six under the *Sections* heading, and all six run in parallel. They wait on *Domain fields* and *Primitives* by heading order, and both merged on 2026-11-19, so the slice is startable. The other five (`-tab-header`, `-release`, `-work-items`, `-fleet`, `-bottom`) own disjoint files, and none edits `index.css`. This branch edits no `AgentList.tsx` line.

### What to build

The You section does not look like `you-section-v2.html` and `section-header.html`. Measured on `origin/main` on 2026-11-19: `styles/delivery-you.css` holds only the marker rule `[data-section="you"] { --delivery-section: you; }`. The group tag (`span[data-group-marker]`, `AgentList.tsx:1747-1754`) takes its colour from `YOU_MARKER_CLASS` (`:174-178`), Tailwind palette classes with `dark:` variants, and it draws a `bg-current` dot with no tag background. A You row has no inset bar. `draft-plan-row.tsx` writes its three chips, its rounds badge and its note in `bg-slate-100 … dark:bg-slate-800` and `text-slate-*` classes, so the open-questions chip is grey whether a question is open or not, and the first question and the `+2 more` link carry palette colours.

This slice colours and re-styles four things, all through CSS you write in `styles/delivery-you.css` and the classes of one component:

- **The group tag.** In the mockup the tag is a pill: `blocks delivery` on `--hue-red-soft` behind `--hue-red` text, `input` on `--hue-blue-soft` behind `--hue-blue`, and Unblock neutral. Select on `[data-section="you"] [data-group="blocks-delivery"] [data-group-marker]`, `[data-group="input-to-the-fleet"] …` and `[data-group="unblock"] …`, the existing attributes. The tag's words stay as they are (`YOU_GROUP_MARKERS` gives Unblock "clean up", the other two none), and the dot stays beside them, so colour never carries the group alone.
- **The inset bar on each row.** A row under Blocks delivery gets a 3 px inset bar in `--hue-red`, a row under Input to the fleet one in `--hue-blue`, and a row under Unblock none or a neutral one (the mockups show none; take none). The row is `li[data-delivery-row]` (`TupleRow.tsx:694`), a descendant of `div[data-group]`, so the selector is `[data-section="you"] [data-group="blocks-delivery"] [data-delivery-row]` with `box-shadow: inset 3px 0 0 var(--hue-red)`. A `box-shadow` leaves the row's grid tracks and padding alone; a `border-left` would move every cell by 3 px.
- **The Do verb in the group's colour.** `[data-group="blocks-delivery"] [data-row-do]` red, `input-to-the-fleet` blue. `data-row-do` renders at `DeliveryRows.tsx:54` only (measured). Check which You row reaches it; where a You row's Do cell is the `⋯` menu (`data-row-cell="do"`) and no `data-row-do` element exists, style `[data-row-cell="do"]` instead and say so in the PR body. Add no markup: the cell is *Primitives*' and the By content is *Work items*'.
- **The plan row's chips and first question** (`draft-plan-row.tsx`). Replace the palette classes with the primitives `delivery-chip` plus a tone class. The slice chip (`3 slices`) takes `delivery-tone-neutral`. The open-questions chip takes the domain's tone: `openQuestionsTone(questions)` (`packages/domain/src/rules/plan-open-questions.ts`, landed with *Domain fields*) returns `warn`, `neutral` or `null`, and a constant table maps it to `delivery-tone-warn` or `delivery-tone-neutral`. The rounds badge keeps its recorded and absent shapes (see below). The first question takes `delivery-text-muted`, the `+n more` link `delivery-text-link`, the note `delivery-text-muted`.

Plan *Sections* (this branch's bullet) and *Domain Fields* item 5 are the specification; this brief orients and corrects.

### The decisions the plan settles — do not re-derive them

**The group colour has one home: the `data-group` selectors in `styles/delivery-you.css`.** `YOU_MARKER_CLASS` stays in `AgentList.tsx`, unchanged, as a dead second home. Do not edit it, do not delete it, and do not style through it. The reason is a measurement of what tests read, not taste: `AgentList.tsx` is *Primitives*' and the release branch's file, so an edit here collides with the one Sections branch that owns it, and the plan puts the colour in the stylesheet so the cascade decides. The stylesheets are imported unlayered after `@import "tailwindcss"`, so your rule outranks the `text-red-600` utility on the same element. That is why the done-when asserts the computed colour: a utility that wins leaves the file loaded and the tag still wrong.

**The tone is a domain field, never a test in the component.** `openQuestionsTone` exists because deciding `count > 0` in `draft-plan-row.tsx` breaks the rule *Every rendered state is a domain property*. Call it, map its result through a constant, and render no tone class where it returns `null` (the chip is absent then: `openQuestionsChip` is `null` for the same input). Do not compare `questions.count` to zero. Add no domain field, no reading and no host call.

**The rounds badge keeps both shapes.** A recorded count, 0 included, takes the filled badge, and an absent one the dashed italic badge, so `not interrogated` and `0 rounds` never read alike (`draft-plan-row.browser.test.ts:53-60` asserts the words and `data-rounds`). Restyle both onto tokens, but keep the dashed border and the italics on the absent shape: a restyle that gives both one fill passes every text assertion and loses the distinction. Colours come from `--card-*` and `--hue-*` tokens.

**The mockups lose where the spec text disagrees.** The mockups use 10 px for the kind cell and column headers, and 11 px is the plan's size. The mockup's chip text reads "2 open questions" and "no open questions"; the domain's chip text is `n open` (`openQuestionsChip`, asserted by `draft-plan-row.browser.test.ts:93` as `3 open`), and this slice changes no text. The mockups step between frame and box (`#0b1020`, `#131a2e`); that step is not reproduced. The tag in the mockup carries the words "Blocks delivery" and "Input to the fleet" as the group label; here the tag is the marker beside the label, and the label keeps its place.

**Tokens, not hex.** Every colour is a `--card-*` or `--hue-*` token, through the `delivery-hue-*`, `delivery-tone-*` and `delivery-text-*` classes `styles/delivery.css` already defines. A `dark:` utility or a hex value on a You element is the failure this plan removes. Keep Tailwind utilities for layout (`flex`, `gap-*`, `min-w-0`, `shrink-0`, `truncate`), and remove each colour, border and background utility you replace, because a utility and a rule that set one property leave the cascade for the next reader.

**Class-reading tests.** The plan lists the tests that read a class name (*Tests and Selectors*). None of the You elements is on that list. Before you change a class, read `grep -rn "slate-\|text-red-600\|text-blue-600" packages/board/test` against `draft-plan-row.tsx`. If a test reads one, move it to a `data-*` attribute in the same PR and say so in the PR body. The `data-draft-plan-*` attributes, `data-group`, `data-group-marker`, `data-delivery-row` and `data-rounds` stay with their values.

**Rules carried over unchanged:** a function you write is an arrow; absent is not false (no questions means no chip and no empty element); a cell that cannot hold its text cuts it at the end with an ellipsis and keeps the full text as its `title` (`delivery-truncate`, as `data-draft-plan-first-question` already does); icons come from `glyphs.ts` only, so add no SVG path.

### Done when

The plan's *Sections* done-when is the specification. CI gates: this branch's browser tests and the existing ones pass, and `delivery-tab-screenshots.browser.test.ts` passes, with no horizontal scroll at 320 px. A reviewer judges that the section matches `you-section-v2.html` and `section-header.html` within the spec's text: the dark theme against the mockup and the light theme by eye against the dark mockup, from the `delivery-screenshots` artifact of the CI run on the PR head that the PR body links.

The assertions that exist because a naive implementation would pass without them:

- **The plan's own assertion: the computed colour of a `data-group-marker` under Blocks delivery equals `--hue-red`.** Resolve `--hue-red` from the page (`getComputedStyle(document.documentElement)`) and compare it with the marker's computed `color`, in both themes. The screenshot test today reads `--delivery-section` from `[data-section="you"]`, which proves the file loads and not that a rule from it beats `text-red-600`. Add the same assertion for Input to the fleet (`--hue-blue`).
- **The row bar reaches the right rows only.** A row under Blocks delivery has `box-shadow` in red, a row under Input to the fleet in blue, and a row under Unblock none. A selector on `[data-delivery-row]` alone passes the first fixture and paints every row in the tab, Work items included.
- **The tone follows the domain.** One fixture with `openQuestions: {count: 3}` and one with `{count: 0}` assert the questions chip's computed colour is `--hue-amber` and the body colour. A component that hard-codes `warn` passes the first and fails the second.
- **The rounds badge shapes still differ.** `0 rounds` renders a solid fill and no dashed border, and `not interrogated` renders a dashed border and `font-style: italic`. A single restyle of both passes `draft-plan-row.browser.test.ts` and loses the distinction.
- **The Do verb colour reaches a You row.** Assert the computed colour of the Do element in a Blocks delivery row, whichever element your measurement found. A rule on `[data-row-do]` that no You row renders passes every other assertion.

Plus: this slice touches `.tsx` and `.css`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e`, and do not run the board's browser suites at a fleet desk. The slice adds no `.sh`; if it did, `scripts/check-shell-lines.sh` would refuse a longer shell total than its merge base. Add a changeset for `@plot-pm/board` (description first, `bumps:` block last). Do not commit a rebuilt `board-server.mjs`: `scripts/check-no-bundle-diff.sh` refuses it, and `main` builds its own bundles after each merge.

### Bookkeeping

Open the PR through `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Name in the PR body: your re-measured line ranges for the group tag and the plan row, which element carries the Do verb in a You row, any class-reading test you moved to a `data-*` attribute, the `delivery-screenshots` artifact link, and the images for You (light, dark, 320, two mockups).

### Scope guard

This branch owns: `packages/board/src/app/lib/agent-rows/draft-plan-row.tsx`, `packages/board/src/app/styles/delivery-you.css`, plus the tests that cover them (`draft-plan-row.browser.test.ts` and the screenshot test's assertions for the You section). Do not edit `index.css`, `styles/delivery.css`, any other `styles/*.css`, `AgentList.tsx` (including `YOU_MARKER_CLASS` and the group heading markup), `TupleRow.tsx`, `DeliveryRows.tsx`, or any domain file. The kind cell's style is *Primitives*' and lives in `delivery.css`.

Other branches in flight, same heading: `-tab-header` (`TodoList.tsx`, `ReleaseCard.tsx`, `DeliveryFilters.tsx`, `ReleaseApprove.tsx`, `delivery-header.css`), `-release` (`AgentList.tsx` Release block, `ReleasePersonCards.tsx`, `delivery-release.css`), `-work-items` (`DeliveryRows.tsx`, `delivery-work-items.css`), `-fleet` (`FleetAgentRow.tsx`, `FleetControls.tsx`, `delivery-fleet.css`), `-bottom` (`TicketsSection.tsx`, `delivery-bottom.css`). No file is shared with this branch. `-work-items` keeps `LINK_CLASS` on `data-row-do` unchanged for this slice's Do colour, so a Do verb you style through `[data-row-do]` stays styled after it merges.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
