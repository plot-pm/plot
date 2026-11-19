## Implementation brief — delivery-tab-matches-its-mockups (wave 3: Sections — release)

- **Plan (canonical):** docs/plans/2026-11-18-delivery-tab-matches-its-mockups.md on main
- **Approved:** 2026-11-18, Jan Wloka, plan-PR #3531 merged
- **Branch:** `feature/delivery-visual-release` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This branch is one of six under the *Sections* heading, and all six run in parallel. They wait on *Domain fields* (#3541) and *Primitives* (#3542) by heading order, and both merged on 2026-11-19, so the slice is startable. The other five (`-tab-header`, `-you`, `-work-items`, `-fleet`, `-bottom`) own disjoint files; none edits `index.css`. This is the only *Sections* branch that edits `AgentList.tsx`.

### What to build

The Release delivery section sits in Primitives' card with its header bar, but its body still has the old look. Measured on `origin/main` at `cc8dd08c0`, `AgentList.tsx:1613-1694` renders: a `<p data-release-line>` in `text-slate-600 dark:text-slate-300`; a bordered `<ul data-delivered>` with `divide-y divide-slate-200 rounded-lg border` (a second box inside the card); plan rows that show the strip as text only ("2 delivered 1 at-a-gate"); opened lines in `text-blue-600` / `text-slate-500`; and `ReleasePersonCards.tsx` with its own `SEGMENT_CLASS` map in sky and amber Tailwind utilities. The mockups show a table with Plan · Phase · Slices · Owner columns, one block per slice in the strip, a Phase chip, and Done / In flight / To do lines with a coloured state, a linked slice and PR, and a relative merge time.

Build, in the mockups' look (`delivery-toggle-icons-v2.html`, `plan-slices.html`):

- The Release and Sprint delivery plan rows as a table with visible Plan, Phase, Slices and Owner column headers, and the row rules from Primitives.
- The Phase chip. It is a neutral chip with a left bar in the class that `PHASE_ACCENT[plan.accent]` gives. Export `PHASE_ACCENT` from `components/PlanCard.tsx:17` (add the `export` keyword, no value change) and import it. Draw the chip from `plan.phase` and `plan.accent`; no component tests the word `Development`.
- The slice strip as one `.delivery-strip-block` per slice in the five-state colour map (`.delivery-state-<SliceState>`), beside the existing text.
- The opened Done, In flight and To do lines: state colour from `line.state`, the slice and the PR as two separate links where `line.pr` exists, and `line.merged` as the relative time.
- `ReleasePersonCards.tsx` moved from its private `SEGMENT_CLASS` to the shared `SEGMENT_CLASS` that `SprintCard.tsx:3` exports (`delivery-state-*`), so the person bars, the sprint bar and the release bar share one palette. Its card chrome (`border-slate-200 bg-white dark:…`) moves to tokens.
- `styles/delivery-release.css` holds every rule. It already carries the `--delivery-section: release` marker that the screenshot test reads; keep it.

The plan is canonical; this brief orients and corrects.

### The decisions the plan settles — do not re-derive them

**The domain fields are built; render them and compute nothing.** On `main`: `PlanRowFacts.phase` and `.accent` (`release-plan-rows.ts:174-185`), `PlanLine.state`, `.pr` and `.merged` (`:117-131`), `ReleaseBlockView.counts`. `PlanLine.text` keeps the ISO date and `release-plan-rows.test.ts` still asserts it. A component that tests a string, a count or a threshold to choose a style is a defect (CLAUDE.md, *Every rendered state is a domain property*). A class name maps a field: `line.state` to `delivery-state-*` or a hue class, `plan.accent` to `PHASE_ACCENT`. If a mockup shows a state that no field carries, report it; add no field.

**One phase map: `PHASE_ACCENT`.** The alternative, the mockups' blue and teal Phase chips, is rejected: it would be a second map beside the Plans tab's, and a plan would change colour between tabs. `accent` is `neutral` for a non-default phase, and `PHASE_ACCENT` has a `neutral` entry, so a missing key falls back to it, as `PlanCard.tsx:185` does.

**The five-state colour map is fixed:** delivered green, at a gate amber, being built blue, blocked red, not started `--card-track`. `ReleasePersonCards.tsx` today colours a gate sky and a blocked slice amber. That is the inversion the plan exists to fix; do not keep it for the person bars.

**The header counts are Primitives'.** Do not touch the header bar, the `h2`, `CountWords` or `COUNT_HUE` (`AgentList.tsx:182-200`). `ReleaseBlockView.counts` is already rendered there. Your block starts at the `release && view.releaseBlocks.map` line.

**A dot or colour never stands alone.** A strip block carries its state as words: keep `data-strip-segment` text, and give the block strip `role="img"` with an `aria-label` that lists `count state` pairs, as `data-person-card-bar` does. The plan's *Rules That Hold* says a dot carries its state as text too.

**No abbreviated text where the row has room.** A cell that cannot hold its text cuts it at the end with an ellipsis (`.delivery-truncate`) and keeps the full text as `title`. Never shorten a label to fit a mockup.

**`LINK_CLASS` and the Do verb belong to other branches.** Do not edit `DeliveryRows.tsx`. `PlanActions` stays as it is; style its cell, not its buttons.

### Selectors that must survive — the trap in this slice

Three integration tests read the strip's text, so a strip rewritten as blocks only passes review and fails CI:

- `[data-strip-segment="delivered"]` `textContent` in `split-plan-counts-elsewhere.browser.test.ts:151`, `slice-status-speaks-verdict.browser.test.ts:75` and `mock-board.browser.test.ts:86`.
- `[data-plan-strip]` `textContent` in `mock-board.browser.test.ts:102` and `:140`, compared before and after a refresh: it must stay the same string.
- `li[data-plan-row="<plan>"]` inside `[data-release-block]`, in all three; and `data-plan-toggle`, `data-plan-lines`, `data-plan-line`, `data-plan-line-link`, `data-plan-owner`, `data-strip-text`, `data-strip-unread`, `data-release-line`, `data-person-card*`.

So: add the block strip as a new element and keep the text spans, visually hidden only if the mockup has no room for both, and then with `sr-only`, never removed. Do not move an attribute without moving it with its element. If a test reads a Tailwind class on an element you restyle (`agents-tab.browser.test.ts` reads `ring-amber-400`, `text-red-600`, `text-emerald-700` elsewhere), the plan says to move that test to a `data-*` attribute in the same PR and say so in the PR body; none of those elements is in this block, so expect no move.

**Primitives' unlayered stylesheet beats Tailwind utilities.** The imports are unlayered, so a rule in `delivery-release.css` outranks a Tailwind utility that sets the same property. Remove the old utility from the element anyway: a leftover `rounded-lg border` on `ul[data-delivered]` is a second box inside the card, and it is the first thing the screenshot shows.

### Done when

The plan's *Sections* done-when is the specification. CI gates: this branch's browser tests and the existing ones pass, and `delivery-tab-screenshots.browser.test.ts` passes, with no horizontal scroll at 320 px. A reviewer judges that Release delivery matches `delivery-toggle-icons-v2.html` and `plan-slices.html` within the spec's text: the dark theme against the mockup, the light theme by eye against the dark mockup, from the `delivery-screenshots` artifact of the CI run on the PR head.

The assertions that exist because a naive implementation would pass without them:

- **One computed style from `delivery-release.css` on a real element, not only the marker rule.** The screenshot test reads `--delivery-section` from `[data-section="release-delivery"]`, which proves the file loads and nothing more. Assert the computed background of one `.delivery-strip-block` under a `delivered` slice equals `--hue-green-dot`, and the Phase chip's left bar for one phase equals the colour `PHASE_ACCENT` gives. A utility left on the element wins silently.
- **The text strip survives.** The three tests above fail if `[data-strip-segment]` text is removed; run them in your head before you push, because you cannot run them at the desk.
- **Plan rows with no `phase`.** `PlanRowFacts.phase` is absent where no row of the plan names one. The Phase cell renders empty, with no chip and no `undefined`, and the grid columns still line up.
- **A merge time that does not parse.** `PlanLine.merged` is absent; the line shows state and links and no stray `·`.
- **320 px.** The table stacks below 640 px as `max-sm:grid-cols-1` does, with the header row hidden, as Primitives' table rule says.

Plus: this slice touches `.tsx` and `.css`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e`, and do not run the board's browser suites at a fleet desk. The slice adds no `.sh`; if it did, `scripts/check-shell-lines.sh` would refuse a longer shell total than its merge base. Add a changeset for `@plot-pm/board` (description first, `bumps:` block last). Do not commit a rebuilt `board-server.mjs`: `scripts/check-no-bundle-diff.sh` refuses it, and `main` builds its own bundles after each merge.

### Bookkeeping

Open the PR through `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Name in the PR body: your re-measured line ranges (the plan's were taken at `b13b8852e`, and `AgentList.tsx` has moved since), the path of the per-person card component (`components/ReleasePersonCards.tsx`), any class-reading test you moved to a `data-*` attribute, the `delivery-screenshots` artifact link, and the four images for Release delivery (light, dark, 320, mockup).

### Scope guard

This branch owns: the Release delivery block in `AgentList.tsx` (from the `release && view.releaseBlocks.map` line to its closing `))}`, `:1613-1694` on `cc8dd08c0`), `components/PlanCard.tsx:17` (the `export` keyword only), `components/ReleasePersonCards.tsx`, `styles/delivery-release.css`, and the tests that cover them. Do not edit `index.css`, `SprintCard.tsx` (import its `SEGMENT_CLASS`; do not change it), `FleetCard.tsx`, `ReleaseCard.tsx`, `TupleRow.tsx`, any other `styles/*.css`, the header bar of any section, or any domain file. Add no domain field, no reading and no host call.

Other branches in flight, same heading: `feature/delivery-visual-tab-header` (claimed; `TodoList.tsx`, `ReleaseCard.tsx`, `DeliveryFilters.tsx`, `ReleaseApprove.tsx`, `delivery-header.css`), `-you` (`draft-plan-row.tsx`, `delivery-you.css`), `-work-items` (`DeliveryRows.tsx`, `delivery-work-items.css`), `-fleet` (`FleetAgentRow.tsx`, `FleetControls.tsx`, `delivery-fleet.css`), `-bottom` (`TicketsSection.tsx`, `delivery-bottom.css`). No file is shared with this branch. `ReleaseCard.tsx` imports `SEGMENT_CLASS` from `SprintCard.tsx`, the same map you move the person cards onto, so the release bar and the person bars end in one palette without either branch touching the other's file.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
