## Implementation brief — a-plan-row-says-its-verdict-once

- **Plan (canonical):** `docs/plans/2026-09-30-a-plan-row-says-its-verdict-once.md` on `main`
- **Approved:** 2026-09-30, jwloka, in-session
- **Branch:** `bug/a-plan-row-says-its-verdict-once` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)
- **Issue:** #1103

One slice, one wave. Nothing waits on it and it waits on nothing.

### What to build

A one-slice plan prints its slice's verdict twice: `PlanRow` prints `soleSlice.verdict` in its status cell, and the slice row beneath it prints the same verdict. Measured 2026-09-30: `a-cold-bitbucket-board-buys-the-whole-list` (PR #1061) shows `Testing` `complete` on its plan row and `complete` on its slice row in DONE.

The plan row printed the verdict because the slice row was once suppressed for one-slice plans. `AgentList.tsx:1645` now renders a slice row for every plan, so the premise in the `soleSlice` docstring (`rows.tsx:530-532`) is false.

The fix is a pure view-state function, `planRowShowsSoleVerdict({ sliceRowVisible, soleRowStatus })`, in `packages/board/src/app/lib/agent-rows/stuck.ts` beside `soleRowStatus` (`:104`). `PlanRow` asks it before printing the verdict. Where it answers `true`, the plan row prints the verdict and no PR fold. Where it answers `false`, the plan row prints the PR fold and no verdict. The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**The rule is per section, not per plan.** `soleSliceFor` (`AgentList.tsx:101`) ignores the section. A plan whose rows split across NOT STARTED and WAITING ON YOU renders a plan row in each, and each row asks the function with its own section's inputs. Do not compute one answer per plan and share it.

**The function's contract is exact.** It answers `true` when `sliceRowVisible` is false, or when `soleRowStatus` is a non-empty string. Otherwise it answers `false`. `soleRowStatus` is `null` for a slice that holds several branches, because that slice row prints `N <verdict>` or `<verdict> · N left`. It is `''` only when the one branch's PR state is `unknown`. Every other one-branch row prints a word of its own: `green`, `checks failing`, `deferred`, `delivered`, `open`, `working` or `stalled`. The round-2 juror measured this by bundling `soleRowStatus` from `stuck.ts` at `04f18780`. Do not reinterpret "empty" as "no PR".

**Two call sites compute the inputs from expressions they already hold.** No new state and no new payload field are needed, because the plan states "the payload is unchanged".

| Call site | `sliceRowVisible` | `soleRowStatus` |
|---|---|---|
| NOT STARTED, `soleSlice=` at `AgentList.tsx:1582` | `groupBySlice(group.rows.filter(isUnbegun)).length > 0`. The expression is pure in `group.rows`, so hoist it from `:1652` to the `PlanRow` call. An all-deferred plan renders no slice row here, so the plan row keeps the verdict. | always `null`: the `SliceRow` here gets no `soleRow` and always prints the verdict |
| WAITING ON YOU, QUIET, DONE (`planHeads`), `soleSlice=` at `:1911` | the SAME expression as `expanded` at `:1881` and the list guard at `:1975`: `!planHeads \|\| hasExceptions(group.rows) \|\| (one slice ? !openPlans.has('shut:'+plan) : openPlans.has('open:'+plan))` | `soleRowStatus(wg.rows[0])` where the slice holds one branch; `null` where it holds several |

**The visibility expression now has three readers.** The comment at `:1971-1974` says the first two "MUST agree or the caret says one thing while the content says another". A third copy makes drift likelier. Extract one local helper in `AgentList.tsx` that all three read, or give a reason in the PR why not. The arrow-function rule applies to any helper you write.

**At `:1582` the fold guard needs no input.** `expanded` is always `null` for a one-slice plan in NOT STARTED, so the collapsed-head case exists only in the `planHeads` sections (round-4 note).

