
## Implementation brief — delivery-tab-header-and-my-sprint (wave 5: Sprint card)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-tab-header-and-my-sprint.md on main
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-sprint-card` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This slice waits on `feature/delivery-slice-states` (merged as #3513) and `feature/sprint-owner-field` (merged as #3490), so it is startable now. `feature/delivery-release-card` and `feature/delivery-my-sprint-scope` wait on this slice or on its siblings, so keep the card behind its own component and its own domain function, and later slices add siblings rather than edit it.

### What to build

The Delivery tab has no place that answers "how far is my sprint". Today the only sprint line is `data-sprint-report` (`DeliveryFilters.tsx:183`): title, target, timebox label and a flat item count. This slice adds the **sprint card** to the tab header: the end date written in full ("ends Friday, 20 November"), the release the sprint targets, a five-segment progress bar, and progress per MoSCoW tier ("Must 5/5 · Should 2/3 · Could 0/2"). Where the reader owns several Active sprints, the card shows one bar per sprint.

Both inputs now exist on `main` and have no caller yet, so this slice is their first consumer:

- `sprintIsMine(ownerHandle, reader)` in `packages/domain/src/rules/sprint-ownership.ts` answers whether the reader owns a sprint. `FleetSprint.ownerHandle` and `FleetSprint.end` are on the fleet payload (`schema.ts:4305-4311`).
- `countSliceStatesOver(plans, keys, readings, input)` in `packages/domain/src/rules/slice-states.ts` returns the five counts for a set of plan keys, each plan once, or `undefined` where any named plan has no merge answer. Its result feeds the five bar segments.

The card sits beside `FleetCard`, which `AgentList.tsx` mounts at about line 1457 above `view.sections`. Follow that card's shape: a domain function returns the whole view state (`rules/fleet-card.ts`), and `FleetCard.tsx` only renders it. The plan is canonical; this brief is orientation.

### The decisions the plan settles — do not re-derive them

**The bar reads the five-state classification, and writes no second merge rule.** The plan names five segments (delivered, at a gate, being built, blocked, not started) and says the five counts add up to the total. `countSliceStatesOver` already does that, and `unread` stays outside `total`, so a bar whose segments add up to `total` is right by construction. Do not recount from `sprint.counts` (`SprintCountsSchema`): that counts sprint items by plan state, which is a different question.

**An unread answer is not a zero.** `countSliceStatesOver` returns `undefined` where any named plan has no merge answer, so that a partial pulse never reads as a smaller count. The card shows no bar for that sprint and says the reading is missing. It does not draw an empty bar and does not read 0 of N.

**Ownership is the rule, not a string compare.** `sprintIsMine` compares the reader's host login and the Owner through `People`; a sprint with no Owner, or with a handle `People` does not declare, belongs to nobody. The card therefore shows only sprints the rule answers true for. A sprint whose Owner `People` does not declare is named on the card (plan, *Sprint owner*: "the sprint card names the unknown handle") — do this where the card is shown for an owned sprint, not by showing other people's sprints.

**The end date is written by a domain function, in English, with no locale call.** "ends Friday, 20 November" is a pure function of the `end` string (`YYYY-MM-DD`). `toLocaleDateString` (used in `rules/story-date.ts`) reads the machine's locale, so the same payload would print differently on two machines and a unit test would pass on one. Use a weekday array and a month array. An `end` of `''` prints no date line (absent is not false), and an `end` that does not parse prints none either.

**Per-tier progress is per commitment tier, and `deferred` is not a commitment.** `SprintMember.tier` carries `must`, `should`, `could` or `deferred`, and the schema says a deferred member is in the file and is not a commitment, so the consumer excludes it from counts. Show Must, Should and Could only. A tier with no member shows no segment of the line rather than "0/0".

**The card is for the owned Active sprints now, and the toggle comes later.** The My sprint toggle ships in `feature/delivery-my-sprint-scope`, which also deletes `data-sprint-report`. Until it merges, mount the card for the Active sprints the reader owns and leave `data-sprint-report` alone, so a sprint's timebox is never off the tab (plan, *Sprint card*). Do not add the toggle, the rename or the disabled state here. Settle the mount so the scope slice can gate it with one condition.

**Rules carried over unchanged:** absent is not false; a count that depends on an unread reading is not `0`; every rendered state is a domain property (CLAUDE.md, "Every rendered state is a domain property"); a function you write is an arrow; `Worker` stays on process states.

### Done when

The plan's Done When item for this slice is the specification: "the sprint card shows the end date written in full, the target release, a bar per owned Active sprint, and the MoSCoW tier counts." Plus the plan's last item: every count, marker, bar segment and disabled state has a unit test, and browser tests prove only what is seen.

Lift these assertions, because a naive implementation passes without them:

- Five segments add up to `total` for one sprint, and `unread` is not in the sum. This catches a bar drawn from the wrong counter.
- Two sprints naming one plan count that plan once in a combined reading. (`countSliceStatesOver` does this; assert the card's wiring does not bypass it.)
- A sprint whose plan has no merge answer shows no bar and a missing-reading note, not a bar of zeros.
- A reader who owns two Active sprints gets two bars; a reader who owns none gets no card.
- A sprint whose Owner handle `People` does not declare is not shown as the reader's, and an owned sprint with an undeclared handle names it.
- The end date for `2026-11-20` reads "ends Friday, 20 November", and an empty or unparseable `end` prints nothing. Run the date test under a non-English `LANG` to show it does not depend on the locale.
- A `deferred` member is in no tier count, and a tier with no member prints nothing.
- A 320 px viewport has no horizontal scroll and both themes read (plan, *Constraints*). Check both by looking at the rendered tab after `pnpm build:board`, not by reading the diff. Icons come from `glyphs.ts` only.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, do not run `pnpm run test:e2e` locally, and do not run board tests while the operator's board is open on this machine. Run `pnpm build:board` only to look at the result, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Add a changeset for the package `@plot-pm/board`, the description first and at least 20 characters, then the `plan: docs/plans/2026-11-16-delivery-tab-header-and-my-sprint.md` line inside the comment block; this slice changes no skill, so it names no `bumps:` entry. The slice touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` has nothing to count.

