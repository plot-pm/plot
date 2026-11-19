## Implementation brief — delivery-tab-matches-its-mockups (wave 3: Sections — tab header)

- **Plan (canonical):** docs/plans/2026-11-18-delivery-tab-matches-its-mockups.md on main
- **Approved:** 2026-11-18, Jan Wloka, plan-PR #3531 merged
- **Branch:** `feature/delivery-visual-tab-header` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This branch is one of six under the *Sections* heading, and all six run in parallel. They wait on *Domain fields* (#3541) and *Primitives* (#3542) by heading order, and both merged on 2026-11-19, so the slice is startable. The other five (`-release`, `-you`, `-work-items`, `-fleet`, `-bottom`) own disjoint files; none edits `index.css`.

### What to build

The Delivery tab header does not look like `first-five-seconds-v2.html` and `you-section-v2.html`. Measured on `origin/main` on 2026-11-19: `TodoList.tsx`, `ReleaseCard.tsx` and `DeliveryFilters.tsx` carry Tailwind palette classes with `dark:` variants (`border-slate-200 bg-white … dark:bg-slate-900/40`, `text-blue-600 dark:text-blue-400`, `bg-green-600`), so none of them draws from the `--card-*` and `--hue-*` tokens the rest of the Delivery tab now uses. `styles/delivery-header.css` holds only the marker rule `[data-tab-header] { --delivery-section: header; }`.

This slice styles four things and lays out one:

- **The to-do list** (`TodoList.tsx`): a card on `--card-surface`, a header, one line per item with the verb coloured by its marker and the item name as a bold link, the marker word as a tag, and the triage line.
- **The release card** (`ReleaseCard.tsx`): title, state and people text, the five-state bar, a legend with one swatch per segment, and the Approve release button (`ReleaseApprove.tsx`) on `--card-primary` behind `--card-primary-text`.
- **The filter chips** (`DeliveryFilters.tsx`, the chip button): a pill that reads on, off and disabled from the `Chip` the domain returns.
- **The two-column layout** in `styles/delivery-header.css`: Primitives built `div[data-tab-header]` with `div[data-tab-header-column="todo"]` and `div[data-tab-header-column="status"]` (`AgentList.tsx:1527-1535`); this slice lays them out side by side from 768 px up and stacks them below it. The status column holds the release or sprint card, then the fleet card.

The sprint card and the fleet card are Primitives' (colours, five-state map). Style their placement only through `styles/delivery-header.css`; do not edit `SprintCard.tsx` or `FleetCard.tsx`. `ReleaseCard.tsx` imports `SEGMENT_CLASS` and `SEGMENT_WORD` from `SprintCard.tsx`: reuse them, so the release bar takes the same five-state colours as the sprint bar.

Read the plan's *Primitives* section for the classes you build on: `.delivery-card`, `.delivery-head`, `.delivery-chip` with `.delivery-tone-*` and `.delivery-hue-*`, `.delivery-dot`, `.delivery-strip`, `.delivery-state-*`, `.delivery-text-*`. They live in `styles/delivery.css`. Plan *Sections* and *Domain Fields* item 4 are the specification; this brief orients and corrects.

### The decisions the plan settles — do not re-derive them

**The verb colour is a lookup over the domain's marker, not a test in the component.** `TodoLine` carries `marker` (`blocks-delivery`, `input`, `clean-up`), `verb`, `label` and `text` (`packages/domain/src/rules/todo-list.ts:52-58`, `text` is always `${verb} ${label}`). Map `marker` to a class in a constant table, as `YOU_MARKER_CLASS` does. A component that tests the word `Approve` or compares a count to pick a colour breaks the rule *Every rendered state is a domain property*. The marker colours are the header counts' colours from the plan: `blocks-delivery` red, `input` blue, `clean-up` the body colour.

**Render `verb` and `label` apart; keep `text` where tests read it.** The existing `data-todo-name` button shows `l.text` today. The mockups colour the verb and bold the item name. Render `verb` and `label` as two elements inside the button and keep `data-todo-name`, `data-todo-line`, `data-todo-marker`, `data-todo-header`, `data-todo-triage` and `data-todo-triage-link` with their values. Run a grep over `packages/board/test` for each before you move markup; a test that reads the button's `textContent` must still read `Approve my-plan`.

**A marker is never colour alone.** The `data-todo-marker` span keeps `l.markerWords` as visible text. The release card's legend swatches carry their count and word as text, which the `role="img"` bar `aria-label` already repeats; keep both.

**The mockups lose where the spec text disagrees.** The mockups label the toggle "This sprint"; the spec and `chipRow` call it **My sprint**: render what `chip.label` says. The mockups show the fleet switches as text on the Fleet card; the spec shows them read-only switches, and those are Primitives'. The mockups use 10 px for small text; the plan fixes 11 px for chips and column headers, 13 px for rows, 15 px for section titles.

**The mockups step between frame and box (`#0b1020` then `#131a2e`) is not reproduced.** The to-do list and the release card sit on `--card-surface` with a `--card-border` border, per the plan's token table. Do not add a token for the box.

**Tokens, not hex, and unlayered.** Every colour is a `--card-*` or `--hue-*` token, and the rules live in `styles/delivery-header.css`, which Primitives imports unlayered after `@import "tailwindcss"`. A `dark:` utility or a hex value on a header element is the failure this plan removes. Where a Tailwind utility stays for layout (`flex`, `gap-*`, `min-w-0`), keep it; remove the colour, border and background utilities you replace, because a utility and a rule that set one property make the cascade the next reader has to untangle.

**Class-reading tests.** The plan lists the tests that read a class name (*Tests and Selectors*). None reads a class on `TodoList`, `ReleaseCard`, `DeliveryFilters` or `ReleaseApprove`, as measured when the plan was written. Re-check with `grep -rn "slate-\|green-600\|blue-600" packages/board/test` against these four files before you remove a class. If a test reads one, move it to a `data-*` attribute in the same PR and say so in the PR body.

**Rules carried over unchanged:** a function you write is an arrow; absent is not false (a card with `bar === null` renders no bar, and `readingMissing` shows `missingText`, never an empty bar); a cell that cannot hold its text cuts it at the end with an ellipsis and keeps the full text as its `title`; no abbreviated text where the row has room; icons come from `glyphs.ts` only, so add no SVG path.

### Done when

The plan's *Sections* done-when is the specification. CI gates: this branch's browser tests and the existing ones pass, and `delivery-tab-screenshots.browser.test.ts` passes, with no horizontal scroll at 320 px. A reviewer judges that the header matches `first-five-seconds-v2.html` and `you-section-v2.html` within the spec's text: the dark theme against the mockup, the light theme by eye against the dark mockup, from the `delivery-screenshots` artifact of the CI run on the PR head.

The assertions that exist because a naive implementation would pass without them:

- **The two-column layout asserted at both widths.** At 1280 px the todo and status columns sit side by side; at 767 px they stack. A rule written only for the wide case passes the 1280 px render and breaks the narrow one, and the stacked case is the one the 320 px check reads.
- **One computed style from `delivery-header.css` on a real header element, not only the marker rule.** The screenshot test already reads `--delivery-section` from `[data-tab-header]`, which proves the file loads. It does not prove a rule from the file beats a Tailwind utility, so assert the to-do verb's computed colour for one marker (it must equal the marker's token, for example `--hue-red` under `blocks-delivery`). A utility left on the element wins silently.
- **A line with `outcome`-free input stays valid.** `TodoList` with zero lines renders the header and the triage line and no empty `ul`.

