# Panel round 2: delivery-tab-matches-its-mockups

Reconciliation: unanimous `amend` (estate, contradiction, deliverable, cost); the gate committed all four. Siblings: 4 read, 0 unread (the active sprint `bug-fixes-2-35-0` has no unfinished member, so the siblings are the other plans under `docs/plans/active/`). Every juror read the plan and the checkout; the cost juror recomputed the contrast table by script and confirmed its figures. No juror rendered the board or ran a build.

## What the lenses share

- **`now` cannot reach `planRowFacts` inside the Domain fields slice** (estate 3, deliverable 2, cost 2). `placeMapping` takes no clock and its only caller is a component, while the slice owns no `.tsx` file.
- **The screenshot artifact can be absent on the PR head** (estate 6, deliverable 4, cost 1). `board-integration` is skipped when CI reuses a green run.
- **A section stylesheet overriding a Tailwind colour class has an unstated cascade order** (contradiction 3, deliverable 8).

## What each lens alone found

- Estate: the Plans tab already colours phases differently (`PHASE_ACCENT`); three relative-time formatters exist; item 1 names `gateValue`, which builds no `CellPart`; the released `one-card-grammar` plan already holds chip and tone vocabulary.
- Contradiction: the Release header is one string, so the bold coloured number needs a seventh Domain field (the one finding rated `blocks`); the Do cell range names the By cell and the Do verb lives in the Work items file; "being built" takes green and blue; the section card maps to the wrong mockup colour.
- Deliverable: the changelog omits the Phase column and the relative date; the tab-header column wrapper has no owner; the relative time has no case list; "six fields" counts eight.
- Cost: the critical path is seven serial merges, three of them unwritten slices of other plans; the contrast gate misses `--card-meta` on the `-strong` backgrounds (4.35 in light); the screenshot test costs about 32 renders per `board-integration` run.

## Disagreements

None in position. No juror proposed `reject`; the Release header finding is the only one rated `blocks`, and it blocks one branch, not the plan.

## Blind spot

All four lenses read text and source. The round-1 blind spot stands: none rendered the board against a mockup. All four also verified the plan's citations against `89407abdc`-era code; a juror reading the three open sibling PRs' branches found no overlap beyond what the plan states.

Nothing is approved, rejected or moved by this panel. The findings are Round 2 items under *Open Questions* in the plan, unanswered.
