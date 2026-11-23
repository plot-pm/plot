## Implementation brief — delivery-sections-count-alike (wave 1: Header counts)

- **Plan (canonical):** `docs/plans/2026-11-22-delivery-sections-count-alike.md` on `main`
- **Approved:** 2026-11-22, Jan Wloka, plan-PR #3656 merged
- **Branch:** `feature/delivery-header-counts-every-state` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention (`Review: pr`)

Wave 1 of 3, sprint "Delivery UI Polish". Waves 2 (`feature/a-held-slice-names-its-hold`) and 3 (`feature/fleet-rows-name-their-plan`) wait on other branches and do not wait on this one. Wave 2 later adds a held sub-count to the not-started figure this slice creates; leave no hold code here.

### What to build

On 2026-11-22 the Sprint delivery header read "7 plans · 11 of 16 slices delivered · 1 at a gate · 0 blocked". Four of the 16 slices had no figure, because `headerCountParts` (`packages/domain/src/rules/release-plan-rows.ts`) prints only delivered, at a gate and blocked. The section header's bar already holds all five `SLICE_STATES`. This slice makes the text figures match: `delivered`, `blocked`, `at-a-gate`, `being-built` and `not-started`, summing to the total.

`headerCountParts` takes `SliceStateCounts` in place of `HeaderStrip` and returns the parts in `SLICE_STATES` order (delivered, blocked, at a gate, being built, not started), the bar's order. Find code by symbol; the plan's line numbers are a day old. The plan is canonical; this brief records what not to re-derive.

### Settled decisions — do not re-derive them

- **Pass all five, sum nothing new.** `releaseDeliveryHeader` already sums `PlanRowView.strip` per state (`inState`). Reuse that sum for the full `SliceStateCounts`. The sprint and release blocks in `delivery-view.ts` (`sprintBlocks`, `releaseScoped`) pass only `{ blocked }` through `blockedOf`; they pass all five too. Rejected: a second summing helper, because two sums drift. Check that `headerText` and `headerCountParts` still print the same figures for the same arguments.
- **`HeaderStrip` goes.** It admits two states and is the cause of the defect. Remove the type and its callers; do not widen it to five optional fields.
- **A 0 count shows, grey, and links nowhere** (`target: null`, already how `releaseDeliveryHeader` treats 0). The Release group legend keeps hiding zeros because its bar shows the proportions; do not change the legend. The header's five figures plus the delivered clause must add up to the total visibly.
- **`unread` stays outside the total** and shows only above 0, as today. `plans` stays first.
- **An agent on a slice whose PR waits on a gate counts under at a gate, not being built** (`sliceStateOf`, `slice-states.ts`). Do not change `sliceStateOf`.
- **No hold wording, no new reading, no new file.** "· 2 held" belongs to wave 2.
- **Rules carried over:** a count computed in a `.tsx` is a domain property not yet extracted — the parts come from the domain; absent is not false — `unread` is not zero.

### Done when

The plan has no `## Done when`; the slice line and its `tests:` annotation are the specification. Assertions that exist because a naive implementation would pass without them:

- The five state parts plus nothing else sum to the delivered-of-total clause's total, over a fixture with a slice in every state. Catches a part that is still missing.
- A state with count 0 returns `target: null` in `releaseDeliveryHeader` and a figure that still prints ("0 being built"). Catches a filter that hides zeros.
- Parts come back in `SLICE_STATES` order. Catches the old at-a-gate-before-blocked order; rewrite `release-plan-rows.test.ts` ("headerCountParts with an at-a-gate count") rather than delete it.
- A block passed with `being-built` and `not-started` slices through `delivery-view.ts` prints both in `header` and in `counts`. Catches a caller that still passes `{ blocked }`.
- Update every header string that now gains three figures, and re-grep after: `packages/board/test/unit/delivery-view.test.ts` (lines near 94, 372), `sprint-delivery-view.test.ts` (near 43, 51, 52, 60), `delivery-readings.test.ts` (near 281, 287, 338) and `packages/domain/test/release-plan-rows.test.ts`. Check `release-delivery-fold.browser.test.ts` for the same strings. A stale expected string fails loudly here, so do not loosen any to a regex.
- The count gate: `EXPECTED_FILES` and `EXPECTED_TESTS` in `packages/board/test/integration/stubbed-tests-start-no-board.test.ts`. This slice should add no browser test; if it does, record the delta and the reason.

Plus: run `pnpm build:board` locally to test and commit no bundle (`scripts/check-no-bundle-diff.sh` refuses one). Add a changeset for `@plot-pm/board`, description first and `bumps:` block last (`./scripts/check-changeset-packages.sh`). Before each push, commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. This slice touches no `.sh` file; if that changes, `scripts/check-shell-lines.sh` refuses growth and has no override. New or rewritten functions are arrows with factual TSDoc.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/release-plan-rows.ts` (`headerCountParts`, `headerText`, `releaseDeliveryHeader`, `HeaderStrip`), `packages/board/src/app/lib/agent-rows/delivery-view.ts` (the header and block callers), the tests named above, and one changeset. It touches no `schema.ts`, no Fleet code and no `slice-states.ts`.

In flight: `feature/a-held-slice-names-its-hold` (waits on `feature/release-delivery-plan-rows-unfold`) will extend `headerCountParts` for the held count, and `feature/fleet-rows-name-their-plan` (waits on `feature/fleet-switches-in-fleet-section`) edits `delivery-view.ts` Fleet rows. Keep the diff to the header callers so the merges stay clean. If you find something the plan did not anticipate, report it rather than improvising outside scope.
