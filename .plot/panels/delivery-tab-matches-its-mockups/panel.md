# Panel: delivery-tab-matches-its-mockups

Reconciliation: unanimous `amend` (estate, contradiction, deliverable, cost). Siblings: 4 read, 0 unread (no active sprint; every unfinished plan under `docs/plans/active/`). All four jurors read the plan and the checkout at `a525da09c`; the cost juror also recomputed the contrast table by script. No juror ran a browser or a build.

## What the lenses share

Every juror verified the plan's line citations and its "does not exist" claims, and every one found them right. Four jurors agree on the amendment, and two of the findings are held by three of them.

- **The `Owns` lists do not cover the markup the Sections slices need** (contradiction 1-2, deliverable 2, cost 11). The Free line, the Fleet counts line, the Do verb and the group tags sit in `AgentList.tsx` or `TupleRow.tsx`, and no slice owns them. The plan states "Only `feature/delivery-visual-release` edits `AgentList.tsx`", which then contradicts the slice descriptions. The disjoint-files claim carries the whole parallel wave.
- **The test-selector inventory is incomplete** (contradiction 4, cost 7-8). Besides the five integration files, `dead-fetch.browser.test.ts:91,153` and unit tests (`agent-list.test.ts:1021,1338-1550`, `tuple-row.test.ts:1234`) read classes. 26 integration files read `innerText`.
- **The artifact link as done-when** (cost 5, deliverable 9) depends on a CI run that finishes after the PR body is written.

## What each lens alone found

- Estate: `delivery-release-progress-per-plan.md:21,47,54` already promises the Phase column and "merged 2 days ago", so Domain Fields items 2 and 3 need a named owner. The `ChipColour` mapping omits `sky` and `orange`. 492 `dark:` uses and `server/board.ts:3723` stay outside the token change.
- Contradiction: the five-state colour map edits `SprintCard.tsx` and `FleetCard.tsx`, which only the tab-header slice owns. Group colours have two homes (`YOU_MARKER_CLASS` and `data-group` selectors).
- Deliverable: two slices own components with no path yet. The Sections slices carry no `waits:` marker for Primitives. Primitives bundles three jobs.
- Cost: dark contrast figures differ from the plan by 0.5 to 1.2 (all still pass 4.5), and `--card-primary` dark reads 5.36, not 4.74. Light margins are thin (green on soft 4.72). Every board-integration PR uploads screenshots, with no size or `retention-days`. Light theme has no mockup.

## Disagreements

None in position. One difference in weight: the deliverable and cost jurors suggest splitting Primitives (harness and CI step apart), the others do not raise it. It is an option, not a finding any juror holds as blocking.

## Blind spot

All four lenses read the plan as text. None rendered the board, so none can say whether a card layout in the plan's Primitives shapes reads like the mockups.
