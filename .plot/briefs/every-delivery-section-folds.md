## Implementation brief — every-delivery-section-folds (wave 1: Fold)

- **Plan (canonical):** `docs/plans/2026-11-20-every-delivery-section-folds.md` on `main`
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3583 merged
- **Branch:** `feature/every-delivery-section-folds` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention (`Review: pr`)

The plan's first slice, in the sprint "Delivery UI Polish". It waits on nothing. `feature/delivery-section-empty-kinds` (same plan, wave 2), `feature/delivery-tab-has-one-header`, `feature/folded-sections-summarise-visually`, `feature/release-delivery-plan-rows-unfold` and `feature/fleet-switches-in-fleet-section` wait on it, directly or through wave 2.

### What to build

Today only some Delivery sections fold, a jump into a folded section scrolls to nothing (`scrollToAnchor` returns without effect for an unmounted anchor), and an empty section looks like a folded one. This slice gives all seven sections one frame (a 28 px fold button, a toggling header row, `data-section-toggle`) and one jump that every link into a section uses: it opens the section and group, persists the open state through `writeCollapsed`, then scrolls once the anchor is mounted. Build on `collapse.ts`, `delivery-view.ts` and `AgentList.tsx` as they are; the plan lists the line anchors, and they were read against `main` on 2026-11-20. Re-grep before you edit, because plan 1's `feature/delivery-tuples-in-every-row` may have moved lines.

The plan is canonical. The sections below record what you must not re-derive.

### Settled decisions — do not re-derive them

- **One jump, not two.** `jumpToReleasePlan` (`AgentList.tsx:527`) and `expandSection` (`:520`) are replaced by one jump. Every caller named in the plan's *Reachability rule* uses it, including `BlockedByMark` (which passes the legacy group word `'done'` today), the App reveal effect, `FleetCard`'s `onJump('fleet-controls')`, the footer's "details" button, and row anchor links through a new `LinkHandlers.onJump`. Leaving one caller on the old path keeps the defect for that caller.
- **The anchor-to-section mapping is `anchorOwner(anchor, view)` in `delivery-view.ts`, a view property with a unit test per anchor kind.** A `.tsx` file that decides which section owns an anchor can only be tested by rendering it, and 42 of 43 browser tests came to start a full board server that way (CLAUDE.md, *Every rendered state is a domain property*). `null` means no section owns the anchor, and the jump then only scrolls.
- **A hidden anchor shows a disabled link, never a missing one.** `hidden: 'filter'` disables the link with "hidden by Mine" or "hidden by the scope" (no hidden UI). `hidden: 'inner-fold'` (a Tickets row behind `… n more · show`) opens the inner fold too. An anchor still unmounted after the open scrolls to `delivery-section-<key>`, so a jump never ends without a visible effect.
- **Only the 28 px button carries `aria-expanded` and the accessible name.** The row click is a pointer shortcut with no `role="button"`. This removes the `role="button"` wrapper `releaseFold` puts around interactive children (`AgentList.tsx:1514-1528`), which nests interactive controls inside a button. Every control inside a toggling header stops click and key propagation, as `ReleaseHeaderCounts` does; a browser test proves a click on a header switch or count leaves `aria-expanded` unchanged.
- **`isFoldable(level, rowCount)` and `isFolded(level, key, rowCount, collapsed, always)` are arrows in `collapse.ts`, beside today's declarations.** The rule: an empty section folds, an empty group does not, a stored key folds an empty section (today `isFolded` returns false for it), and the Fleet `working` and `blocked` groups never fold. `fold` and `releaseFold` both call them. Update the comment above `isCollapsible` (`collapse.ts:93-106`) and its test (`agent-list.test.ts:1410`) so they describe groups only.
- **A folded section renders its header line only.** `WorkingCounts` and `MachineSection` become fold content. A `FleetAlert` at prominence `alert` stays visible in the summary slot while Fleet is folded, because that is the sentence a person missed for an hour. A browser test proves a folded Machine section renders no `MachineSection`.
- **Not placed has one control, the section fold.** `showUnplaced` (`AgentList.tsx:684`) is removed, the footer's "details" becomes a jump through the reachability rule, the section takes the key `not-placed` and starts folded so the default matches today's hidden state. The `<section>` keeps `id="unplaced-details"` and `data-unplaced`, so the anchor and `plan-row-shows-plan-status-only.browser.test.ts:285-292` keep their selector.
- **`KNOWN_KEYS` derives from `DELIVERY_LAYOUT`, which holds no Tickets or Not placed section.** Add `EXTRA_SECTION_KEYS = ['tickets', 'not-placed']` in `collapse.ts`; plan 7 adds its two group keys to that list. `COLLAPSED_BY_DEFAULT` becomes `['free', 'not-placed']`.
- **A new default reaches a stored set once.** `readCollapsed` applies `COLLAPSED_BY_DEFAULT` only when nothing is stored or no stored key is known, so a reader with a stored `["free"]` would see Not placed open. A second storage key records the default keys already applied; on read, each default key missing from that record joins the set once and the record is written. A reader who then opens the section keeps it open. Three unit tests, named in the plan: stored `["free"]` reads `free` and `not-placed`; stored `["free"]` with `not-placed` in the record reads `free` only; nothing stored reads the default. Without the record, the obvious fix (re-apply defaults on every read) re-folds a section the reader opened.
- **Tickets keeps `#tickets` on its `<section>`**, so the anchor survives a fold, and keeps its inner `… n more · show` fold beside the section fold.
- **Group toggles keep `data-group-toggle`.** Section toggles take `data-section-toggle="<key>"` so group selectors in tests stay unambiguous.
- **No Retry control, and no empty frame in this slice.** The dashed frame, `sectionEmptyKind` and the empty-kind sentences belong to wave 2. Until then an empty section carries the empty kind's mark in its folded header, as the plan says. Do not build wave 2's work here.
- **Reduced motion:** the chevron rotation is CSS with a `prefers-reduced-motion` alternative. One class assertion at most; no browser test is required.