### Open points the builder settles and records in the PR body

- **Where the per-plan counted slices come from.** `countSliceStatesOver` takes a map from plan key to `CountedSlice[]`. On `main` its only sibling caller (`delivery-view.ts:457`) builds one flat list from `mapping.wholeReadings.items` whose id starts with `slice:`, and `WorkItemReading` has no plan field. This brief did not verify how a slice item's id maps to its plan. Find that mapping first; if it needs a payload field, report it rather than adding one outside scope, because the plan says this work adds no payload field and no server work.
- **What "progress" per tier counts.** `SprintMember.checked` is the ticked checkbox. A plan can deliver without anyone ticking its line. Check `rules/sprint-score.ts` (`scoreItem`) and `plot-sprint-release.sh`'s `item_state` before writing a tier rule: the repo already compares those two in the corpus tier (`packages/domain/corpus/sprint-score.corpus.test.ts`). Reuse that answer if it fits. If you write a new one, say why in the PR body, and do not add a second declared duplicate.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the sprint card: a new card component and a domain function under `packages/board/src/app/components/` and `packages/domain/src/rules/` (names are the builder's), its mount point beside `FleetCard` in `AgentList.tsx`, and the unit and browser tests of those. It reads `sprint-ownership.ts`, `slice-states.ts`, `FleetSprintSchema` and `SprintMemberSchema` and changes them only where a fact the card needs is missing. It leaves `DeliveryFilters.tsx` (the `data-sprint-report` line, the chip and its `data-chip`) to `feature/delivery-my-sprint-scope`.

On 2026-11-18 `git ls-remote origin 'refs/heads/feature/delivery-*'` lists two branches, `feature/delivery-tab-footer` and `feature/delivery-you-person-comment`; neither is in this plan. The slices of this plan that touch `AgentList.tsx`'s header region, `feature/delivery-tab-todo-list` and `feature/delivery-release-card`, wait on slices that are not merged, so a collision at merge time is not possible today. Put the card behind its own component so those slices add siblings.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
