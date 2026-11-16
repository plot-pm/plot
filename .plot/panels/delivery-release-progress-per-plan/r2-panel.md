# Panel moderation, round 2: delivery-release-progress-per-plan

Reading: `plot-panel.mjs reconcile` returns `unanimous amend` (estate, contradiction, deliverable, cost). Siblings: 7 read, 0 unread (no active sprint; every unfinished plan).

## Shared position

All four jurors hold `amend`. None holds `reject`. Round 1's resolutions (waits, Owner source, mapping table, in-flight guarantee) held against the siblings and the source.

## Disagreements

None on position or severity. Three jurors rate the Start-eligibility and missing-Owner-wait findings as blocking a slice; the cost juror rates its findings as misleading.

## Findings by juror count

- Four jurors: Done-line data source has no fallback for a MERGED row with no `mergedAt` or no index row; scope is claimed by plan 1's `feature/delivery-my-sprint-scope` and this plan's sprint-scope slice with no declared order; Queued slices (plan 3) fit none of the five states.
- Three jurors: `sliceProgress` returns a string, its counts live in the unexported `slicesOf`; Start eligibility reads `startability` from rows that `isUnbegun` removes.
- One juror each: plan-rows reads sprint Owner without waiting on `feature/sprint-owner-field` (estate); named-commit date needs a new Refs operation and a git spawn (cost); person-card unit is ambiguous (deliverable); person-cards and sprint-scope slices can run in parallel on one module (cost); plan 3 says Release delivery rows keep `ROW_COLUMNS` (contradiction); a stored collapse key keeps an already-collapsed section collapsed (deliverable).

## What each juror looked at

Each read the plan, the cited source lines and the sibling plans' slice lines. The estate juror read the most source (`delivery-view.ts`, `AgentList.tsx`, `row-identity.ts`, `fleet.ts`, `schema.ts`, `deliverable.ts`, `pr-index.ts`). All four only read and grepped; none ran a test or the board.

## Shared blind spot

No juror ran the board, so none checked what the served payload carries per slice today. The Bitbucket `mergedAt` finding (`bitbucket-pr-row.ts:49` writes `updated_on`) comes from one juror reading one adapter and has no second reader.

## Acted on

Nothing. The findings are Open Questions in the plan. No decision changed and no phase moved.
