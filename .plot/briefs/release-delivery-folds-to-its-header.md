## Implementation brief — release-delivery-folds-to-its-header (wave 1: Fold)

- **Plan (canonical):** `docs/plans/2026-11-19-release-delivery-folds-to-its-header.md` on `main`
- **Approved:** 2026-11-19, jwloka, plan-PR #3565 merged
- **Branch:** `feature/release-delivery-folds-to-its-header` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (Auto-review on, `plot/review` status)

The plan has one wave and one branch. No other slice waits on this branch, and this branch waits on no other slice.

### What to build

The Delivery tab's Release delivery section cannot fold today. #3525 removed the fold on purpose, so the section always shows its full plan table, also when every slice is delivered. This branch makes the section's header row the toggle. The section is open by default. When folded, the section is one line: the section name, the release (or the sprint slug under My sprint), and the counts. Each non-zero count links to its rows. The mockup is `docs/superpowers/specs/2026-11-19-release-delivery-fold.html`, and it shows four states. The plan is canonical; this brief gives orientation only.

Where the code is today (`main` at `4efbf869f`):

- `packages/board/src/app/lib/agent-rows/collapse.ts:6-8`: `KNOWN_KEYS` filters out `release-delivery`, so `readCollapsed` drops a stored fold. `COLLAPSED_BY_DEFAULT` is `['free']` (`:19`). It must stay that value.
- `packages/board/src/app/components/AgentList.tsx:1453` `fold(key, count, heading, always)`: the Release delivery section calls it with `always = release` (`:1501-1575`), so no toggle renders. The header shows `section.label` plus `(releasePlanCount)` (`:1561`).
- `AgentList.tsx:506` `expandSection`: today it only sets `allPlansOpen` for `'done'`. Blocker marks call it through `onExpandSection` (`marks.tsx:384`).
- The counts row is `ReleaseLine` in `packages/board/src/app/components/ReleasePlanParts.tsx:40`, rendered once per block inside the section (`AgentList.tsx:1579`).
- The counts come from `headerCounts` / `headerCountParts` / `headerText` in `packages/domain/src/rules/release-plan-rows.ts:275-320`. `delivery-view.ts:676-695` assembles them into each `ReleaseBlockView` (`counts`, `header`). The section title, Release delivery or Sprint delivery, comes from `sprintDeliveryTitle` (`delivery-view.ts:675`).

### Settled decisions: do not re-derive them

- **Open by default.** Jan Wloka resolved this on 2026-11-19, against the 2026-11-08 spec's folded line. Do not add `release-delivery` to `COLLAPSED_BY_DEFAULT`. The test `folds Free agents and leaves every other section and group open` keeps `['free']`.
- **One stored key, `release-delivery`, in `localStorage` via `collapse.ts`.** Do not use a URL parameter. `collapse.ts`'s own comment explains why: a fold is per-reader convenience and must not travel in a shared link. Do not add a second key for Sprint delivery either. The mockup's fourth state shows one fold for both toggle states. A fold stored before #3525 comes back, and the plan accepts that because it is the reader's own earlier choice.
- **The header line is a domain property.** Write one arrow function beside `release-plan-rows.ts` (the plan names it `releaseDeliveryHeader`). It returns the name, the scope label, the counts and each count's link target, or none for a count of 0. Export it from `@plot-pm/domain` and unit-test it in `packages/domain/test/`. The `.tsx` maps the parts and decides nothing. Root CLAUDE.md requires this: a view state that cannot be asserted without a browser is a domain property not yet extracted. Reuse `headerCounts` / `headerCountParts`; do not write a second count.
- **The fold itself is browser state, not a domain property.** It works like the Free agents line. `collapsed` / `toggle` in `AgentList` already hold it.
- **Plan rows keep their own fold.** `openReleasePlans` and `allPlansOpen` are independent of the section fold. Folding the section hides them; opening it shows each plan row in its previous state. Do not reset them on toggle.
- **The whole header row takes the click and carries `aria-expanded`.** Use `▾` open and `▸` folded, as in the mockup. A count link inside the row must not also toggle the section. Stop the click from propagating, then open the section and scroll.
- **A count of 0 shows and is not a link.** It renders as text, like `CountWords` with `anchor === null` in the You and summary headers (`AgentList.tsx:1510-1550`). Follow that pattern.

