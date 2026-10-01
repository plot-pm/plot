## Implementation brief — a-plan-row-shows-plan-status-only

- **Plan (canonical):** `docs/plans/2026-10-01-a-plan-row-shows-plan-status-only.md` on `main`
- **Approved:** 2026-10-01, jwloka, in-session
- **Branch:** `bug/a-plan-row-shows-plan-status-only` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)
- **Issue:** #1115

One slice, one wave. Nothing waits on it and it waits on nothing. The branch ref already exists on `origin` at `81009b41` (the approval commit) and carries no work: check it out, do not re-create it.

### What to build

A one-slice plan's row prints its slice's verdict beside the plan's phase. Measured 2026-10-01 in DONE with every plan head collapsed: `1099: a-fleet-agent-starts-without-the-operators-plugins` and `1104: a-plan-row-names-its-ticket` read `Testing complete`, and `1103: a-plan-row-says-its-verdict-once` reads `Development complete`. A plan in Testing is delivered and not released, so it is not complete. `complete` is the slice's wave verdict, and a reader takes it for the plan's status.

The fix is a removal. `PlanRow`'s status cell (`packages/board/src/app/lib/agent-rows/rows.tsx:816`) drops the `soleSlice?.verdict && showsSoleVerdict` branch and always takes the `prFold` branch. The rule #1109 added to decide that branch goes with it: `planRowShowsSoleVerdict` (`lib/agent-rows/stuck.ts:148`), the `showsSoleVerdict` prop (`rows.tsx:458`, `:561`), and its two computations in `AgentList.tsx` (`:1642`, `:1999`). The plan is canonical. This brief is orientation.

### Settled decisions — do not re-derive them

**A plan row never shows a slice's status. This is the operator's rule (2026-10-01), not a heuristic to tune.** #1103 tried "the verdict once per section": the plan row printed it where the slice row was hidden or printed a PR word. Collapsed heads are DONE's default, so most plan rows still carried a slice verdict, and that is the measured defect. Do not restore a condition under which the plan row prints the verdict, for example "only where no slice row is drawn". Every such condition reproduces `Testing complete` on a collapsed head.

**A slice's verdict can then appear on no row, and that is accepted.** A one-branch slice row whose `soleRowStatus` is a word (`green`, `delivered`, `open`, `working`, …) prints that word and not the verdict. The plan states this under *Where the verdict still appears*. Do not add the verdict to the slice row or to the plan row to "keep it visible".

**A green, merged or absent PR folds to nothing.** `planPrAggregate` (`packages/board/src/app/lib/tuple-row.ts:458`) ranks only `conflicts`, `failing` and `pending`, and returns `null` for `green`, `none`, `unknown` and `closed`. So most one-slice plans show the phase, the rounds badge and nothing else. That is correct. Do not add a fallback word in the slot.

**`soleSlice` keeps one job, the *Start work* action.** The gate `soleSlice?.verdict === 'eligible' && card && dispatch` on the plan row stays exactly as it is, and so does the `soleSlice` prop. Do not replace `soleSlice` with a boolean, and do not delete it because it no longer feeds the status cell.

**`soleRowStatus` stays exported.** `rows.tsx:1176` reads it, and `test/unit/agent-list.test.ts:704` tests it. Only the `AgentList.tsx:80` import drops it, together with `planRowShowsSoleVerdict`. With both names gone the import keeps `hasExceptions` alone. Without that drop, `noUnusedLocals` fails the typecheck.

**The call-site locals stay.** `unbegunSliceGroups` (`AgentList.tsx:1545`), `planSliceRowsShown` (`:1516`) and `planSliceGroups` (`:1515`) each have readers other than the `showsSoleVerdict` argument (measured on `81009b41`: `:1718`, `:1951`/`:2072`, `:1957`). Remove only the `showsSoleVerdict={…}` props and their comments. Do not delete the locals.

**The slice summary stays.** `[data-slice-summary]` (`rows.tsx:853-862`, from `sliceSummaryFor`, `sections.ts:585-598`) reads `1 slice, first eligible`. It is labelled as a slice fact. Do not remove it as part of this change.

