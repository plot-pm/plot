## Implementation brief — a-delivered-docs-plan-counts-as-finished (wave 2: Counting)

- **Plan (canonical):** docs/plans/2026-11-21-a-delivered-docs-plan-counts-as-finished.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3641 merged
- **Branch:** `bug/a-delivered-docs-member-counts-as-finished` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (`Review: pr`)

This wave waits on `bug/the-pulse-omission-is-one-domain-rule`, and that branch is merged (#3645, 2026-11-22 09:54Z). `pulseOmitsPlan`, `liveOnMerge` and the domain `countedSlicesByPlan` exist on `main`. PR #3630 is merged too, so `releaseGroupOf` is on `main` and its row in `release-cards-of.test.ts` applies now.

### What to build

Issue #3640: the Delivery tab shows "The merge reading for this sprint is missing." for sprint `delivery-ui-polish` (2026-W47). `templates-show-named-identifiers` (`Type: docs`, Delivered) is the only one of the sprint's 8 members with no row, and `countSliceStatesOver` answers `undefined` for a named plan with no entry (`slice-states.ts:148-149`). Wave 1 gave the seeding rule a home, but the board never feeds it plan facts, so nothing changes on screen yet. This wave sends the facts.

1. **Server.** `fleetPlanIndexOf` (`packages/board/src/server/fleet.ts:1872`) adds `phase`, `type` and `slices` to each `plans` entry from `meta`. `slices` holds the names of the slices that hold at least one non-deferred branch, in document order.
2. **Schema.** The `plans` record in `packages/board/src/contract/schema.ts` (`:4892`) gains the three fields as optional, so a client talking to an older server still validates. An absent field reads as "not omitted", which keeps today's behaviour.
3. **Client.** Map each `fleet.plans` entry to `{ plan: slug, phase, type, sliceIds: slices.map((s) => sliceItemId(slug, s)), planId: sliceItemId(slug, '') }` (`CountedPlanFacts`). Carry it through `DeliveryMapInput` as `input.plans`, which the board wrapper `countedSlicesByPlan(items, input)` (`delivery-readings.ts:522`) already reads, and which today is always absent. `AgentList.tsx` builds `mappingInput` (about `:1236`) and passes it to `deliveryMapping`, `releaseCardsOf` and `releaseGroupOf`. `placeMapping` passes it to `deliveryView`, and the person cards' call at `delivery-view.ts:920` forwards it as `plans`.

Every caller then gets the seeding with no signature change: `sprintCardViewOf`, `releaseCardsOf`, `releaseGroupOf` and the person cards.

### Decisions the plan settles — do not re-derive them

- **Count the member as delivered, do not skip it.** Skipping as `known: false` fixes the bar but scores the member `withdrawn` in tier progress (`sprint-card.ts:171`), so a delivered Must reads as not done in "Must N/M".
- **The release cards count it too** (operator, 2026-11-21). One path serves sprint, release and person cards, so the three bars stay equal; `delivery-view.test.ts:170` already asserts sprint equals person. A second slice map beside `slicesByPlan` was the rejected option.
- **The payload carries readings, not a verdict.** The server sends `phase`, `type` and slice names. The domain decides via `pulseOmitsPlan`. Do not compute "omitted" on the server or in `.tsx`.
- **The untargeted (carried) release card is not changed.** `carried.approved` holds only plans with a pulse slice, so it never asks for the omitted plan's entry. No test claims a fix there. The Release delivery section's plan count can stay one below the sprint card's member count; that is out of scope.
- **The walk keeps dropping the plan** (`plan-walk-assembly.ts`), and the type comparison stays exact: `Docs` and `''` do not match.
- **The domain `countedSlicesByPlan` stays as it is.** If a test in this wave needs a domain change, stop and report: wave 1 settled the rule.
- **Carried-over rules:** absent is not false — a plan the payload read nothing for, and an entry with no `phase` or `type`, still reads missing. A non-empty entry from the pulse beats the plan file.

### Done when

The plan's test list for this slice is the specification:

- `packages/domain/test/sprint-card.test.ts`: a sprint whose Must member is a delivered docs plan, seeded through `countedSlicesByPlan`, draws a bar with that plan's slices delivered, `readingMissing: false`, and "Must 1/1". Catches a seeding that scores the member withdrawn.
- `packages/domain/test/release-card.test.ts`: the targeted card for that sprint draws a bar and no `RELEASE_READING_MISSING`.
- `packages/domain/test/release-person-cards.test.ts`: the person card's bar equals the sprint card's bar for the same sprint.
- `packages/board/test/unit/sprint-card-slices.test.ts`: `sprintCardViewOf` and `releaseCardsOf` with a `plans` entry `{ phase: 'delivered', type: 'docs', slices: ['Docs'] }` and no row draw a bar; the same entry without `phase` and `type` still reads missing. **This pair is the one that fails on today's behaviour.** The three domain tests are red only because the seeding did not exist in wave 1, and the control case catches a fix that seeds every plan.
- `packages/board/test/unit/release-cards-of.test.ts`: `releaseGroupOf` with the same entry draws the Release group's bar with no missing reading.
- `packages/board/test/unit/delivery-view.test.ts`: the person card for that sprint draws the same bar as the sprint card.
- `packages/board/test/unit/every-fleet-plan-has-an-index-entry.test.ts`: each `plans` entry carries the meta's `phase`, `type` and non-deferred slice names. A deferred-only slice must not appear in `slices`.

Plus: arrow functions for any function you write or rewrite, and factual TSDoc only (decision history goes in the commit message). Add a changeset (package `@plot-pm/board`, description first, `bumps:` block last; run `./scripts/check-changeset-packages.sh`). Do not commit a rebuilt board bundle (`scripts/check-no-bundle-diff.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` does not bind it.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the `plans` entry in `schema.ts`, `fleetPlanIndexOf` in `fleet.ts`, the `mappingInput`/`DeliveryMapInput` plumbing in `AgentList.tsx`, `delivery-readings.ts` and `delivery-view.ts`, and the seven test files above. It does not touch `packages/domain/src/rules/` (wave 1's). The Approved plan `board-readings-take-the-domain-answer` edits `delivery-readings.ts:148-157` and `:258-262`, and PR #3629 and PR #3618 touch `delivery-view.ts` and `schema.ts`; none edits the seeding call or the `plans` entry, so a rebase should be mechanical.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
