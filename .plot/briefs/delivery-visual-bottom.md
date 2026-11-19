## Implementation brief — delivery-tab-matches-its-mockups (wave 3: Sections — bottom)

- **Plan (canonical):** docs/plans/2026-11-18-delivery-tab-matches-its-mockups.md on main
- **Approved:** 2026-11-18, Jan Wloka, plan-PR #3531 merged
- **Branch:** `feature/delivery-visual-bottom` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This branch is one of six under the *Sections* heading, and all six run in parallel. They wait on *Domain fields* (#3541) and *Primitives* (#3542) by heading order, and both merged on 2026-11-19, so the slice is startable. The other five (`-tab-header`, `-release`, `-you`, `-work-items`, `-fleet`) own disjoint files; none edits `index.css`.

### What to build

The Machine line, the Tickets section and the footer line do not look like `bottom-of-tab.html`. Measured on `origin/main` on 2026-11-19 (after #3542 merged):

- **Tickets** (`components/TicketsSection.tsx`) is not a card. Its `<section>` has `className="space-y-2"` and no `delivery-card`, and its `h2` and the lines under it carry Tailwind palette classes with `dark:` variants (`text-slate-800 dark:text-slate-100`, `text-slate-600 dark:text-slate-300`, `text-xs text-slate-500 dark:text-slate-400`). The table rows carry `border-slate-100 dark:border-slate-800`, the ticket link and `FOLD_CLASS` carry `text-blue-600 dark:text-blue-400`. Primitives already gave the grid `delivery-grid` and the header row `delivery-thead` (`TicketsSection.tsx:80-81`).
- **Machine** (`MachineSection` in `AgentList.tsx`, inside the `delivery-card` that Primitives gave the `machine` section) already has its dot (`delivery-dot` with `MACHINE_DOT_CLASS`) and its word. Its strained table (`[data-machine-rows]`) is a bare `<table>` with no header rule, no row rule and no padding. The mockup shows `th` as 11 px uppercase `--card-meta` with a `--card-border` rule, and `td` with 0.5 rem padding and a `--card-rule` rule.
- **Footer** (`<p data-footer-line>` in `AgentList.tsx`) is one run of inline text. The mockup shows a flex row with an 18 px gap that wraps, a `--card-border` rule above it, and a 7 px dot before each freshness entry. The dots exist as `<span role="img" class="delivery-dot-glyph delivery-hue-*">●</span>` (from `dotClass`, keyed by `data-freshness-state`).

This slice does three things:

1. **Tickets becomes a card with a header bar.** Add `delivery-card` to the `<section>`, put the `h2` and the `data-tickets-header` line in a `delivery-head` (the title in `delivery-title`, the header text and the `show all` control beside it in `delivery-counts`). Replace each Tailwind colour utility with `delivery-text-muted`, `delivery-text-link` or a rule in `styles/delivery-bottom.css`. The ticket row takes `delivery-row delivery-row-ruled`, the Kind cell takes `delivery-kind`, and the Do cell takes the link colour with weight 600 and `white-space: nowrap`. The Age cell takes `delivery-text-muted`.
2. **The Machine table and the footer are styled in `styles/delivery-bottom.css` through their existing `data-*` attributes**: `[data-machine-rows] th`, `[data-machine-rows] td`, `[data-machine-line] [data-machine-dot]`, `[data-footer-line]`, `[data-freshness]`. Their markup classes are Primitives'; do not edit `AgentList.tsx`.
3. **The "… n more" line** (the `data-tickets-fold` row) takes the muted body colour with the link-coloured button, in a `delivery-row-ruled` row.

Read the plan's *Primitives* section for the classes you build on: `.delivery-card`, `.delivery-head`, `.delivery-title`, `.delivery-counts`, `.delivery-count-n`, `.delivery-chip`, `.delivery-dot`, `.delivery-grid`, `.delivery-thead`, `.delivery-row`, `.delivery-row-ruled`, `.delivery-kind`, `.delivery-truncate`, `.delivery-text-*` and `.delivery-hue-*`. They live in `styles/delivery.css`. Plan *Sections* (`feature/delivery-visual-bottom`) is the specification; this brief orients and corrects.

### The decisions the plan settles — do not re-derive them

**Tickets has no `count` and `words` field, and this slice adds none.** The Delivery plan's seven domain items give `count` and `words` to the You header and `SectionCount` (item 6) and to the Release header (item 7). `ticketsSection(...).header` stays one string ("30 assigned to you with no plan"), and `one-grid.browser.test.ts:320` reads it with `/\d+ assigned to you with no plan/`. Render the string in one element. Do not split the number from the words in the component: that is a decision made in `.tsx`, the failure *Every rendered state is a domain property* forbids. The mockup's bold number is therefore not reproduced for Tickets; report it as a finding for a follow-up domain field instead of parsing the string.

**The mockups lose where the spec text disagrees.** Three cases here. The mockup writes the Age cell as `5d`; the spec forbids abbreviated text where the row has room, so keep `tupleAgeText` as it is. The mockup shows `bug` in the Kind cell; no domain field carries a ticket kind, so keep the literal `Ticket`. The mockup uses 10 px for column headers and the kind cell; the plan fixes 11 px (Primitives' `.delivery-thead` and `.delivery-kind` already do).

**The mockup's frame-and-box step (`#0b1020` then a lighter box) is not reproduced.** Tickets sits on `--card-surface` with a `--card-border` border through `.delivery-card`. Add no token and no extra box.

**A dot is never colour alone.** The Machine dot keeps `role="img"` and `aria-label={machine.word}` next to the visible word, and each footer dot keeps its `aria-label` and its `aria-hidden` word. Do not remove either when you restyle: Primitives' rule *A dot carries its state as text too* binds this slice.

**The footer dot colour is a lookup over the domain's `FreshnessState`, and it already exists.** `dotClass` maps `fresh`, `aging`, `stale` and `unknown` to `delivery-hue-*` in `AgentList.tsx`. Style `[data-freshness-state="..."]` in your stylesheet only where you need more than that class gives; do not add a second map and do not test a word or an age in CSS or in the component.

**Tokens, not hex, and unlayered.** Every colour is a `--card-*` or `--hue-*` token, and the rules live in `styles/delivery-bottom.css`, which Primitives imports unlayered after `@import "tailwindcss"`. A `dark:` utility or a hex value on a bottom element is the failure this plan removes. Keep a Tailwind utility only for layout (`flex`, `gap-*`, `min-w-0`, `truncate`). Remove each colour, border and background utility you replace: a utility and a rule that set one property leave the cascade for the next reader to untangle.

**Selectors and class-reading tests.** Every `data-*` attribute, `role` and `aria-label` on these elements stays with its value: `data-section="tickets"`, `data-tickets-state`, `data-tickets-header`, `data-tickets-show-all`, `data-tickets-fold`, `data-issue-row`, `data-issue-link`, `data-issue-number`, `data-plan-it-reason`, `data-machine-line`, `data-machine-dot`, `data-machine-rows`, `data-footer-line`, `data-freshness`, `data-freshness-state`, `data-unplaced-toggle`. Measured on `origin/main` on 2026-11-19, no test under `packages/board/test` reads a Tailwind colour class on these elements (`tickets-section.browser.test.ts`, `one-grid.browser.test.ts`, `agents-tab.browser.test.ts`, `fleet-read-ref-age.browser.test.ts`, `mine-filter.browser.test.ts` read `data-*` attributes and text). Re-check with `grep -rn "slate-\|blue-600\|text-xs" packages/board/test` against `data-tickets`, `data-machine` and `data-footer` before you remove a class. If a test reads one, move it to a `data-*` attribute in the same PR and say so in the PR body.

**A grid header row is hidden below 640 px and visible from it.** Primitives' `.delivery-thead` does this and `TicketsSection.tsx:81` carries `hidden sm:grid`. Keep both; the cells stack below 640 px as `grid-cols-[...]` does not apply there. Do not make the header visible at 320 px.

**Rules carried over unchanged:** a function you write is an arrow; absent is not false (a Tickets state other than `rows` renders `data-tickets-absent` with its sentence, never an empty table, and a section with `foldLabel === null` renders no fold row); a cell that cannot hold its text cuts it at the end with an ellipsis (`delivery-truncate`) and keeps the full text as its `title`; no abbreviated text where the row has room; icons come from `glyphs.ts` only, so add no SVG path.

### Done when

The plan's *Sections* done-when is the specification. CI gates: this branch's browser tests and the existing ones pass, and `delivery-tab-screenshots.browser.test.ts` passes, with no horizontal scroll at 320 px. A reviewer judges that Machine, Tickets and the footer match `bottom-of-tab.html` within the spec's text: the dark theme against the mockup, the light theme by eye against the dark mockup, from the `delivery-screenshots` artifact of the CI run on the PR head.

The assertions that exist because a naive implementation would pass without them:

- **One computed style from `delivery-bottom.css` on a real bottom element, not only the marker rule.** The screenshot test reads `--delivery-section` from `[data-footer-line]`, which proves the file loads. It does not prove a rule from the file beats a Tailwind utility. Assert the Tickets `Do` cell's computed colour equals `--hue-blue`, or the footer's computed `border-top-color` equals `--card-border`. A utility left on the element wins silently.
- **The Tickets card at both widths.** At 1280 px the header row shows and the four columns align; at 320 px the header row is hidden, the cells stack and `document.documentElement.scrollWidth <= 320`. A rule written for the wide case passes the 1280 px render and breaks the narrow one.
- **A Tickets section that is not `rows` stays a plain line.** With `data-tickets-state="failed"` or `unasked`, the section renders its card, its title and the `data-tickets-absent` sentence, and no empty `ul`.
- **The footer wraps and does not scroll.** At 320 px every `[data-freshness]` entry stays inside `[data-footer-line]` (its `scrollWidth` does not exceed its `clientWidth`).

Plus: this slice touches `.tsx` and `.css`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e`, and do not run the board's browser suites at a fleet desk. The slice adds no `.sh`; if it did, `scripts/check-shell-lines.sh` would refuse a longer shell total than its merge base. Add a changeset for `@plot-pm/board` (description first, `bumps:` block last). Do not commit a rebuilt `board-server.mjs`: `scripts/check-no-bundle-diff.sh` refuses it, and `main` builds its own bundles after each merge.

### Bookkeeping

Open the PR through `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Name in the PR body: your re-measured line ranges, any class-reading test you moved to a `data-*` attribute, the `delivery-screenshots` artifact link, and the four images for this section (light, dark, 320, mockup `bottom-of-tab.html`). Name the Tickets header-count gap (no `count` and `words` field) as a finding.

### Scope guard

This branch owns: `components/TicketsSection.tsx` (except the header row Primitives owns at `:81`, whose classes you leave) and `styles/delivery-bottom.css`, plus the tests that cover them. Do not edit `AgentList.tsx`, `index.css`, `SprintCard.tsx`, `FleetCard.tsx`, `TupleRow.tsx`, any other `styles/*.css`, or any domain file: the Machine section's and the footer's markup is Primitives'. Add no domain field, no reading and no host call.

Other branches in flight, same heading: `feature/delivery-visual-tab-header` (`TodoList.tsx`, `ReleaseCard.tsx`, `DeliveryFilters.tsx`, `ReleaseApprove.tsx`, `delivery-header.css`), `-release` (`AgentList.tsx` Release block, `ReleasePersonCards.tsx`, `PlanCard.tsx`, `delivery-release.css`), `-you` (`draft-plan-row.tsx`, `delivery-you.css`), `-work-items` (`DeliveryRows.tsx`, `delivery-work-items.css`), `-fleet` (`FleetAgentRow.tsx`, `FleetControls.tsx`, `delivery-fleet.css`). No file is shared with this branch.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
