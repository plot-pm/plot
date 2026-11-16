# Panel round 2: delivery-you-blocks-or-feeds

Reconciliation: unanimous `amend` (estate, contradiction, deliverable, cost). Gate: 4 of 4 committed on the first run, no send-back.

siblings: 7 read, 0 unread (no sprint is active; the unfinished plans in `docs/plans/active/`)

## What each juror looked at

All four read the plan, the round-1 moderation, the design spec, the seven siblings and the code the plan cites. None ran code or the board. Every position is a reading position.

## Finding held by all four

The round-1 amendment "You places an item only when `ownership === 'mine'`" is wrong. A loose branch with no PR reads `unknown` ownership (`ownership.ts:287-288`), and so does every PR on Bitbucket (`ownership.ts:103-106`). Unblock would hold no loose branch, the release row would leave Blocks delivery before plan 1 removes it, and plan 1's Blocked slice state would differ per reader. Round 1's estate verdict recommended this rule. Recorded as an open point that reopens the earlier resolved one.

## Findings held by one or two jurors

- Closed PR under Unblock: Delete ignores `loose-delete`'s `held` refusal (contradiction); Release may always refuse for a branch that carried a PR, `plot-dispatch.sh:1799` (deliverable).
- `delivery-readings.ts:128` does not drop a closed PR; the fixer read at `fleet.ts:6626` keeps it out of Unblock (estate, contradiction, deliverable).
- Phase strip cites a non-existent `/api/stories`, and its names ignore `Workflow phases` (estate, cost).
- `planSliceCount` is absent for a Draft plan with no rows, and "slice 2 only renders" is false (estate, deliverable, cost).
- Done When 1 holds today; the repeating sentence is the reason line (estate).
- Done When lines split across slices, and slices 2 and 3 collide in `AgentList.tsx` (deliverable, cost).

## What the lenses had in common

All four took the cited line numbers from round 1 at face value and found most still correct, then each independently found the same Mine rule wrong. Agreement on the defect is strong evidence; none of the four checked the design's own claim that You means the reader, so whether the reader-only intent is right stays unasked.

## Disagreements

None on position. Nothing is approved, rejected or changed in phase.
