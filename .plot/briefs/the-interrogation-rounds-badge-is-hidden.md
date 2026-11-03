## Implementation brief — the-interrogation-rounds-badge-is-hidden

- **Plan (canonical):** `docs/plans/2026-11-03-the-interrogation-rounds-badge-is-hidden.md` on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3090 merged
- **Branch:** `feature/the-interrogation-rounds-badge-is-hidden` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot-review` App on the PR; no HIGH finding means merge (see the repo's review rule)

One slice, no waves: nothing waits on this branch and it waits on nothing.

### What to build

A Design card offers *Interrogate* but hides the rounds badge, and the route refuses the click with `409 not-a-draft` (issue #3088, Plot 2.30.0). Three one-line decisions disagree: `cardControls` sets `interrogate: underReview` (Draft and Design) and `roundsBadge: draft` (`card-controls.ts:78-79`); `recordRound` refuses only the `TERMINAL` phases (`round.ts:111`); `handleInterrogate` admits `draft` only (`interrogate.ts:432`). Make all three agree on Draft and Design:

1. `cardControls`: `roundsBadge: underReview`.
2. `handleInterrogate`: admit `draft` and `design`; keep the reason name `not-a-draft` for every other phase and reword the detail ("past Design").
3. `plot-reconcile-scan.sh` section 15: `select(.phase == "draft" or .phase == "design")` at `:2076`.
4. Update the stale Draft-only comments the plan lists under *Stale comments*, plus the module TSDoc, the refusal-table row and the prompt text in `interrogate.ts`, and `server/index.ts:314,317`.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**The reason name stays `not-a-draft`.** A rename would change every client and test that reads it for no behaviour gain. Only the detail text changes.

**`roundsBadgeText` and `rows.tsx:638` take no logic change.** Both read only `controls.roundsBadge`; the decision lives in the domain. If you find yourself editing a `.tsx` condition, stop: the domain line is the fix.

**The Agents-tab WAITING ON YOU draft-plan row stays Draft-only.** Do not widen `draftPlanOf` (`board.ts:2998`), the `DraftPlan` schema, `DRAFT_PLAN_NOTE`, `draftRoundsText` or `draft-plan-row.browser.test.ts`. None reads `controls.roundsBadge`, and a Design plan with no branch keeps no row there.

**Do not edit `packages/board/CHANGELOG.md:1012`.** It records the Draft-only scope PR #1617 chose. It is history; this change reverses it going forward.

**No skill text changes.** `challenge-the-plan` and `plot-panel` never restricted a round to Draft, so there is no `bumps:` entry.

**Shell: replace in place.** Section 15's comments and echo lines (`:136`, `:1994`, `:2041-2043`, `:2052`, `:2055`, `:2079`) name Draft and Design. Each edit replaces a line and adds no net shell lines (`scripts/check-shell-lines.sh`); use no syntax outside bash 3.2. The section stays below the blocking-sections marker and outside `attention=`.

### Done when

The plan's `## Done when` and *Tests* list are the specification. The assertions that exist because a naive change would pass without them:

- `card-controls.test.ts:31` runs over `[...STATES, 'rejected', 'superseded', 'none']` and expects `state === 'draft' || state === 'design'`. A test over `STATES` alone would not catch a badge leaking onto `rejected`, `superseded` or `none`.
- `rounds-badge.test.ts` keeps `Development`, `Testing` and `Released` reading `''`. It catches `roundsBadge: true` everywhere.
- `interrogate-route.test.ts` keeps `approved`, `delivered` and `released` refusing `not-a-draft`. It catches a route opened to every phase.
- `scan.test.mjs` section 15: the Design fixture must carry `- **Rounds:** 1` and be touched by the amendment commit, and the footer test then expects 3 body findings and `rounds_drift=3`. Without the amendment commit the fixture reports nothing and the test passes vacuously.
- `spike-card-states.browser.test.ts:20` hand-writes a Design card's controls with `roundsBadge: false`; set it to `true` or build the controls through `controlsFor`.

Plus: one changeset (`'@plot-pm/board': patch`, `'plot': patch`), description first and the `plan:` comment block last, as the plan shows. `./scripts/check-changeset-packages.sh` checks it. Do not commit a rebuilt board bundle. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e` locally.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/rules/card-controls.ts`, `packages/domain/test/card-controls.test.ts`, `packages/board/src/server/interrogate.ts`, `packages/board/src/server/index.ts` (comments only), `packages/board/src/app/components/PlanCard.tsx` (comments only), the board tests the plan names, `skills/plot/scripts/plot-reconcile-scan.sh` section 15, `test/reconcile/scan.test.mjs` section 15, and one changeset. It is the only slice of this plan. If you find something the plan did not anticipate, report it rather than improvising outside scope.
