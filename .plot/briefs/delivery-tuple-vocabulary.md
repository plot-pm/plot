## Implementation brief — delivery-link-tuples-everywhere (wave 1: Tuple vocabulary)

- **Plan (canonical):** docs/plans/2026-11-20-delivery-link-tuples-everywhere.md on main
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3583 merged
- **Branch:** `feature/delivery-tuple-vocabulary` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is wave 1 of 2. `feature/delivery-tuples-in-every-row` waits on it and wires the tuple into every row, section header and the Tickets section; plans 4 (`delivery-tab-has-one-header`) and 5 (`delivery-rows-act-from-one-place`) wait on that. This branch waits on nothing. The design spec is `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md` (outside the repo; read its *Link tuples* section) and `header-and-sections-v2.html` beside it is the visual reference.

### What to build

Today a slice row shows its PR and its branch as two unrelated links in slot 4 (`TupleRow.tsx:808-816`, `gap-x-3` apart; the links come from `tuple-row.ts:1505-1520`), each a bare icon and label with no border. Slot 4 can name only six things (`TupleLink['what']`, `tuple-row.ts:53`: `plan | branch | pr | ticket | wave | worktree`), so a release, a story or a sprint cannot be drawn as a link at all. This slice builds the tuple primitive: one bordered pill of one or more linked segments, each segment with its Octicon, so that `[PR 3581 | bug/…]` is one object with two links. It extends the segment kinds to release, story and sprint, draws ticket segments in their own colour, and makes a PR or ticket number immune to truncation. It then uses the primitive at the one place a PR and its branch sit side by side today (the slice row's `solePr` plus branches), so a browser test can prove it. Wiring every other row, header and menu is the next branch.

Build on what exists. `TupleRow.tsx` and `tuple-row.ts` are the tuple; `TupleLinkView` draws one segment; `PlanTicketKeys` (`TicketHrefContext` is provided at `App.tsx:1286`) already draws a plan's ticket keys as links. Extend them. Add no second tuple component, icon table or ticket vocabulary. The plan is canonical; this brief is orientation.

### The decisions the plan settles — do not re-derive them

**The glyphs already exist. Do not add them.** The plan says to add `tag`, `book`, `stack` and a sprint glyph to `GLYPH_PATH`. `glyphs.ts` already holds `release` (tag), `story` (book), `wave` (stack) and `sprint` (iterations), added by `5df183797`. What is missing is `LINK_ICON_PATH` (`tuple-row.ts:208-215`), which names only six kinds, and the `what` union. That also answers the plan's open question: the sprint segment uses the existing `sprint` glyph, Octicon `iterations`. Record the answer in the plan's Notes.

**`wave` is the slice kind; do not add a `slice` beside it.** `linkIconKind('wave')` returns `'slice'` (`link-icon.ts`), and `LINK_ICON_PATH.wave` is the stack glyph. A second `what: 'slice'` would give one thing two spellings, and CLAUDE.md says no new code may add to the Wave/Slice defect. Add `release`, `story` and `sprint` to `what` and to `LINK_ICON_PATH` (read `GLYPH_PATH.release` and the others directly, as `worktree` does; `KIND_ICON_PATH` is typed `Record<RowKind, string>` and may not hold them). If you read the plan's word "slice" differently, report it in the PR rather than choosing silently.

**The segments are a domain property, not a decision in the component.** Which segments a tuple has, their kinds, targets and ticket keys come from a pure function with a unit test; the component maps them and decides nothing (CLAUDE.md, "Every rendered state is a domain property"). Put it with the other slot rules in `tuple-row.ts` or in `lib/agent-rows/`, and the kind-to-icon mapping through `linkIconKind` where it fits. Write every new function as an arrow with factual TSDoc, and leave neighbouring declarations alone (the unit is the function; a rewrite destroys `git blame`). A naive implementation that decides the segments in JSX passes a browser test and fails this rule.

**A PR and its branch are one tuple with two links, in that order.** One pill, two segments, each with its own `href`. Where either has no address in the payload, that segment stays text with no anchor (`data-tuple-text`, as today): no URL is invented. The plan's non-goal is no new data source.

**A number never truncates; a branch does, in the middle.** PR number and ticket key segments are `shrink-0`. The branch segment keeps `splitBranch` and `BRANCH_TAIL_CHARS` (`tuple-row.ts:229-262`) as they are: end-truncation renders the six `feature/opus5-hardening-*` branches identically, which reads as six duplicate rows, and that is why the elision is in the middle. The full name shows on hover (`title`) and stays the accessible name (`linkLabel`, `aria-label`), because the folded label is two `aria-hidden` spans and would otherwise announce `feat ure/…`.

**The ticket colour is a token, not a literal.** The mockup uses purple. `index.css` already defines `--hue-violet`, `--hue-violet-dot` and `--hue-violet-soft` with a dark-theme override (`:160`); use them and check both themes by looking at the rendered tab. `PlanTicketKeys` today uses `text-(--card-meta)` (grey) for the plan card heading's keys; that heading is not a Delivery tuple, so do not recolour it. Give the tuple's ticket segments a colour through the tuple's own class.

**A key with no address stays text.** `PlanTicketKeys` already prints an unresolved key as muted text and never as a link; keep that. The ticket segment is a link only where `ticketHref(key)` answers.

**Rules carried over from related work:** an absent value is not a false one (an artifact with no URL is text, not a dead link); read the exit code, not the emptiness; one icon vocabulary (`GLYPH_PATH` is the only glyph table); plan, branch and PR labels that are numbers stay in the plain form the existing `data-pr-number` / `data-pr-link` hooks read, so the existing browser tests keep their selectors.

### Done when

The plan's `## Done when` items for this wave are the specification: the tuple's segment kinds cover every kind `linkIconKind` names that the tab draws; a PR and its branch are one bordered tuple with both halves linked; ticket segments carry their own colour; a number never truncates. Lift these assertions, because a naive implementation passes without them:

- A unit test over the segment function: PR with branch gives two segments in order `pr`, `branch`; PR with no URL gives a text segment and no anchor; a branch with no `branchUrl` gives text. This catches a tuple that links a segment it has no address for.
- A unit test that every `TupleLink['what']` has an entry in `LINK_ICON_PATH` and that `release`, `story` and `sprint` resolve to the `GLYPH_PATH` entries of the same name. The record type makes a missing entry a compile error; the test catches a wrong glyph.
- A unit test that a ticket segment's key text is exactly the key, with no ellipsis, at any width the function is given, and that a 60-character branch yields a non-empty `tail` from `splitBranch`. This catches truncation moving onto the number.
- One browser test (`packages/board/test/integration/tuple-row.browser.test.ts`) proves the page shows one bordered tuple for a slice's PR and branch, both anchors present, the branch's full name in its `title`, and a ticket segment in its colour. It proves the page shows it; the segments themselves are unit-tested.
- Look at the rendered tab in light and dark, and at 320 px width: no horizontal scroll, the PR number intact, the branch elided. Check by looking, not by reading the diff.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. Run `pnpm build:board` only to look at the result in a browser, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Add a changeset for the package `@plot-pm/board`, the description first and at least 20 characters, then the `plan: docs/plans/2026-11-20-delivery-link-tuples-everywhere.md` line inside the comment block (`scripts/check-changeset-packages.sh` checks the order and the package name). This slice changes no skill, so the changeset names no `bumps:` entry. It touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` has nothing to count; if you find you need one, pay for the growth in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the tuple primitive and its vocabulary: `packages/board/src/app/lib/tuple-row.ts` (`TupleLink`, `LINK_ICON_PATH`, the new segment function), `packages/board/src/app/components/TupleRow.tsx` (`TupleLinkView` and the slot 4 site for the slice row), `packages/board/src/app/components/PlanTicketKeys.tsx` (only the ticket segment's colour), the colour tokens in `index.css` only if the violet set lacks one you need, and the unit and browser tests of those. It reads `packages/domain/src/rules/link-icon.ts` and `glyphs.ts` and changes neither unless a kind is genuinely missing.

It does not wire the tuple into section headers, the Tickets section, the ⋯ menus or any row other than the slice row's PR and branch pair; that is `feature/delivery-tuples-in-every-row`. Verified 2026-11-20: no open PR touches `tuple-row.ts`, `TupleRow.tsx`, `PlanTicketKeys.tsx`, `glyphs.ts`, `link-icon.ts` or `TicketsSection.tsx`, and no `feature/delivery-*` branch is pushed. Plan 2 of the sprint runs in parallel and shares no file with this branch as far as the plan states; if you find it editing one of these files, stop and report.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