Rules carried over from related work: absent is not false (a missing anchor owner answers `null`, not "section closed"); read the exit code, not the emptiness; a new function you write is an arrow, and a function you only pass through stays as it is (CLAUDE.md, *The Domain Package*). The board is not migrated wholesale.

### Done when

The plan's `## Done when` list is the specification; the plan has no separate section, so the Approach bullets and the *Board tests* bullet are the list. Assertions that exist because a naive implementation would pass without them:

- `anchorOwner` unit test per section and per anchor kind, plus a `null` anchor. Catches a mapping that covers only the anchors someone remembered.
- A `hidden: 'filter'` case where the whole readings hold the item and the shown placement does not. Catches a jump that scrolls to nothing under Mine.
- `isFolded` for an empty section with a stored key returns true. Catches the old `AgentList.tsx:1481` behaviour surviving behind the new name.
- The three stored-set tests above. Catches a default that never reaches a stored set, or one that re-applies on every read.
- A browser test that a click on a header switch or count leaves `aria-expanded` unchanged. Catches a missed `stopPropagation`.
- A browser test that a folded Machine section renders no `MachineSection`. Catches fold content that is only hidden with CSS.
- A browser test that a You count link into a folded section opens it and puts `data-link-target` on the row. Catches a jump that scrolls before the anchor mounts.
- Re-read and update the tests that pin the moved toggle and the old default: `release-delivery-fold.browser.test.ts:54-66` (toggle moves to `data-section-toggle`, glyphs `▾`/`▸` become a rotating chevron), `agents-tab.browser.test.ts:1744,1874,1912,4780`, `deliver-control.browser.test.ts:132`, `slice-status-speaks-verdict.browser.test.ts:57`, `spec-run-rows.browser.test.ts:60`, `row-withholds.browser.test.ts:320,357,362`, `plan-row-shows-plan-status-only.browser.test.ts:285-292`, `agent-list.test.ts:1384` (`['free']` becomes `['free', 'not-placed']`) and `:1410`. Do not delete a test to make it pass.
- The count gate: `EXPECTED_FILES = 99` and `EXPECTED_TESTS = 719` (`stubbed-tests-start-no-board.test.ts:569,956`). Record this slice's delta and reason there, as #3575 did.

Plus: run `pnpm build:board` locally to test, and commit no bundle (`scripts/check-no-bundle-diff.sh` refuses one). Add a changeset for the board with the description first and the `bumps:` block last (`./scripts/check-changeset-packages.sh`). Before each push, commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. If the slice touches a `.sh` file, `scripts/check-shell-lines.sh` refuses growth: remove shell elsewhere in the same change, or write the rule in the domain. The gate counts commands, not lines, and has no override. This slice should touch no shell.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/app/lib/agent-rows/collapse.ts`, `delivery-view.ts` (`anchorOwner`), `marks.tsx` (the `BlockedByMark` jump), `packages/board/src/app/components/AgentList.tsx`, `DeliveryRows.tsx` (`LinkHandlers.onJump`, `scrollToAnchor`), `FleetCard.tsx` and `TicketsSection.tsx` (the jump callers only), `packages/board/src/app/App.tsx` (the reveal effect) and the tests listed above.

In flight on the same files, verified at dispatch on 2026-11-20:

- `feature/delivery-tuples-in-every-row` (plan 1, wave 2 of `delivery-link-tuples-everywhere`; wave 1 `feature/delivery-tuple-vocabulary` is on origin) rewrites row rendering in `DeliveryRows.tsx`. Expect line-number drift and a possible conflict in `LinkHandlers`; resolve by keeping both fields.
- `feature/delivery-section-empty-kinds` (this plan, wave 2) waits on this slice. It adds `sectionEmptyKind` and the frame. Leave the frame to it.
- `feature/delivery-tab-has-one-header` removes `FleetCard` and `TodoList` and waits on this slice. Keep their jumps working until then; do not remove either component.
- `feature/folded-sections-summarise-visually` builds the summary slot's content and waits on this slice. Provide the slot; leave its content to plan 3.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
