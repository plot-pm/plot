## Implementation brief — delivery-chips-and-waiting-on-you (wave: Tests and text)

- **Plan (canonical):** docs/plans/2026-10-24-delivery-chips-and-waiting-on-you.md on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2490 merged
- **Branch:** `bug/chip-and-inbox-tests-can-fail` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CI required on `main`)

This is the plan's third and final slice. The first two merged: `bug/delivery-chips-decided-in-the-domain` (PR #2521 — chipRow decides state/label/hidden count) and `bug/waiting-on-you-counts-visible-rows` (PR #2638 — waitingTickets counts only rendered rows). Nothing in this slice waits on anything further; it closes the plan.

### What to build

Six of the plan's items were checked against the current `main` tree before this brief was written (not re-derived from the plan's original line numbers, which have drifted). Five are still present and unfixed by the two merged slices; one is partially done.

1. **Three browser tests that cannot fail**, because their fixtures let old and new behaviour agree:
   - `packages/board/test/integration/delivery-filters.browser.test.ts:106` — `expect(await chip(page, 'This sprint').textContent()).toContain('hidden')`. `DeliveryFilters.tsx:89` renders the word "hidden" for ANY nonzero `hiddenCount`, correct or wrong. Assert the actual count, not just the word's presence.
   - `packages/board/test/integration/unplanned-issues.browser.test.ts:175` — asserts `issueRow(page, 'EWZKUS-3893').count()` is `0`. A row absent because it was correctly filtered and a row absent because it was never generated/matched look identical to this assertion. Needs a fixture that proves the row *would* render if the filter were wrong.
   - `packages/board/test/integration/sprint-switch.browser.test.ts:199` — `expect(await page.locator('[data-sprint-hidden]').count()).toBe(0)`. `data-sprint-hidden` does not exist anywhere in `packages/board/src` (confirmed by grep) — the attribute was removed from the component at some point and the assertion is vacuously true. Remove it or replace it with an assertion against whatever attribute replaced it.

2. **`packages/board/test/unit/unplanned-issues.test.ts:465`** (`jiraFixture` helper) — the wrapper script it writes execs the real `packages/host/scripts/plot-config.sh` without pinning `PLOT_REPO_ROOT`, so the test's config answer depends on ambient CWD/env rather than being hermetic. Pin it in the wrapper the fixture writes.

3. **`packages/domain/test/chip-row.test.ts`** — partially done already. Lines 141–157 now cover an unknown-owner row (`author: undefined`, `{ kind: 'other' }`, both kept with `hiddenCount: 1`) — that part of the plan's ask is satisfied, leave it. What's still missing: no board-level (browser/integration) test anywhere in `packages/board/test` covers an unknown URL sprint slug. Restore it — check git history (`git log --all -p -- packages/board/test`) for what the lost test asserted before writing a new one from scratch.

4. **`NO_SPRINT` is already single-sourced** — `packages/domain/src/rules/sprint-selection.ts:2` declares it, `packages/board/src/app/lib/filters.ts:2,4` imports and re-exports it. No change needed there.
   **`FilterOption` is still duplicated** — declared independently at both `packages/domain/src/rules/sprint-selection.ts:5` and `packages/board/src/app/lib/filters.ts:44`, with no import between them. Delete the board-side declaration and import the domain one, the same pattern `NO_SPRINT` already uses.

5. **Two decisions, not reflex fixes** — each needs the call named in the commit/PR, not just the code change:
   - `DeliveryFilters.tsx:163` area — the plan's "late-timebox" signal is present (`data-sprint-timebox`/`data-timebox` + amber styling, `DeliveryFilters.tsx:169-176`). An "exempt count" is not present anywhere in the file or its `git log -S"exempt"` history — grep turns up nothing to restore. Likely reads as "already removed, nothing to restore," but confirm against issue #2476 if reachable, and record whichever way you land in the PR body.
   - `packages/domain/src/rules/ticket-phase.ts:18` — `TicketPhase.order` is set at `ticket-phase.ts:61` and read nowhere else; `waitingTickets` (`waiting-tickets.ts`) never sorts by it. Decide: wire it into a sort, or remove the field and say so.

6. **Issue #2476's "stale or false comments and changesets"** — this brief could not reach GitHub to verify which comments/changesets the issue lists. Pull the issue text at implementation time and correct what it names; do not treat this brief's silence on specifics as "nothing to do" here.

### Decisions already settled upstream — do not re-open

- **The Mine chip disables rather than falls back.** `chip-row.ts:134-155` names `hostUser` as the fix and disables with a reason when only `gitEmail` is set. This was one of the plan's Open Questions; PR #2521 settled it. Don't reintroduce a fallback-to-display-name path.
- **`waitingTickets` does not sort by `TicketPhase.order`** today — that's exactly item 5b above, still open. Don't assume PR #2638 settled it; it only fixed the *count*, not sorting.

### Done when

The plan's `## Done when` list doesn't exist as a separate section on this plan — treat the per-item descriptions above as the specification. Added assertions that exist because a naive fix would pass without them:
- The three browser-test fixes must be provably able to fail: construct the fixture so the old (buggy) code and the new code produce different observable DOM state, and confirm by reverting the fix locally and watching the test fail.
- The `FilterOption` deletion must leave exactly one declaration importable from `@plot-pm/domain` — grep for `interface FilterOption` after the change and confirm one hit.
- The restored unknown-sprint-slug test must actually exercise an unrecognized slug in the URL, not an empty or missing one.

Plus repo gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the related tests and typecheck for whatever you touched. The suites in `## Plot Config`'s `CI suites` key run in CI only; don't run them locally as a matter of course (see CLAUDE.md § Testing). A changeset is needed for this slice (`plot` patch at minimum) per `## Versioning` in CLAUDE.md — description first, `bumps:` block last.

Name the shell gate if you touch any `.sh` file: `scripts/check-shell-lines.sh` refuses growth in `skills/`'s shell line count against the merge base. Nothing in this slice's scope names a `.sh` file, so this likely doesn't bind — flag it if it turns out to.

### Bookkeeping

Open the PR through the controller once a commit exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` directly. Push the first real commit as soon as it exists — this slice has no `→ #<number>` yet; add it to this branch's line under `## Slices` → `### Tests and text` in the plan once the PR opens.

### Scope guard

This branch owns: the three named `.browser.test.ts` files, `unplanned-issues.test.ts`, `chip-row.test.ts`, `packages/board/src/app/lib/filters.ts` (the `FilterOption` declaration only), `DeliveryFilters.tsx` (decision-recording only, not a rewrite), and `packages/domain/src/rules/ticket-phase.ts`.

Both sibling branches from this plan (`bug/delivery-chips-decided-in-the-domain`, `bug/waiting-on-you-counts-visible-rows`) are merged and deleted — no collision risk from them. No other open plan touches `chip-row.ts`, `waiting-tickets.ts`, `sprint-selection.ts`, `filtered-estate-totals.ts`, `ticket-phase.ts` or `plan-status-counts.ts` as of this writing (checked against all `docs/plans/*.md`).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
