## Implementation brief — delivery-link-tuples-everywhere (wave 2: Tuples in every row)

- **Plan (canonical):** docs/plans/2026-11-20-delivery-link-tuples-everywhere.md on main
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3583 merged
- **Branch:** `feature/delivery-tuples-in-every-row` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is wave 2 of 2. Wave 1, `feature/delivery-tuple-vocabulary`, merged as #3584 and built the tuple primitive. Plans 4 (`delivery-tab-has-one-header`), 5 (`delivery-rows-act-from-one-place`) and the Tickets plan (`tickets-show-what-the-sprint-delivers-and-found`) wait on this branch. The design spec is `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md` (outside the repo; read its *Link tuples* section), and `header-and-sections-v2.html` beside it is the visual reference.

### What to build

Wave 1 left the tuple wired to one place. `linkTuplesOf` and `segmentOf` (`packages/board/src/app/lib/tuple-row.ts:337`, `:317`) group a row's links into bordered tuples, but only `tupleFromSlice` sets `linksAsTuples: true` (`tuple-row.ts:1577`). Every other `tupleFrom*` projection (row, plan, build, agent) still draws slot 4 through `TupleLinkView`, as bare icon-and-label links with a PR and its branch apart (`TupleRow.tsx:861-873` picks the path from the flag). `tupleFromIssue` sets `links: []` (`tuple-row.ts:1310`), so a ticket row has no tuple at all.

Four places on the tab still draw an artifact outside `TupleRow`, each as `<LinkIcon kind={linkIconKind(...)}/>` plus a bare label:

- `TicketsSection.tsx:104-114`: the ticket link and its plan link in a Tickets row.
- `ReleaseCard.tsx:26`: the release.
- `ReleasePlanParts.tsx:121,186,199`: the plan, PR and slice names in a release delivery plan row and its fold.
- `DeliveryRows.tsx:75,126`: the branch cell and the link cell of a delivery row.

Also `delivery-view.ts:547-557` builds `links: p.agents.map(...)` for section headers from `linkIconKind(item.kind)`.

Replace all of these with the one tuple, from one view function. The function takes an artifact (kind, label, address, and for a plan or story its ticket keys) and answers the tuple's segments; every call site above maps that answer and decides nothing. A tuple for an artifact whose payload holds no address stays text, as wave 1's segments already do. The plan is canonical; this brief is orientation.

### The decisions the plan settles — do not re-derive them

**Extend wave 1's primitive; add no second tuple.** `TupleSegment`, `segmentOf`, `linkTuplesOf`, `LinkTupleView` and `PlanTicketKeys` are the vocabulary. A second tuple component, icon table or ticket vocabulary is the failure the plan names. `GLYPH_PATH` stays the one glyph table, and `linkIconKind` (`packages/domain/src/rules/link-icon.ts`) stays the one kind-to-icon rule. The `LinkIcon` component draws a bare icon; a tuple segment replaces it at the four sites above, not beside it.

**`wave` is the slice kind; do not add a `slice` beside it.** Wave 1 settled this: `linkIconKind('wave')` returns `'slice'`, and a second `what: 'slice'` gives one thing two spellings and adds to the Wave/Slice defect CLAUDE.md forbids growing. The sprint glyph is the existing `sprint` (Octicon `iterations`); wave 1 answered the plan's open question, so record that answer in the plan's Notes if wave 1 did not.

**A PR and its branch are one tuple, in that order, and only where both are present.** `linkTuplesOf` pairs a `pr` link with the `branch` link right after it. A row that builds its links in another order draws two tuples and looks right in a unit test of the function. The unit test must run each `tupleFrom*` projection and assert the grouping, not only `linkTuplesOf` on a hand-built list.

**A ticket or PR number never truncates; a branch truncates in the middle.** `splitBranch` and `BRANCH_TAIL_CHARS` stay the rule: end-truncation renders the six `feature/opus5-hardening-*` branches identically, which reads as six duplicate rows. The full name stays in `title` and `aria-label`.

