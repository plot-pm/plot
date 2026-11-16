# Panel moderation, round 2: delivery-fleet-rows-per-agent

Engine: panel, unattended. Lenses: estate, contradiction, deliverable, cost. Verdict files: `r2-<lens>.md`. Siblings read: the five other Delivery plans (the other two unfinished plans were not read by every juror). Reconcile: `unanimous amend`.

## Agreement

All four jurors checked the plan's cited lines against the code and found them true, with the drift listed below. All four hold `amend`: the plan's gap claims stand, and the open findings are fixes to wording, ownership and size, not a fatal problem. No juror ran a suite, the board or a measurement; every position rests on reading and grep.

## Findings by theme

1. **Done When item 2 cannot hold as written** (contradiction, deliverable). It says each of the eight roles shows its chip, and the Approach says a role with no local reading shows no row. Restate it as "each role with a local reading shows its chip; each role without one is named in Notes".
2. **Slices 1 and 2 are larger than one PR** (deliverable). Slice 1 holds six readings, a block move and a component; slice 2 holds groups, columns, three new readings, the token fold, the bound cache, Free collapse and a test change. Split, or let the builder stop at the readings that exist.
3. **Header counts have no slice and no Done When line** (contradiction, deliverable). The plan says the counts are plan 1's summary filled with the Fleet groups, and no slice does the fill.
4. **The domain cannot import the reviewer bound** (contradiction, estate). `REVIEW_BOUND_MS` lives in `packages/fleet/src/shared/auto-review.ts`, and the time-left fraction is a domain property. The plan does not say whether the bound is an input to the rule or moves into the domain.
5. **An agent-row form already exists** (estate). `agentRowCells` (`delivery-row-form.ts:312`) returns a seven-cell row today with `kind` as the role cell, and `DeliveryGate` already holds `ci` and `rate-limit`. The plan names neither. `AgentEntry` already carries `startedAt` (`schema.ts:4000`) and `lastActivity` (`:4057`), and `ciOf` (`delivery-readings.ts:99-110`) already folds `ciChecks`.
6. **The new reads have no cost bound** (cost). The spend read parses the record on every call (`board.ts:2887-2900`), the config-change signal for the `Worker bound` cache is unnamed, and the plan does not say which readings are already in the payload. The transcript fold the open question refuses is not stated as a Done When line.
7. **Cross-plan order is undeclared** (contradiction, deliverable). `feature/delivery-agent-roles` and plan 6's `feature/delivery-tickets-section` edit the "Tickets and plan runs" block with no `waits:` between them.
8. **Changelog overstates** (contradiction, deliverable). Time left shows "—" for design and verify, and Tokens shows the last finished run; the Changelog says neither. The Waits on list omits the design's "review" gate without naming the gap.
9. **Citation drift** (estate, cost). `slice-spend.ts:57-60` names no package and the 7.7 MiB figure sits at `packages/board/src/server/entry/slice-spend.ts:23` (the cost juror found it at `packages/domain/src/workflows/slice-spend.ts:58`; the two paths are unverified here); `board.ts:459` is `:460`; `delivery-readings.ts:303` is `:304`; `brief-ask.ts` and `auto-review.ts` name no package. The contradiction juror found every cite true, so the line numbers drift by one or two and the path is the real defect.
10. **Rejected finding** (contradiction): the juror called `Rounds: 1` stale because git history shows round-2 commits. Those commits (`da3ec63c3`, `02953de61`, `05d79e884`) belong to three sibling plans; this plan had one round before this one. This round records 2.

## Disagreement

The estate and cost jurors cite the 7.7 MiB figure at different files, and the contradiction juror reports every cite true while estate and cost report the same cite wrong. The builder resolves the path; this moderation does not.

## Shared blind spot

All four lenses read the plan against the code and the design and none questioned the design's premise that one row per agent needs eight roles. The readings for four roles (reviewer, approver, idea, brief) are named only as "local state their runners write"; no juror located a file for any of them, so the plan's central claim that a local reading exists for each is unverified.

Nothing is approved, rejected or moved by this panel.
