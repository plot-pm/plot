## Implementation brief — delivery-tab-matches-its-mockups (wave 1: Domain fields)

- **Plan (canonical):** docs/plans/2026-11-18-delivery-tab-matches-its-mockups.md on main
- **Approved:** 2026-11-18, Jan Wloka, plan-PR #3531 merged
- **Branch:** `feature/delivery-domain-fields` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This slice waits on `feature/delivery-release-card` (#3537), `feature/delivery-my-sprint-scope` (#3538), `feature/delivery-release-person-cards` (#3532) and `feature/delivery-sprint-delivery-scope` (#3540). All four merged on `origin/main`, so the slice is startable. `feature/delivery-visual-primitives` and the six *Sections* branches wait on this slice and read its fields, so the field names below are the contract they build on.

### What to build

The mockups style seven states that the domain does not expose. A styling slice must map a domain field to a class and compute nothing (CLAUDE.md, *Every rendered state is a domain property*), so this slice adds the twelve fields first and renders none of them. Plan *Domain Fields* items 1 to 7 are the list; the tab's text must not change.

| Item | Field(s) | Where |
|---|---|---|
| 1 | `CellPart.outcome`: `pass`, `pending`, `fail` or `none` | `rules/delivery-row-form.ts`, set in `gatesCell` from `PrReading.ci` and `PrReading.review` |
| 2 | `PlanRowFacts.phase`, `PlanRowFacts.accent` | `rules/release-plan-rows.ts`, fed by `planRowFacts` |
| 3 | `PlanLine.state`, `PlanLine.pr`, `PlanLine.merged` | `rules/release-plan-rows.ts`, `planLines` |
| 4 | `TodoLine.verb`, `TodoLine.label` | `rules/todo-list.ts` |
| 5 | the open-questions tone | `rules/plan-open-questions.ts` |
| 6 | `YouHeaderCount.words`, `SectionCount.words` | `rules/you-header.ts`, `delivery-view.ts` `summarise` |
| 7 | `ReleaseBlockView.counts` | `delivery-view.ts`, from a new `headerCountParts` beside `headerCounts` |

The plan is canonical; this brief is orientation, and the next section corrects its line citations, which were measured at `b13b8852e` and are 33 commits old.

### What changed since the plan measured — re-read these before you start

Measured 2026-11-19 on `origin/main` at `7c246a4fb`.

- **Neither Phase nor the relative merge time landed.** The plan says to add nothing for either if the sprint-scope slice landed it first. It did not: `PlanRowFacts` (`release-plan-rows.ts:143`) has no phase, and `doneDetail` (`:103-107`) still writes `mergedAt.slice(0, 10)`. Items 2 and 3 are fully owed. Say so in the PR body.
- **`headerCounts` has two call sites now, and `ReleaseBlockView` has more fields.** `delivery-view.ts` builds a sprint block under the `my-sprint` scope (`sprintBlocks`, `headerText(headerCounts(plans), '', …)`, around `:552-556`) and a release block otherwise (`releaseScoped`, around `:557-565`). Item 7's `counts` must be set on both kinds, or the header bar of a My sprint tab has no counts. `ReleaseBlockView` also carries `sprint`, `name` and `cards`; keep them.
- **`TodoListInput` gained `releases`** (#3537). `todoList` builds `entries` from placed items plus the release cards, and builds each line from `reasonVerb(e.reason)` and `e.label` (`todo-list.ts:109-115`). Item 4 is therefore a split of what `text` already joins: `verb` is `capital(reasonVerb(e.reason))`, `label` is `e.label`, `text` stays `${verb} ${label}`. Release lines get both fields through the same code path.
- **`placeMapping` has a fourth parameter, `scope`, and it is optional** (`delivery-view.ts:581`; the one call is `AgentList.tsx:1173`). A required `now` cannot follow an optional parameter, so add `now?: Date` as the fifth. The call passes the clock the same component already passes to `rowFormsOf` on the line below it.
- **`PlanSliceFact` carries a PR number only for a delivered slice** (`MergedFact.pr`). For an opened In flight or To do line there is no PR number to read yet.

### The decisions the plan settles — do not re-derive them

**The gate-mark outcome comes from `PrReading`, never from the glyph.** `GATE_MARK` is `{ running: '⟳', failed: '✗', passed: '✓' }` (`delivery-row-form.ts:175`) and `gateMarks` builds the string from it. A naive implementation parses the glyph back out of the string. The plan rules that out because the glyph table is a display choice and the outcome is a fact. Map `PrReading.ci` (`running`→`pending`, `failed`→`fail`, `passed`→`pass`; `unread` yields no part, as `gateMarks` yields `null`) and `PrReading.review` (`pending`→`pending`, `high`→`fail`, `passed`→`pass`, `none`→`none`; `unread` yields no part). The Status cell's `gateValue` string gets no outcome, because the Work items gate column reads `gatesCell`. `CellPart` is also built at `:385-388` for the Where cell's `unpushed` part: give that part `none`, or make the field optional with a stated rule, and say which in the PR body.

**The relative merge time reuses `storyDateText`, unchanged.** `story-date.ts:12`, exported from `domain/src/index.ts:54`. `ageInWords` (`default-branch.ts`) abbreviates ("3 d ago") and the spec forbids abbreviated text; `relativeAge` is board-side and the domain cannot import it. No fourth formatter. `PlanLine.merged` is `merged ` plus `storyDateText(mergedAt, now)`.

**Clamp `now` to `mergedAt` before the call.** `storyDateText` floors the day difference, and for a `mergedAt` later than `now` that gives a negative number, which falls into its `< 7` arm and prints `-1 days ago`. A host and a browser clock disagree by seconds, so this is reachable. The plan's rule is `merged today`.

**The cases, one unit test each (plan item 3):** no `mergedAt`, an empty one or one that does not parse → `merged` absent; the same day → `merged today`; one day → `merged yesterday`; 2 to 6 days → `merged N days ago`; 7 to 29 days → `merged N weeks ago`; 30 days or more → `merged <date>` in `toLocaleDateString()` form, which the test computes the same way (Jan Wloka accepted the locale-dependent date); a `mergedAt` later than `now` → `merged today`. Also assert the boundaries 6/7 and 29/30 days, because a floor-versus-round mistake shows only there. Where `now` is absent (the `placeMapping` parameter is optional), `merged` is absent.

**`PlanLine.text` keeps the ISO date.** `release-plan-rows.test.ts:45` asserts it and must keep passing unchanged.

**`PlanLine.pr` is the merged PR for a Done line and absent where the row cannot say.** For a Done line read `MergedFact.pr`. For an In flight line, read a PR number only if the slice's `AgentRow`s in `factsOf` (`delivery-view.ts`, `mapping.rowsByItem[id]`) already carry one, and pass it through a new optional `PlanSliceFact.pr`. Add no reading and no host call (plan *Approach*). If no row carries it, leave it absent and say so in the PR body; the styling slice then links the slice only.

**`accent` is the default phase's own name, or `neutral`.** It is the rule `phaseColumns` applies (`workflow-phases.ts:236-241`: `hasOwn(PHASE_LEADERSHIP, name) ? name : 'neutral'`). `placeMapping` receives no `PhaseMap` (only `AgentList.tsx` holds `phaseMap`), and the plan allows no component change but the `Date.now()` argument. So derive `accent` from the phase name alone. Do not copy the rule into a second place: extract it as one exported function in `workflow-phases.ts` and have `phaseColumns` call it. That extraction is the one edit outside the plan's *Owns* list; name it in the PR body. First check what `AgentRow.phase` holds (`tuple-row.ts:1275`, documented as "the plan's phase"): it must be a phase name such as `Development`, not a state word such as `approved`. If it is a state word that needs the map to translate, stop and report instead of widening `placeMapping`.

**The open-questions chip keeps its return type.** `openQuestionsChip` returns `string | null` and its caller is `draft-plan-row.tsx:32`, a `.tsx` file this slice may not edit. Add the tone as a sibling export beside the chip, not as a changed return value. `warn` where `count > 0`, `neutral` where `count` is 0, absent where the chip is `null` (absent is not `neutral`). The plan names the type `Tone` (`card-presentation.ts:42-45`), which is board-side; the domain cannot import it, so type the field as the literal union `'warn' | 'neutral'` unless the domain already names an equal type, and say which in the PR body.

**`words` follows the number and holds no number.** The header bar prints the number first in every section and decides no order (plan item 6). Today `SectionCount.text` is `3 queued` in Work items (`workGroupCountText`), `Queued 3` in the other sections, and a fleet wording through `fleetCountText`. `words` is what follows the number in each. `YouHeaderCount.count` is `null` where a reading is absent, and that is not `0`: keep `count` as it is and keep the `not read` wording inside `words` for that case, so a styling slice never prints `null` or `0`. Do not change `text`, `label` or any string the tab renders today.

**`counts` on a release block mirrors `headerText`.** Keys `plans`, `delivered`, `blocked`, `unread`, each `{key, count, words}`. `headerText` (`release-plan-rows.ts:228`) prints `unread` only above 0 and `blocked` only where the strip is passed, so `headerCountParts` follows the same two conditions. The two forms then cannot disagree, and a test holds that: the figures in `counts` equal the figures in `header` for the same block. The `header` string stays beside it.

**Rules carried over unchanged:** absent is not false (an unread reading yields an absent field, never `none`, `neutral` or `0`); a function you write is an arrow, and the domain package takes TSDoc that states what an export does and returns, with no history; the domain takes `now` as a value and never reads a clock; new code says Slice, not Wave; icons come from `glyphs.ts` only and this slice adds none.

### Done when

The plan's `Done when` for this slice is the specification: each new field has a unit test that asserts its value for every value its type names, the relative merge time has one test per case under item 3, `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` and `pnpm run typecheck` pass, the existing tests pass, the only `.tsx` change is the `Date.now()` argument at the one `placeMapping` call, no stylesheet changes, and the tab renders nothing new.

Lift these assertions, because a naive implementation passes without them:

- Every value of `PrReading.ci` and `PrReading.review` has a test for its `outcome`, including `review: 'none'` → `none` and both `unread` values → no part. This catches an outcome parsed from the glyph, and a `none` that stands for unread.
- A `mergedAt` one day after `now` gives `merged today`, and `now` and `mergedAt` equal gives `merged today`. This catches the `-1 days ago` of an unclamped call.
- The `plans`, `delivered`, `blocked` and `unread` figures of `ReleaseBlockView.counts` equal the figures printed in `ReleaseBlockView.header` for the same block, for a release block and for a sprint block. This catches a second counting rule and a sprint block with no counts.
- A `YouHeaderCount` with `count: null` keeps `count: null` and a `words` that says the reading is missing. This catches `0` for absent.
- `TodoLine.verb` and `TodoLine.label` rejoin to `TodoLine.text` for every line, and a release line has both. This catches a release line built outside the shared path.
- `openQuestionsChip` returns exactly what it returned before, for `null`, `undefined`, `0` and `3` questions, and the tone is absent where the chip is `null`. This catches a changed return type that would break `draft-plan-row.tsx`.
- `release-plan-rows.test.ts:45` still passes with no edit.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` after each commit, before each push, and run what it prints. It names the domain tests that relate to your files (`pnpm --filter @plot-pm/domain exec vitest related --run <files>`), the board's related test (`pnpm --filter @plot-pm/board exec vitest related --run --project parallel packages/board/test/unit/delivery-view.test.ts`) and both typechecks. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally.

Add a changeset for the package `@plot-pm/board`: the description first, at least 20 characters, then the `plan: docs/plans/2026-11-18-delivery-tab-matches-its-mockups.md` line inside the comment block, and no `bumps:` entry, because this slice changes no skill. This slice touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` has nothing to count. If `pnpm build:board` runs locally, restore every generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. The PR body names: the line ranges you re-measured on your base, whether items 2 and 3 were owed in full (they were at `7c246a4fb`), how you set `outcome` on the Where cell's `unpushed` part, the `Tone` decision, whether `PlanLine.pr` is read for an In flight line, and the `workflow-phases.ts` extraction.

### Scope guard

This branch owns, in `packages/domain/src/`: `rules/delivery-row-form.ts` (`CellPart`, `gatesCell`, `gateMarks`), `rules/release-plan-rows.ts` (`PlanRowFacts`, `PlanLine`, `PlanSliceFact`, `planLines`, `planRowFacts`, `headerCountParts`), `rules/todo-list.ts` (`TodoLine`), `rules/plan-open-questions.ts`, `rules/you-header.ts` (`YouHeaderCount`) and `index.ts` for any new export. In the board it owns the view builders that pass the new readings and render nothing: `lib/agent-rows/delivery-view.ts` (`SectionCount`, `summarise`, `ReleaseBlockView`, the `planRowFacts` call, the `placeMapping` parameter) and `lib/agent-rows/you-header.ts` (`youHeaderOf`). The one `.tsx` line is the `placeMapping` call at `AgentList.tsx:1173`. Tests go in `packages/domain/test/{delivery-row-form,release-plan-rows,todo-list,plan-open-questions,you-header}.test.ts` and `packages/board/test/unit/delivery-view.test.ts`; fix a caller in `sprint-delivery-view.test.ts` only if the new parameter breaks it. The single permitted edit outside that list is the accent extraction in `rules/workflow-phases.ts`. No stylesheet, no component, no `draft-plan-row.tsx`.

Other branches in flight, verified 2026-11-19 on origin: no `feature/delivery-*` ref exists there, so nothing else edits these files. The next waves, `feature/delivery-visual-primitives` and the six *Sections* branches, wait on this slice by heading order and read the fields you add; rename none of the names above.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
