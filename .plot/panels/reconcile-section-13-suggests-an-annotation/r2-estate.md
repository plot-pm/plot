# Round 2 — estate juror

Position: amend

Ran nothing. I read the scan, the domain rule, the board decoder and the tests. Round 1's blind spot (no fixture run) stays open for me.

## Round 1 claims checked

- CONFIRMED: the hint at `skills/plot/scripts/plot-reconcile-scan.sh:1866` names an annotation, and the loop (`:1851-1869`) reads only `^- \[ \] \[slug\]` and the plan phase. Nothing after the slug is read.
- CONFIRMED: "any HTML comment" collides with the approve annotation. `annotateSprintItem` (`packages/domain/src/rules/sprint-annotation.ts:40-60`) appends `<!-- pr: #N, branch: x -->` to the member line, and `delivery-ui-polish.md:24-28` shows the shipped shape on every approved item. Under "any comment", most unchecked Delivered items would read as kept open.
- CONFIRMED: `staleTally` exists in the domain (`workflows/reconcile.ts:130`, finding `sprint-tally-stale` at `:328`, decoded at `packages/board/src/server/entry/reconcile.ts:170`, tested at `packages/domain/test/workflows-reconcile.test.ts:332`). The plan's "Board impact: none ... the board reads neither" is false. It is a declared duplicate of section 13 and needs a named place for the same rule, or a statement that the field is unfilled.
- CONFIRMED: the `scan.test.mjs:298` summary line is a literal string with `stale_tally=0`. A new footer counter breaks it. Section 13 tests live at `scan.test.mjs:1705-1866`, and the footer assertions at `:1849` and `:1866` pin `stale_tally=2`.
- CONFIRMED: the plan defines no kept-open state anywhere else in the estate. `grep` for "kept open", "stays unchecked" finds only the hint line. No sibling plan (`docs/plans/active/*`, `delivery-ui-polish` members) touches section 13. No delivered plan duplicates it. The claim "does not exist" holds.

## What round 1 missed

- The unchecked-Delivered state has an owner already: `deliver.ts` ticks the box and `/plot-sprint close` step 2a ticks it (per round 1, not re-verified by me). The simplest estate-consistent change is option 2: delete the half-promise from line 1866 and keep the finding. One line changes. The shell-line ratchet is satisfied by replacement, not growth.
- The plan's `Rounds: 1` and Open Questions block Approval. Four open questions remain in the body and seven Open Points. None has a decision.
- The plan cites `Related: #3489` as the consumer's issue. In this repo #3489 is another plan (round 1, confirmed by the slug list; I did not open it).

## What blocks approval

Option 1 vs 2 is undecided. Every Open Question hangs off it.

## What I would change

1. Pick option 2 in the plan. Rewrite Approach, Changelog, slice name and branch to "the hint stops naming an annotation". Drop the annotation syntax, the unshipped-release suppression and the counter questions.
2. If option 1 stays, require an `open: <reason>` field inside the existing comment, with a defined terminator, and name the `staleTally` rule update plus the shell-line offset.
3. Fix the Board impact comment to name `workflows/reconcile.ts` and the board decoder.
4. Fix the #3489 reference.
