## Implementation brief — delivery-tab-matches-its-mockups (wave 3: Sections — fleet)

- **Plan (canonical):** docs/plans/2026-11-18-delivery-tab-matches-its-mockups.md on main
- **Approved:** 2026-11-18, Jan Wloka, plan-PR #3531 merged
- **Branch:** `feature/delivery-visual-fleet` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This branch is one of six under the *Sections* heading, and all six run in parallel. They wait on *Domain fields* (#3541) and *Primitives* (#3542) by heading order, and both merged on 2026-11-19, so the slice is startable. The other five (`-tab-header`, `-release`, `-you`, `-work-items`, `-bottom`) own disjoint files; none edits `index.css`.

### What to build

The Fleet section does not look like `fleet-section-v3.html`. Measured on `origin/main` on 2026-11-19: `FleetAgentRow.tsx` and `FleetControls.tsx` still carry Tailwind palette classes with `dark:` variants (`text-slate-400`, `text-slate-500 dark:text-slate-400`, `bg-red-500` / `bg-emerald-500` on the time bar, `border-slate-300 dark:border-slate-700` on the stepper buttons, `accent-slate-500` on the checkboxes), so none of the section's own cells draws from the `--card-*` and `--hue-*` tokens. `styles/delivery-fleet.css` holds only the marker rule `[data-section="fleet"] { --delivery-section: fleet; }`. The agent row has no state dot at all; the mockup puts a 7 px dot before the agent id.

This slice styles, in the mockup's look:

- **The agent rows** (`FleetAgentRow.tsx`): the Agent cell with its state dot (green in Working, amber in Blocked), the Role chip, Acting on with its branch beneath in the muted colour, Doing now (Waits on in Blocked) with the last-commit line beneath, and the Tokens and Time left cells right-aligned.
- **The Time left bar**: a 4 px track on `--card-track` and a fill that drains. The fill is `--hue-green-dot` and turns `--hue-red-dot` where `timeLeftBar.red` is true.
- **The switches and the stepper** (`FleetControls.tsx`): dispatch, review, verify and design as switches, and the parallel-agents stepper with its `−` and `+` buttons, on the header line, right-aligned.

Read the plan's *Primitives* section for the classes you build on: `.delivery-card`, `.delivery-head`, `.delivery-counts`, `.delivery-group-plain`, `.delivery-chip` with `.delivery-hue-*`, `.delivery-dot`, `.delivery-thead`, `.delivery-row`, `.delivery-row-ruled`, `.delivery-text-*`, `.delivery-truncate`. They live in `styles/delivery.css`. Plan *Sections* and the spec's *Fleet* section are the specification; this brief orients and corrects.

### The decisions the plan settles — do not re-derive them

**The Free line, the counts line and the switches slot are Primitives' markup.** They already sit in `AgentList.tsx` (`data-fleet-control-column` at `:1609`, `data-fleet-tokens-today` at `:1599`). Style them from `styles/delivery-fleet.css` through their existing `data-*` attributes. Do not edit `AgentList.tsx`: only `feature/delivery-visual-release` edits it in this wave, and an edit from you is a merge conflict with no gain.

**The read-only switches on the fleet card take the same look because they are the same components.** `FleetCard.tsx` renders `AutoDispatchSwitch`, `AutoSwitch` and `ParallelAgentsStepper` with `readOnly`. Restyling them in `FleetControls.tsx` restyles the card with no edit to `FleetCard.tsx`, which is Primitives'. The mockups show the card's switches as text and the spec shows them read-only; **the spec text wins**, so the card keeps real read-only switches. Check that the card still reads as read-only after your change: a `readOnly` switch must not look like one a click toggles. Keep the `data-fleet-card-*` attributes (`data-fleet-card-auto-dispatch`, `data-fleet-card-auto-switch`, `data-fleet-card-parallel-agents`) with their values.

**The switch stays a native checkbox with a text label.** `FleetControls.tsx:67-72` records why: `role="switch"` was rejected because the board owns no switch styling and a native checkbox already announces on and off. Draw the mockup's track and knob with CSS on the checkbox (`appearance: none` and a pseudo-element for the knob) and keep the `<label>` text. A `<span>` track with `role="switch"` rebuilds the keyboard and `aria-checked` contract by hand and breaks `fleet-settings.browser.test.ts`.

**A dot is never colour alone.** The plan's rule: a dot beside no visible word carries `role="img"` and an `aria-label` with the word. The group heading above the rows (`Working`, `Blocked`) is the word for the dot, so a dot inside a row may be `aria-hidden`; say which you chose in the PR body. Choose the dot colour from the row's group, not from a test in the component: the groups carry `data-group="working"` and `data-group="blocked"` (`AgentList.tsx:1772`), so a `[data-group="working"] [data-agent-cell="agent"] .delivery-dot` rule in `delivery-fleet.css` is a lookup over an existing domain key. `FleetAgentRow` receives only `cells`, so passing it a group prop is a markup change you may make, but do not compute a state in it.

**The time bar's red is the domain's, not yours.** `cells.timeLeftBar.red` is true below 20 % left (spec: *Writer's call: the 20 % threshold*), and `data-time-left-red` carries it. Today the component maps `red` to `bg-red-500` and its negation to `bg-emerald-500`. Replace the two utilities with `[data-time-left-red="true"]` and `="false"` rules on the bar's fill, in tokens. Do not compare `fraction` to a number anywhere: that moves a decision into the component. The fill's `width` stays an inline style, because it is a measured value and not a class.

**Role chips are Primitives'.** `RoleChip.tsx` maps the domain's `ChipColour` to `delivery-hue-*` and is already on tokens. Do not edit it. The mockup's eight role colours come out of `roleChip` through that map; if one reads wrong, report it rather than patching a colour in `delivery-fleet.css`.

**The mockups lose where the spec text disagrees.** The mockup's column headers are 10 px; the plan fixes 11 px for column headers, 13 px for rows, 15 px for section titles. The mockup's Time left column is 90 px wide and `FleetAgentRow` uses `5rem`; keep the grid template unless a cell cannot hold its text, and then cut it at the end with an ellipsis and keep the full text as `title`. No abbreviated text where the row has room.

**Tokens, not hex, and unlayered.** Every colour is a `--card-*` or `--hue-*` token, and the rules live in `styles/delivery-fleet.css`, which Primitives imports unlayered after `@import "tailwindcss"`. A Tailwind colour utility and a rule that set one property make the cascade the next reader has to untangle: remove each colour, border and background utility you replace. Keep `flex`, `grid`, `gap-*`, `min-w-0` and `truncate` for layout. A `dark:` utility or a hex value on a Fleet element is the failure this plan removes.

**Class-reading tests.** The plan lists the tests that read a class name (*Tests and Selectors*). Measured on 2026-11-19, the tests that name these two components are `fleet-card.test.ts`, `fleet-settings.browser.test.ts`, `agents-tab.browser.test.ts`, `supervisor-badge.browser.test.ts` and `an-unnamed-desk-says-so.browser.test.ts`. `supervisor-badge.browser.test.ts` reads a class and is on the plan's list. Its element is the supervisor badge at `FleetControls.tsx:426-457` (`data-fleet-supervisor*`), which is **not in this slice's scope**: leave its classes alone. For every other class you remove, run `grep -rn "<class>" packages/board/test` first. If a test reads one, move it to a `data-*` attribute in the same PR and say so in the PR body.

**Rules carried over unchanged:** a function you write is an arrow (leave the `function` declarations in `FleetControls.tsx` you do not rewrite — the unit is the function, not the file); absent is not false (`timeLeft === null` renders the dash and no bar, never an empty bar); icons come from `glyphs.ts` only, so add no SVG path; every `data-*`, `role`, `aria-label` and `id` the board renders today stays with its value.

### Done when

The plan's *Sections* done-when is the specification. CI gates: this branch's browser tests and the existing ones pass, and `delivery-tab-screenshots.browser.test.ts` passes, with no horizontal scroll at 320 px. A reviewer judges that the Fleet section matches `fleet-section-v3.html` within the spec's text: the dark theme against the mockup, the light theme by eye against the dark mockup, from the `delivery-screenshots` artifact of the CI run on the PR head.

The assertions that exist because a naive implementation would pass without them:

- **One computed style from `delivery-fleet.css` on a real Fleet element, not only the marker rule.** The screenshot test reads `--delivery-section` from `[data-section="fleet"]`, which proves the file loads. It does not prove a rule from the file beats a Tailwind utility. Assert the computed background of a Working row's dot equals `--hue-green-dot`, and of a Blocked row's dot `--hue-amber-dot`. A utility left on the element wins silently.
- **The red bar and the green bar are different computed colours.** Assert the fill under `[data-time-left-red="true"]` computes to `--hue-red-dot` and under `"false"` to `--hue-green-dot`. A rule that styles the track and leaves the fill's old utility passes a render and fails this.
- **The read-only switch stays disabled and stays distinguishable.** Assert a `[data-fleet-card-auto-switch]` checkbox is `disabled` and a `[data-fleet-auto-switch]` one is not. A switch redrawn with `appearance: none` can lose the native disabled cue, so the card's switches would look clickable.
- **The Fleet header's switches wrap at 320 px.** The plan says they wrap onto the next line; the 320 px screenshot test asserts `scrollWidth <= 320`. A `nowrap` on the control column passes at 1280 px and fails there.

Plus: this slice touches `.tsx` and `.css`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e`, and do not run the board's browser suites at a fleet desk. The slice adds no `.sh`; if it did, `scripts/check-shell-lines.sh` would refuse a longer shell total than its merge base. Add a changeset for `@plot-pm/board` (description first, `bumps:` block last). Do not commit a rebuilt `board-server.mjs`: `scripts/check-no-bundle-diff.sh` refuses it, and `main` builds its own bundles after each merge.

### Bookkeeping

Open the PR through `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Name in the PR body: your re-measured line ranges, any class-reading test you moved to a `data-*` attribute, how the row dot carries its word, the `delivery-screenshots` artifact link, and the four images for the Fleet section (light, dark, 320, mockup).

### Scope guard

This branch owns: `components/FleetAgentRow.tsx` (`FleetAgentRow`), `components/FleetControls.tsx` and `styles/delivery-fleet.css`, plus the tests that cover them. Do not edit `AgentList.tsx`, `index.css`, `FleetCard.tsx`, `RoleChip.tsx`, `TupleRow.tsx`, any other `styles/*.css`, or any domain file. `FleetAgentHeader` in `FleetAgentRow.tsx` is Primitives' and is already on `.delivery-thead`; leave it. Add no domain field, no reading and no host call.

Other branches in flight, same heading: `feature/delivery-visual-tab-header` (`TodoList.tsx`, `ReleaseCard.tsx`, `DeliveryFilters.tsx`, `ReleaseApprove.tsx`, `delivery-header.css`), `-release` (`AgentList.tsx` Release block, `ReleasePersonCards.tsx`, `PlanCard.tsx`, `delivery-release.css`), `-you` (`draft-plan-row.tsx`, `delivery-you.css`), `-work-items` (`DeliveryRows.tsx`, `delivery-work-items.css`), `-bottom` (`TicketsSection.tsx`, `delivery-bottom.css`). No file is shared with this branch. `FleetCard.tsx` renders your switch components, so a change to their props in `FleetControls.tsx` must keep `FleetCard.tsx` compiling untouched.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