**The rounds badge is untouched.** It sits before the status slot in `statusExtra` and answers a different question.

Rules carried over from earlier board work:

- The client casts the fleet and never parses it. Zod defaults do not apply in the renderer, so a field that is absent reads as `undefined`.
- Board browser tests load the built artifact. Run `pnpm build:board` before a browser test, or a stale artifact passes or fails for the wrong reason.
- A board test run rewrites the tiny-garden pulse fixture. Check `git status` before a commit, and never run `git add -A` after a suite run.
- Any function you write or rewrite is an arrow function.

### Done when

The plan's `## Done when` list is the specification. These assertions exist because a naive implementation passes without them:

- **`grep -rE 'showsSoleVerdict|planRowShowsSoleVerdict' packages/board` returns nothing.** This catches a change that keeps the prop and defaults it to `false`. That version passes every browser test and leaves the rule in place for the next person to switch back on. The grep covers comments and tests too, so the comments the plan lists (`AgentList.tsx:1626-1641`, `:1947-1950`, `:1977-1998`, `:2121`; `rows.tsx:528-545`, `:550`, `:776-792`, `:1046-1050`; `plan-rounds-badge.browser.test.ts:26-31`) must state the new rule.
- **DONE, PR state `unknown`, head collapsed: the plan row has no `data-sole-wave-verdict`. Head open: the slice row shows the verdict once.** This is the measured defect in its exact shape. `unknown` is the case where `soleRowStatus` is `''` and the slice row falls back to the verdict.
- **A `green` PR, head collapsed and open: no verdict on the plan row, and no fold word.** This catches a fallback that prints something in the empty slot.
- **WAITING ON YOU with a `pending`, `failing` or `conflicts` PR: the plan row shows the fold word and no verdict.** Under #1103's rule the verdict outranked the fold. This test proves the fold now owns the slot.
- **NOT STARTED, eligible one-slice plan: the plan row still carries *Start work*.** This catches a change that removes `soleSlice` with the verdict.
- **The three test files are rewritten, not deleted.** `plan-row-verdict-once.browser.test.ts` holds 4 `sole-wave-verdict` references: each one that expects a verdict on the plan row now expects none. The `planRowShowsSoleVerdict` describe block in `test/unit/stuck-display.test.ts:427` goes with the function, and its import on `:5` drops the name. `plan-rounds-badge.browser.test.ts` changes only in its docstring.

Plus the repo gates: `nvm use` (Node 24), `pnpm test`, `pnpm run typecheck`, `pnpm run test:board` (it rebuilds the artifact), and a committed `skills/plot/scripts/board/board-server.mjs`. Add a changeset with `'@plot-pm/board': patch`, the description first, and no `bumps:` block. Do not run `test:e2e` locally.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work still moves). Never run `gh pr create`.
- When the PR exists, put its number inside this branch's heading in the plan's `## Slices` section on `main`: `(Branch: bug/a-plan-row-shows-plan-status-only, PR: #N)`. A trailing `→ #N` does not parse on a heading.
- No project board is configured, so there is no status to set.

### Scope guard

This branch owns:

- `packages/board/src/app/lib/agent-rows/stuck.ts`: the removal of `planRowShowsSoleVerdict` and its docstring only
- `packages/board/src/app/lib/agent-rows/rows.tsx`: `PlanRow`'s status cell, the `showsSoleVerdict` prop, and the comments listed above
- `packages/board/src/app/components/AgentList.tsx`: the import at `:80`, the two `PlanRow` call sites, and the comments listed above
- `packages/board/test/unit/stuck-display.test.ts`, `packages/board/test/integration/plan-row-verdict-once.browser.test.ts`, `packages/board/test/integration/plan-rounds-badge.browser.test.ts`
- the rebuilt board artifact and one changeset

Verified at dispatch (2026-10-01): no other remote branch and no open PR changes `rows.tsx`, `AgentList.tsx`, `stuck.ts`, `tuple-row.ts` or the three test files. `tuple-row.ts` and `sections.ts` are read-only for this slice.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