Rules carried over unchanged: absent is not zero. A count the payload did not read (`unread`) keeps its "not read" part (`headerCountParts` adds it only above 0). Never show it as a 0 that hides missing data.

### Points the plan does not settle: report them, do not improvise

1. **At-a-gate count.** The changelog and the mockup's third state show "3 at a gate". `headerCountParts` today returns `plans`, `delivered`, `blocked`, `unread` and has no at-a-gate part. The five-state strip carries `'at-a-gate'` (`slice-states.ts:29`), so add it from there. The mockup omits it in the three states where it is 0. The plan's rule says "a count of 0 shows". Follow the plan text, and state the choice in the PR body.
2. **Several blocks in one section.** Under several releases, or My sprint with several sprints, the section holds several `ReleaseBlockView`s, each with its own `ReleaseLine`. The mockup shows one. A conservative reading: the header carries the totals over the section's plans, each plan counted once (`releasePlanCount` already dedupes). The scope label appears only when there is exactly one block, and the per-block lines stay inside the open section. Record the choice in the PR body. Do not invent a new layout.
3. **What "the rows it counts" means for a link.** Rows are plan rows, and a slice count names slices. A reasonable target is the first plan row holding a slice in that state. Opening the section is required. Opening that plan row is optional. Use the `scrollToAnchor` path the existing count links use.

### Done when

The plan's `## Done when` and Design bullets are the specification. These assertions exist because a naive implementation passes without them:

- **The section is open with nothing stored.** The test for this catches a fold added to `COLLAPSED_BY_DEFAULT`.
- **A stored `["release-delivery"]` reads as folded.** Invert the test at `packages/board/test/unit/agent-list.test.ts:1696-1699` ("reads a stored fold of Release delivery as open"); do not delete it. Inverting it catches a toggle that renders but does not persist.
- **Folded, the section renders no plan rows and no column headers** (`data-plan-thead`, `data-plan-row` absent), **and the counts are still present.** This catches a fold that hides the counts with the table.
- **Fold the section, then reopen it: a plan row that was open stays open.** This catches a toggle that resets `openReleasePlans` / `allPlansOpen`.
- **Clicking a non-zero count while folded opens the section and scrolls. A 0 count has no button.** This catches links that scroll to an anchor that is not rendered, and a 0 count that is still clickable.
- **The fold is the same under My sprint (Sprint delivery).** This catches a key derived from the label.
- **`expandSection`.** A blocker mark that targets a row in Release delivery must open the section as well as the plan rows. Update the `expandSection` tests the plan names, and grep `onExpandSection` / `data-group-toggle` in `packages/board/test/integration/*.browser.test.ts` (for example `delivery-tab-sections`, `sprint-delivery-scope`, `release-delivery-visual`, `group-activity`). Change them; do not skip them.
- Unit tests for the new domain function cover the zero, non-zero and unread parts and the scope label.

Repo gates:

- **Changeset:** package `'@plot-pm/board'` (or `'plot'`). The description comes FIRST; it may reuse the plan's Changelog line. Add an optional `plan: docs/plans/2026-11-19-release-delivery-folds-to-its-header.md` line inside the trailing comment block.
- **Generated bundle:** do not commit `board-server.mjs` or any generated bundle (`scripts/check-no-bundle-diff.sh`).
- **Code style:** arrow functions in `packages/domain/**` and in any function you write or rewrite. Do not convert neighbouring declarations. TSDoc describes the interface, not the history.
- **Local checks:** commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push, and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally.
- **Shell:** `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, remove the same amount of shell elsewhere in the same change. The gate counts commands, not lines, so joining lines is no payment.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work still moves). Never use `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns:

- `packages/domain/src/rules/release-plan-rows.ts` (or a new rule beside it), its export in `packages/domain/src/index.ts`, and `packages/domain/test/`
- `packages/board/src/app/lib/agent-rows/collapse.ts` and `delivery-view.ts`
- `packages/board/src/app/components/AgentList.tsx` and `ReleasePlanParts.tsx`
- the board tests named above and one changeset

Other work in flight, verified 2026-11-19:

- **#3563 `bug/release-card-reads-the-pending-release`** also edits `AgentList.tsx` and `packages/domain/src/index.ts`. Its subject is the release card and `you-header`, not the Release delivery section, but expect a textual conflict in both files. Rebase or merge `main` after it lands.
- **#3562 `changeset-release/main`** is the release PR. Do not touch it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