**`soleSlice` keeps its second job.** It gates the plan row's *Start work* at `rows.tsx:877-881` (`soleSlice?.verdict === 'eligible' && card && dispatch`). Leave that gate and the `soleSlice` prop as they are. Do not replace `soleSlice` with a boolean.

**The rounds badge is untouched.** It sits before the verdict or fold in `statusExtra` (`rows.tsx:753-775`) and answers a different question.

Rules carried over from earlier board work:

- The client casts the fleet and never parses it. Zod defaults do not apply in the renderer, so a field that is absent reads as `undefined`.
- Board browser tests load the built artifact. Run `pnpm build:board` before a browser test, or a stale artifact passes or fails for the wrong reason.
- A board test run rewrites the tiny-garden pulse fixture. Check `git status` before a commit, and never run `git add -A` after a suite run.

### Done when

The plan's `## Done when` list is the specification. These assertions exist because a naive implementation passes without them:

- **A unit test per row of the plan's table**, including `soleRowStatus: null`. This catches an implementation that treats `null` and `''` the same way, which prints the verdict twice for a slice of several branches.
- **DONE, `pr.state: 'unknown'`, head open**: the verdict text occurs once on the page for that plan, on the slice row, and the plan row has no `data-sole-wave-verdict`. This is the measured defect.
- **WAITING ON YOU, open PR, head open**: the verdict is on the plan row, the PR word is on the slice row, and the plan row has no `data-plan-pr-fold`. This catches an implementation that prints the verdict and the fold together.
- **A slice of two branches**: the verdict is on the slice row only.
- **A collapsed one-slice head in WAITING ON YOU**: the plan row keeps the verdict. This catches a `sliceRowVisible` that ignores the `shut:` override.
- **An all-deferred Approved plan in NOT STARTED**: the plan row keeps the verdict. This catches a `sliceRowVisible` hardcoded to `true` in NOT STARTED.
- **An unbegun branch in NOT STARTED**: the verdict appears once, on the slice row, and an `eligible` plan still carries *Start work* on the plan row. This catches a change that removes the verdict and the dispatch gate together.
- **The comments state the new rule**: the `soleSlice` docstring (`rows.tsx:527-533`), `rows.tsx:539`, `:746-750`, `:753`, `AgentList.tsx:1580`, `:1645`, `:1908`, `:2019`, and the header of `packages/board/test/integration/plan-rounds-badge.browser.test.ts`.

Plus the repo gates: `nvm use` (Node 24), `pnpm test`, `pnpm run typecheck`, `pnpm run test:board` (it rebuilds the artifact), and a committed `skills/plot/scripts/board/board-server.mjs`. Add a changeset with `'@plot-pm/board': patch`, the description first, and no `bumps:` block. Do not run `test:e2e` locally.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work still moves). Never run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's heading in the plan's `## Slices` section on `main`. A waves plan takes the PR inside the heading: `(Branch: bug/a-plan-row-says-its-verdict-once, PR: #N)`.
- No project board is configured, so no status to set.

### Scope guard

This branch owns:

- `packages/board/src/app/lib/agent-rows/stuck.ts`: the new function only
- `packages/board/src/app/lib/agent-rows/rows.tsx`: `PlanRow`'s status cell and the comments listed above
- `packages/board/src/app/components/AgentList.tsx`: the two `PlanRow` call sites, the visibility helper, and the comments listed above
- `packages/board/test/unit/`: the unit test (`stuck.test.ts` exists)
- `packages/board/test/integration/`: the new browser tests and the `plan-rounds-badge.browser.test.ts` header
- the rebuilt board artifact and one changeset

Verified at dispatch (2026-09-30): `feature/a-plan-row-names-its-ticket` is in flight with no PR yet. It edits `PlanRow` in `rows.tsx` at `:612` and `lib/agent-rows/draft-plan-row.tsx`. That hunk does not overlap this slice's status cell at `:746-790`, but the two branches change one function. The second branch to merge rebases and rebuilds the artifact. On an artifact conflict, take either side and run `pnpm build:board`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
