## Implementation brief — this-sprint-cannot-select-one-sprint (wave 1: Selection rule)

- **Plan (canonical):** `docs/plans/2026-10-23-this-sprint-cannot-select-one-sprint.md` on `main`
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2413 merged
- **Branch:** `bug/this-sprint-selects-a-sprint-subset-rule` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 2, `bug/this-sprint-selects-a-sprint-subset-ui`, waits on this branch. It imports the rules this branch moves and adds, so the names and signatures you export are the contract it builds on.

### What to build

With several sprints Active, the Delivery tab's «This sprint» chip shows the items of all of them. Observed 2026-10-23 in ewz-kus-portal: `kus-portal-103` and `kus-portal-103-markus` are both Active, share no plan, and the Not started and Quiet lists show the five plans of the second sprint to a reader who wants only the first. #2137 (`f19611d58`) removed the checkboxes that set the per-sprint selection and the subset test, and no plan decided that.

This branch is the rule half and changes no behaviour. It moves three rules from `packages/board/src/app/lib/filters.ts` into `@plot-pm/domain` and adds two new ones:

1. **Move** `slugPassesSprintFilter` (`filters.ts:309`), `rowIsSprintExempt` (`:355`) and `sanitizeSelection` (`:165`) to a new file under `packages/domain/src/rules/` (name it for the subject, for example `sprint-selection.ts`), export it from `packages/domain/src/index.ts`, and import the three from `@plot-pm/domain` in `App.tsx:23-26`, `AgentList.tsx:36` and the Board and Swimlanes readers. Delete the board copies; do not leave a re-export that hides the move.
2. **Add row membership.** A rule that says whether a row is `inSprint`: true when the selection is empty and the row is in any Active sprint, or when the row is in a selected sprint. Today `AgentList.tsx:697-701` computes this for the chip row's `visibleRows` (`rowIsSprintExempt(r) || slugPassesSprintFilter(r.plan, allSprintSlugs, membership)`) and `:660-663` for `filteredRows`. Wave 2 replaces those two call sites; this branch only provides the rule.
3. **Add the row-slug property.** A rule that says whether rows show their sprint slug: true while more than one sprint is Active and the selection does not hold exactly one sprint. Wave 2 reads it; the row shows `AgentRow.sprint`.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The rules move; they are not copied.** Moving them into the domain leaves one implementation, so no corpus pair is needed (CLAUDE.md, *A Shell Script Asks The Domain*, applies only to a shell duplicate). Do not keep the board function beside the domain one.

**An empty selection means all Active sprints.** That is today's behaviour and the default. `sanitizeSelection` drops a slug that names no Active sprint, so a stale selection reads as all Active sprints. Rule 2 must treat the sanitized-to-empty case the same as never selected; test it.

**The `NO_SPRINT` sentinel (`filters.ts:4`) stays meaningful to `slugPassesSprintFilter`.** The Board tab's `passesSprintFilter` shares this predicate, and `packages/board/test/unit/filters.test.ts` asserts the `NO_SPRINT` arm. Moving the function must keep those assertions green; move the tests with the rule, not away from it.

**`rowIsSprintExempt` keeps its exact scope.** A `release` row and a `pr` row with `plan === ''` are exempt; a loose `branch` is not (`filters.test.ts:172-185`). The exempt mark and the control's count both read it, so a change here moves both.

**A row in two Active sprints shows the first sprint.** `AgentRow.sprint` is the one slug the server sets from the sprint file (`schema.ts:2556-2560`, `fleet.ts:6059`). The payload does not change. The ewz sprints share no plan, so this case is not measured; do not build a multi-sprint display.

**Estate totals are not scoped.** `estateTotals` (`fleet.ts:7066`) stays unfiltered. Nothing in this branch touches it.

**The Planning tab badge is a separate reader.** `Board.tsx:177` and `Swimlanes.tsx:124` gate the badge on `sprintSel.length === 0`. That rule stays; this branch only changes where `sanitizeSelection` is imported from there.

**No UI change here.** Do not add chips, a URL parameter or a label change; that is wave 2. A diff that touches `AgentList.tsx` beyond its imports and the two `inSprint` call sites has gone past scope.

Rules carried over, unchanged:

- `packages/domain/**` is arrow functions (`export const f = (…) => …`) and factual TSDoc. The moved functions are declarations today; rewrite the ones you move as arrows. No decision history in comments — it goes in the commit message.
- Absent is not false: an empty selection is "no filter", never "nothing selected matches".
- Read the exit code, not the emptiness.

### Done when

The plan's `## Slices` line for this branch is the specification: the three rules move into `@plot-pm/domain`, the row-membership rule and the row-slug property exist, unit tests cover 0, 1 and 2 Active sprints, a subset of two, and a stale selected slug, and the board imports the moved rules with no behaviour change.

Assertions that exist because a naive implementation would pass without them:

- **Two Active sprints, selection of one:** rows of the other sprint have `inSprint` false. A rule that reads only "any Active sprint" passes the 0-selection case and fails here.
- **Stale slug:** a selection of one slug that is no longer Active reads as all Active sprints, not as an empty result. This catches a rule that tests membership before sanitizing.
- **Row slug with exactly one selected:** false even with two Active sprints. This catches a rule that reads only the Active count.
- **Row slug with 1 Active sprint:** false in every selection.
- **No board copy remains:** `grep -rn "function slugPassesSprintFilter\|const rowIsSprintExempt\|function sanitizeSelection" packages/board/src` returns nothing.
- **Moved tests still run:** `packages/board/test/unit/filters.test.ts` loses the cases for the moved rules and `packages/domain/test/` gains them; the case counts match, so no assertion is dropped in the move.

Plus the repo gates: a changeset in `.changeset/` for the `@plot-pm/board` change if the board's behaviour is touched (it is not; confirm and say so), and no generated bundle in the diff (`scripts/check-no-bundle-diff.sh`). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run a full suite, and do not run `test:e2e` locally. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` does not apply.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: the new file under `packages/domain/src/rules/`, `packages/domain/src/index.ts`, `packages/domain/test/`, `packages/board/src/app/lib/filters.ts`, `packages/board/test/unit/filters.test.ts`, and the import lines of `App.tsx`, `AgentList.tsx`, `Board.tsx` and `Swimlanes.tsx`, plus the two `inSprint` call sites in `AgentList.tsx`.

In flight beside it: `bug/this-sprint-selects-a-sprint-subset-ui` (wave 2) is blocked on this branch and holds every other `AgentList.tsx` change. No other branch of this plan runs. Verify with `/plot-pulse` before you start.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
