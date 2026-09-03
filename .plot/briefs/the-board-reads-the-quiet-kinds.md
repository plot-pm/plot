## Implementation brief — the-board-reads-the-quiet-kinds (wave Reading it on the board)

- **Plan (canonical):** `docs/plans/2026-09-03-quiet-is-not-one-state.md` on `main`
- **Approved:** 2026-09-03, Jan Wloka, in-session
- **Branch:** `feature/the-board-reads-the-quiet-kinds` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Wave 2 of two, and the last. **The plan delivers when this lands.** It waits on `feature/quiet-holds-one-kind-of-row`; if that has not merged, write a `PLOT-BLOCKED` file naming it and stop.

### What this branch owns

**The two readers call the rule** instead of falling through to an age note. An orphaned claim and abandoned work each get a placement and a sentence; a declined PR reads as declined **and stays visible**.

**TWO READERS, AND THE SPLIT IS NOT NEGOTIABLE.** `classifyGroup` answers the branch kinds. **`prState` answers the closed one**, because `classifyGroup` cannot see a closed PR at all — it says so twice, and records the mistake being made: *"NO `CLOSED` ARM HERE… the `byHead` map is open-only, so a closed PR never arrives — an arm for it would be dead code. I wrote one on 2026-08-21 before reading that line; `prState` is where the closed case belongs."* `prState` already returns `closed` and already says *CLOSED OUTRANKS EVERY CHECK*; the machinery exists and only the reading of it is missing.

**A DECLINED PR DOES NOT DISAPPEAR.** An earlier draft of this brief said it should, and interrogation disproved it on 2026-09-03: #53, #363 and #654 all still have **live refs**. The branch exists, still holds a worktree slot, and is still findable by everything except the surface a person acts through. Hiding it would make the board lie in the other direction.

**MOVE THE ROWS, do not only relabel them.** This is the plan's own warning and it comes from a mistake made the same week. `#669` fixed a withdrawn plan's *note* and kept its group, with a comment calling that conservative — so the row went on asking a person for a decision its own sentence said was made, and sat in WAITING ON YOU for a day until `#675` moved it. **The group is the half that asks for something.** A kind that needs no action does not belong in a section that means one is owed.

**One browser test per kind**, proving the badge shows what the rule decided — the rendering, not the deciding. Per the Layering Rule: *a view state that cannot be asserted without a browser is a domain property that has not been extracted yet*, and the deciding slice extracted them.

### What it does NOT own

**The rule.** Merged in the deciding slice. Do not re-derive a decision in `.tsx` or in `fleet.ts`; call it.

**The sweep**, and the agent lifecycle.

### Done when

- A declined PR reads as **declined** rather than as silence, and is still on the board — asserted, because an earlier draft of this brief asked for the opposite.
- An orphaned claim and abandoned work each read as themselves, and neither says *in progress*.
- Every rendered kind is asserted by a unit test on the rule plus one browser test on the badge.
- Green: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, plus `cd packages/domain && npx tsc --noEmit` and `pnpm run test:corpus`.
- `pnpm build:board` run and the artifact committed.
- A changeset, description FIRST and any `bumps:` block LAST.

**Do not run `pnpm run test:e2e`.** It is CI's gate.
