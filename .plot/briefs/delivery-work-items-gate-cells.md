## Implementation brief — delivery-work-items-show-gates (wave 2: Gate cells)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-work-items-show-gates.md on main
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-work-items-gate-cells` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is the second of four slices. It waits on `feature/delivery-work-items-groups` (#3512), which has merged. `-progress` waits on this slice and `-by-chips` waits on `-progress`, so a slice that grows past the gate cells delays both. Touch the Gates column of At a gate and nothing else.

### What to build

An item at a gate shows one gate string today: `gateValue` returns `CI ✓` when CI is read, otherwise one review mark, so a PR with green CI and a failing review shows only `CI ✓`. After #3512 the At a gate group has its own **Gates** column (`WORK_GROUP_COLUMN`, `delivery-work-columns.ts:19`), but the cell under it is still `row.status`, the shared single string. Measured on `main` at `f0dfed71a`: `packages/domain/test/delivery-row-form.test.ts` holds six lines that select the gate text, and that is the only test file that does.

This slice makes the Gates cell show both gates and link each one:

1. **Two marks.** `gateValue` (`delivery-row-form.ts:137`) returns the CI mark and the review mark as two values, not one string. The cell reads `CI ✗ · review –`. `GATE_MARK` (`:91`) keeps `✓ ⟳ ✗`.
2. **`–` for a review nobody asked.** `review: 'none'` reads `–` and carries no link (`gateLinks` emits none for `none`). `review: 'unread'` yields no review cell at all, per the row form's rule that an unread fact is `null` (`delivery-row-form.ts:215-216`). The same holds for CI: `ci: 'unread'` yields no CI mark.
3. **Links.** The CI mark links to `CardPr.checksUrl` and the review mark to `CardPr.url`. A new link target for the checks page goes beside `pr` and `review` in `LinkTarget` (`delivery-row-form.ts:17`), and `resolveLink` in `packages/board/src/app/lib/agent-rows/delivery-link-targets.ts` resolves it to an `href`. An empty URL resolves to `none`, which renders the mark as plain text.
4. **Replace `prUrl`.** `prUrl: () => null` in `AgentList.tsx` (`linkHandlers.context`, near `:1134`) means no PR link resolves to anything today. Replace it with a lookup of the PR's `CardPr` by number that returns `url`, and add the same lookup for `checksUrl`. The lookup reads the payload; it builds no address.
5. **Update the callers.** `itemRowCells` (`:220`) builds `gate` and `gateLinks` once for four row shapes (`slice-at-a-gate`, `slice-stuck`, `pr-no-plan`, `release`). Only Work items' At a gate group takes the two-cell form; You and the other sections keep their `status` value. `workItemCells` (`delivery-work-columns.ts:41`) is where the group column is filled, so the two marks reach the Gates column through it.

The plan is canonical. This brief is orientation.

Where the code is now. Re-read before you edit, because #3512 and the You-group slices moved these files this week:

- `packages/domain/src/rules/delivery-row-form.ts`: `LinkTarget`, `GATE_MARK`, `gateValue`, `itemRowCells` and its `gateLinks`.
- `packages/domain/src/rules/delivery-work-columns.ts`: `workItemCells`, `WORK_GROUP_COLUMN`.
- `packages/board/src/app/lib/agent-rows/delivery-link-targets.ts`: `resolveLink`, `linkLabel`, `LinkContext`.
- `packages/board/src/app/lib/agent-rows/delivery-row-facts.ts`: `itemRowFactsOf`, which sets `facts.pr` and `facts.prReading` and no URL.
- `packages/board/src/contract/schema.ts:292-313`: `CardPrSchema`, with `url` and `checksUrl`, each `''` where the board does not know one.

### The decisions the plan settles — do not re-derive them

**The CI mark links to the checks page, not to a run.** The PR index carries `ciChecks` as a summary (`green`, `pending`, `failing`, `none`, `unknown`) and no run id or check name, and `ciRun` is never set. The existing `ci-run` target resolves to `none` in `resolveLink` for that reason. Do not build a run link and do not read a run id from anywhere. The new target links to `checksUrl`.

**The board builds no PR address.** `prUrl` was the place to compute `https://github.com/<repo>/pull/<n>`, and `schema.ts:292-303` forbids it: the same arithmetic is wrong on GitHub Enterprise and self-hosted Bitbucket. An empty `url` or `checksUrl` renders the mark as plain text. A test with a PR whose `checksUrl` is `''` and whose `url` is set catches an implementation that falls back from one to the other.

**The check name is a named gap.** The cell shows `CI ✗` without the failing check's name. `failingChecks` exists on `entities/pr.ts`, but the index summary carries no name, and the design forbids a new host read (*Non-goals*). Add no read and no field for it.

**`–` is `review: none` and `unread` renders nothing.** Round 1 found that `–` for "nobody asked" conflicts with the rule that an unread fact is `null`. The settled answer is two different readings, two different outputs. A test per reading (`none` → `–` with no links, `unread` → no review cell, `pending`/`high`/`passed` → `⟳`/`✗`/`✓` linked to `url`) catches a single `default` branch that collapses them.

**A slice PR is a gate unless plan 2's PR rule places it under You.** That rule already decides which PR reaches At a gate (`delivery-placement.ts`). This slice reads the placement and adds no placement rule.

**Rules carried over unchanged from this estate:** absent is not false, and an unread gate is not a failed one. Read the reading's own value, never the emptiness of a string.

### Done when

The plan's `Done when` line for this slice is the specification: an item at a gate shows one mark per gate, CI and review, CI linked to the PR's `checksUrl` and review to its `url`, rendered as plain text where the host gave none; a review nobody asked reads `–` with no link, and an unread review renders no cell, asserted in a unit test.

The assertions that exist because a naive implementation passes without them:

- **Both gates at once.** A PR with `ci: 'passed'` and `review: 'high'` shows `CI ✓ · review ✗`. Today it shows `CI ✓`. This catches a `gateValue` that still returns early on CI.
- **Link per mark, not per cell.** The CI mark's link is `checksUrl` and the review mark's is `url`, asserted on the resolved `href`. This catches one link on the whole string.
- **Empty URLs render plain text.** `checksUrl: ''` gives a CI mark with `kind: 'none'`. This catches a fallback to `url` or a constructed address.
- **Other sections keep `status`.** The You rows' single-string gate in `delivery-row-form.test.ts` still passes unchanged except where it asserts Work items. This catches a rewrite of the shared `gateValue` that breaks You.
- **The six gate-text lines in `delivery-row-form.test.ts` are updated, not deleted.** Move each to the two-mark form where it covers Work items.

Every gate state, link target and mark is a domain property with a unit test in `packages/domain/test/`. One browser test in `delivery-tab-sections.browser.test.ts` proves the two marks render with their links; the decisions are asserted in the domain.

Plus: add a changeset (`.changeset/<name>.md`, package `@plot-pm/board`, description first, `bumps:` block last). Run `pnpm build:board` locally to test, and commit no bundle: `scripts/check-no-bundle-diff.sh` refuses one. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. Functions you write are arrows.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the gate cell in `delivery-row-form.ts`, the new link target and its resolver, the `prUrl`/`checksUrl` lookup in `AgentList.tsx`, and the tests that select gate text.

In flight after it, so no collision today: `feature/delivery-work-items-progress` (the Progress and Waits on cells, in the same two files; it waits on this slice) and `feature/delivery-work-items-by-chips` (the By cell; it also waits on plan 4's `feature/delivery-agent-roles`). Do not write the Progress or Waits on cells here, and do not touch the By cell.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
