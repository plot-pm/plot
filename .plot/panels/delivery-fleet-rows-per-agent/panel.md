# Panel moderation: delivery-fleet-rows-per-agent

Subject: `docs/plans/active/delivery-fleet-rows-per-agent.md` at `a154ced7a`.
Siblings: 7 read, 0 unread (no sprint is active; every unfinished plan in `docs/plans/active/`).
Reconciliation: unanimous `amend` (estate, contradiction, deliverable, cost). All four gated and committed.

## What each juror looked at

All four read the plan, the sibling delivery plans, the design spec and the code at HEAD (`delivery-row-form.ts`, `delivery-placement.ts`, `delivery-readings.ts`, `AgentList.tsx`, `FleetControls.tsx`, `schema.ts`, `slice-tokens.ts`, `slice-spend.ts`, `fleet.ts`, the auto-design, auto-verify and auto-review bounds). None ran code or the board. Every finding is a reading, not an execution.

## Agreements (all four jurors)

1. **The agent-rows slice needs readings the payload does not carry, and the plan says it needs none.** Every Fleet agent reads `loop` (`delivery-readings.ts:302`); `AgentRole` holds six roles and the plan names eight (`delivery-placement.ts:92`); reviewer, fixer, design and verify runs are not registry entries. A running agent has no output-token reading, because the spend record is written at seal or at a finished run. "Doing now" has no commit count or commit subject on the payload. The claim "readings the board and fleetd already take" holds for none of these.
2. **Both Open Questions have answers in code.** Per-day output tokens: no live reading; a finished-runs-today figure derives from `.plot/state/slice-spend.jsonl` (`at`, `outputTokens`) and reads low. Bounds: design and verify use `Worker bound` (28800 s), reviewer and fixer 3600 s each, idea and brief have none (`brief-ask.ts:105-107`). The plan omits the reviewer bound.
3. **The role chip has two owners.** This plan and plan 3 (`delivery-work-items-show-gates`) both build it in `delivery-row-form.ts`, with no `waits:` between them.
4. **The header-switches slice moves components and builds none.** `AgentList.tsx:1403-1418` already renders the four switches and the stepper under the Fleet heading, and they already write through `/api/fleet-controls`. The `#fleet-controls` anchor that the group-held links scroll to must survive the move.
5. **"Rebuild the board artifact with each slice" contradicts `check-no-bundle-diff.sh`.** A rebuild is a local test, never part of the commit.

## Disagreements and distinctions

- **No juror held `reject`.** The divide is emphasis, not position. Estate weighs what exists, contradiction weighs settled decisions, deliverable weighs Done When coverage, cost weighs per-refresh reads.
- **Done When item 4 says the switches "write their config keys".** Contradiction alone found that the estate keeps them in `.plot/state/` (`fleet-settings-store.ts`) and never in `CLAUDE.md`. Deliverable found the item already met today.
- **Time left costs a read.** Cost alone found that `Worker bound` is read only when an ended free wait exists (`fleet.ts:8612-8619`, 0.12 to 0.94 s per read, polled every 4 s per viewer), so a bar on every loop agent makes it unconditional.
- **Slice independence.** Deliverable alone found that the header's "output tokens today" aggregates slice 1's per-agent token fact while slice 2 waits only on plan 1.
- **Done When item 1.** Contradiction and deliverable found that `agentGroup` gives an unread agent no group and sends it to `unplaced`, so "every agent" must read "every placed agent" unless the placement rule changes, which the design's Non-goals forbid.
- **Unowned Changelog bullet.** Deliverable and estate found that removing "no manifest names this desk" has no slice and no Done When item; the text comes from `desk-manifest.ts:261` and a browser test asserts it.

## Shared blind spot

All four jurors read code and plans and none ran the board. The items they name as unchecked stand: whether `commits`, `headSha` and `subject` reach agent rows, the idea-run and approver bounds, and which browser tests select the current Fleet columns.

## Nothing acted on

The panel reports. No phase moved, nothing was approved or rejected.