**Which segments a tuple has is a domain property.** CLAUDE.md, "Every rendered state is a domain property": a view state that cannot be asserted without a browser is a domain property not yet extracted. The segments, kinds, targets and ticket keys come from a function with a unit test per row kind. Ticket keys come from `planReference` (`packages/domain/src/rules/plan-reference.ts:268`). Write every new function as an arrow with factual TSDoc, and leave neighbouring `function` declarations alone: the unit is the function, and a rewrite destroys `git blame`.

**No new data source (spec non-goal).** Every address already exists in the board payload. Where you find an artifact with no URL there, draw it as text and name the gap in the plan's Notes. Never build a URL.

**Rules carried over unchanged:** an absent address is not a dead link (text, no anchor, `data-tuple-text`); keep the existing `data-pr-number`, `data-pr-link` and `data-issue-link` hooks so the existing browser tests keep their selectors; ticket segments use the violet token set wave 1 chose, not a literal; a ticket key with no `ticketHref(key)` answer stays text.

### Done when

The plan has no `## Done when` section. Its `## Changelog` is the specification, and the slice line names it: every artifact in the Delivery sections, the section headers and the Tickets section's rows is drawn as a tuple from one view function, with unit tests for the segments of each row kind. Lift these assertions, because a naive implementation passes without them:

- A unit test per row kind (slice, plan, PR, branch, release, story, ticket, sprint, build, agent) that runs the real `tupleFrom*` or view function and asserts its segments' kinds, labels and hrefs. This catches a row kind left on the old `TupleLinkView` path, which is how `linksAsTuples` came to cover one kind of nine.
- A test that no `LinkIcon` is drawn on the Delivery tab outside a tuple segment's own use. `grep -rn "<LinkIcon" packages/board/src/app/components` at the four sites above must show only the tuple's use. This catches a site converted in one component and missed in another.
- A unit test that a plan or story with two tickets yields two ticket segments, then the plan segment; one with no ticket yields the plan segment alone; a ticket key never carries an ellipsis. This catches the `[EKP-77 | EKP-78 | red-hold-…]` shape collapsing to one key.
- A unit test that an artifact with an empty `href` yields a text segment and no anchor.
- One browser test per surface that changed (a section header, a Tickets row, the release card, a release delivery plan row) proving the page shows a bordered tuple with its anchors. The segments are unit-tested; the browser test proves they are seen. Look at the tab in light and dark and at 320 px: no horizontal scroll, numbers intact, branches elided.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. Run `pnpm build:board` only to look at the result, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Add a changeset for `@plot-pm/board`, the description first and at least 20 characters, then the `plan:` line and `bumps:` block last. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the wiring of the tuple into every Delivery artifact: `packages/board/src/app/lib/tuple-row.ts` (the `tupleFrom*` projections, the new view function), `TupleRow.tsx`, `TicketsSection.tsx`, `ReleaseCard.tsx`, `ReleasePlanParts.tsx`, `DeliveryRows.tsx`, `lib/agent-rows/delivery-view.ts` (section-header links only), and their unit and browser tests. It reads `link-icon.ts`, `plan-reference.ts` and `glyphs.ts` and changes them only where a kind is genuinely missing.

It does not build the header (plan 4), the ⋯ menus or row actions (plan 5), section folding (plan 2) or the Tickets section's new scope rows (the Tickets plan). It draws the tuple those use.

Collisions, verified 2026-11-20 against the open PRs. #3587 (`feature/every-delivery-section-folds`, plan 2) edits `DeliveryRows.tsx`, `TicketsSection.tsx`, `rows.tsx`, `delivery-view.ts`, `marks.tsx` and `delivery-link-icons.test.ts`, and shares five files with this branch. Fetch `origin/main` before you start and again before you push; if #3587 has merged, rebase onto it and take its structure for the fold, then draw the tuple inside it. If it has not merged, change only the artifact-name sites in those files and keep your hunks small so the later merge is mechanical. #3588 (`scope-ticket-rows-in-the-payload`) touches `schema.ts` and the server, not the components; it adds `planTicketRows` to the payload, which this branch does not read. #3590 (`mine-means-mine-or-my-plan`) edits `delivery-readings.ts` and `mine-filter.ts`, which this branch does not touch.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
