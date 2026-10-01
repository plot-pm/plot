# A plan row shows plan status only

> A one-slice plan's row prints its slice's verdict beside the plan's phase, `Testing complete`. A plan in Testing is delivered and not released, so it is not complete; `complete` is the slice's wave verdict.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #1115
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A plan row no longer prints a slice's verdict: its status cell shows the plan's phase, its rounds badge and its PR state, and a slice's verdict appears only on the slice row.

Board impact: yes. The status cell of every one-slice plan row changes; the payload is unchanged.

## Motivation

Measured 2026-10-01 on the DONE section with every plan head collapsed, after #1109 (issue #1103): `1099: a-fleet-agent-starts-without-the-operators-plugins` reads `Testing complete`, `1104: a-plan-row-names-its-ticket` reads `Testing complete`, and `1103: a-plan-row-says-its-verdict-once` reads `Development complete`.

#1109 made the verdict appear once per section: the plan row prints it when the slice row is hidden or prints a PR word (`planRowShowsSoleVerdict`, `packages/board/src/app/lib/agent-rows/stuck.ts:148`). Collapsed heads are DONE's default, so most plan rows carry a slice verdict, and a reader takes it for the plan's status. The operator's rule: a slice's status is never shown as a plan's status.

## Design

**A plan row's status cell carries plan facts only**: the phase, the rounds badge, and the PR fold. A one-slice plan's row is built exactly as a multi-slice plan's row is: `statusExtra` in `PlanRow` (`rows.tsx:816`) loses the `soleSlice?.verdict && showsSoleVerdict` branch and always takes the `prFold` branch.

**The rule from #1109 goes.** `planRowShowsSoleVerdict` (`stuck.ts:148`) and its unit tests are removed; `PlanRow` loses the `showsSoleVerdict` prop (`rows.tsx:458`, `:534`, `:561`, `:780`); the two call sites in `AgentList.tsx` (`:1642`, `:1999`) stop computing it, and the import at `AgentList.tsx:80` drops both `planRowShowsSoleVerdict` and `soleRowStatus`, which has no other reader in that file and fails `noUnusedLocals`. `soleRowStatus` stays exported for `rows.tsx:1176`. The comments that describe the old rule state the new one: `AgentList.tsx:1626-1641`, `:1947-1950`, `:1977-1998`, `:2121`, `rows.tsx:528-545`, `:550`, `:776-792`, `:1046-1050`, and the docstring at `plan-rounds-badge.browser.test.ts:26-31`.

**A green, merged or absent PR folds to nothing.** `planPrAggregate` (`tuple-row.ts:458`) ranks only `conflicts`, `failing` and `pending`, so a one-slice plan whose PR is green, merged or absent shows its phase and its rounds badge and nothing else.

**`soleSlice` keeps one job**: carrying an eligible one-slice plan's *Start work* action onto the plan row (`soleSlice?.verdict === 'eligible' && card && dispatch`). That is an action, not a status, and it is unchanged.

**Where the verdict still appears.** A slice row of several branches, or of one branch whose `soleRowStatus` is empty (PR state `unknown`), prints the verdict. A slice row of one branch with a worker, PR or state word prints that word, so that plan's verdict appears on no row. The operator's rule accepts this: the slice row states the slice's own status, and the plan row states the plan's.

**The slice summary stays.** `[data-slice-summary]` (`rows.tsx:853-862`, from `sliceSummaryFor`, `sections.ts:585-598`) reads `1 slice, first eligible` on a one-slice plan. It stays, because it is labelled as a slice fact and counts the plan's slices; a reader does not take it for the plan's phase.

## Done when

- `planRowShowsSoleVerdict` and the `showsSoleVerdict` prop no longer exist: `grep -rE 'showsSoleVerdict|planRowShowsSoleVerdict' packages/board` returns nothing.
- A browser test over a one-slice plan in DONE whose one branch has PR state `unknown` renders the phase and no `data-sole-wave-verdict` with its head collapsed; with the head open, the slice row renders the verdict once.
- A one-slice plan whose one branch has a `green` PR shows no verdict on the plan row, with the head collapsed or open.
- A one-slice plan in WAITING ON YOU whose open PR is `pending`, `failing` or `conflicts` renders that fold word on the plan row and no verdict.
- An eligible one-slice plan in NOT STARTED still carries *Start work* on its plan row.
- `plan-row-verdict-once.browser.test.ts`, `plan-rounds-badge.browser.test.ts` and `stuck-display.test.ts` are rewritten to the new rule, not deleted blind: each assertion that expected a plan-row verdict now expects none.

## Slices

### A plan row shows plan status only (Branch: bug/a-plan-row-shows-plan-status-only)

`PlanRow`'s status cell, the removal of `planRowShowsSoleVerdict` and the prop, the two call sites, the comments, and the three test files.

## Notes

Supersedes the plan-row half of `a-plan-row-says-its-verdict-once` (#1103), whose design kept the verdict on the plan row when the slice row was hidden or showed a PR word. The operator rejected that on 2026-10-01: a plan row never shows a slice's status.
