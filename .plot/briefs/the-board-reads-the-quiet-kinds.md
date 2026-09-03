## Implementation brief — the-board-reads-the-quiet-kinds (wave Reading it on the board)

- **Plan (canonical):** `docs/plans/2026-09-03-quiet-is-not-one-state.md` on `main`
- **Approved:** 2026-09-03, Jan Wloka, in-session
- **Branch:** `feature/the-board-reads-the-quiet-kinds` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Wave 2 of two, and the last. **The plan delivers when this lands.** It waits on `feature/quiet-holds-one-kind-of-row`; if that has not merged, write a `PLOT-BLOCKED` file naming it and stop.

### What this branch owns

**`classifyGroup` calls the rule** instead of falling through to an age note. A closed PR leaves the board; an orphaned claim and abandoned work each get a placement and a sentence.

**MOVE THE ROWS, do not only relabel them.** This is the plan's own warning and it comes from a mistake made the same week. `#669` fixed a withdrawn plan's *note* and kept its group, with a comment calling that conservative — so the row went on asking a person for a decision its own sentence said was made, and sat in WAITING ON YOU for a day until `#675` moved it. **The group is the half that asks for something.** A kind that needs no action does not belong in a section that means one is owed.

**One browser test per kind**, proving the badge shows what the rule decided — the rendering, not the deciding. Per the Layering Rule: *a view state that cannot be asserted without a browser is a domain property that has not been extracted yet*, and wave 1 extracted them.

### What it does NOT own

**The rule.** Merged in wave 1. Do not re-derive a decision in `.tsx` or in `fleet.ts`; call it.

**The sweep**, and the agent lifecycle.

### Done when

- A closed PR no longer appears; the 17 measured on 2026-09-03 are gone from the board.
- An orphaned claim and abandoned work each read as themselves, and neither says *in progress*.
- Every rendered kind is asserted by a unit test on the rule plus one browser test on the badge.
- Green: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, plus `cd packages/domain && npx tsc --noEmit` and `pnpm run test:corpus`.
- `pnpm build:board` run and the artifact committed.
- A changeset, description FIRST and any `bumps:` block LAST.

**Do not run `pnpm run test:e2e`.** It is CI's gate.