Plus: this slice touches `.tsx` and `.css`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e`, and do not run the board's browser suites at a fleet desk. The slice adds no `.sh`; if it did, `scripts/check-shell-lines.sh` would refuse a longer shell total than its merge base. Add a changeset for `@plot-pm/board` (description first, `bumps:` block last). Do not commit a rebuilt `board-server.mjs`: `scripts/check-no-bundle-diff.sh` refuses it, and `main` builds its own bundles after each merge.

### Bookkeeping

Open the PR through `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Name in the PR body: your re-measured line ranges, the paths of the release card component (`components/ReleaseCard.tsx`), any class-reading test you moved to a `data-*` attribute, the `delivery-screenshots` artifact link, and the four images for the tab header (light, dark, 320, mockup).

### Scope guard

This branch owns: `components/TodoList.tsx`, `components/ReleaseCard.tsx`, `components/DeliveryFilters.tsx` (the chip button), `components/ReleaseApprove.tsx` and `styles/delivery-header.css`, plus the tests that cover them. Do not edit `AgentList.tsx`, `index.css`, `SprintCard.tsx`, `FleetCard.tsx`, `TupleRow.tsx`, any other `styles/*.css`, or any domain file: the markup around the header is Primitives', and `AgentList.tsx` is the release branch's. Add no domain field, no reading and no host call.

Other branches in flight, same heading: `feature/delivery-visual-release` (`AgentList.tsx` Release block, `ReleasePersonCards.tsx`, `PlanCard.tsx`, `delivery-release.css`), `-you` (`draft-plan-row.tsx`, `delivery-you.css`), `-work-items` (`DeliveryRows.tsx`, `delivery-work-items.css`), `-fleet` (`FleetAgentRow.tsx`, `FleetControls.tsx`, `delivery-fleet.css`), `-bottom` (`TicketsSection.tsx`, `delivery-bottom.css`). No file is shared with this branch.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
