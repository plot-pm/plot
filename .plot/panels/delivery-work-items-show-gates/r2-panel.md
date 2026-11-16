# Panel moderation, round 2: delivery-work-items-show-gates

Subject: `docs/plans/active/delivery-work-items-show-gates.md` at `02953de61`.
Siblings: 6 read, 0 unread (no sprint is active; the other `delivery-*` plans in `docs/plans/active/`).
Reconciliation: unanimous `amend` (estate, contradiction, deliverable, cost). All four gated and committed.

## What each juror looked at

All four read the plan, the siblings and the code at HEAD, and verified citations by grep and read. None ran the board or a test. The moderator re-read `schema.ts:292-312`, `:2489` and `:3329` to confirm the two findings that decide this round.

## Agreements (all four jurors)

1. **Round 1 held on structure.** Every sibling branch name and `waits:` marker exists, the waits graph has no cycle, and plan 5 waits on this plan's gates slice.
2. **Two round-1 resolutions contradict the code.** The plan says the gates slice fills `prUrl` from the PR number and the repository URL. `schema.ts:292-303` forbids that arithmetic, and the payload already carries `CardPr.url` and `checksUrl`. The plan says the commit count comes from `local_ahead`. `localAhead` counts unpushed commits only (`schema.ts:2489`), so a pushed branch reads 0.
3. **Citation drift.** `delivery-row-form.ts:221` is not the null-cell rule (`:215-216`). `isUnbegun` is in `packages/board/src/app/lib/agent-rows/row-identity.ts`, not the domain. `prUrl: () => null` is at `AgentList.tsx:1097`.

## Disagreements and distinctions

- **No juror held `reject`.** The divide is one of emphasis. Estate weighs the wrong mechanisms, contradiction weighs the Done When link claim, deliverable weighs the column model and slice size, cost weighs payload growth and shared-file churn.
- **`review –` and "each linked".** Contradiction found that `gateLinks` emits no review link for `none`, so Done When's "each linked" fails for the `–` mark. No other juror raised it.
- **Column model.** Deliverable and contradiction found `ROW_COLUMNS` fixes a `status` column, and the plan does not say whether the group column replaces it. Plan 4 keeps `ROW_COLUMNS` for item rows.
- **Fixer attempt.** Cost found the payload carries `fixerInFlight` only; the attempt count needs a server read and a new field. Estate and contradiction did not examine it.
- **Slice size.** Deliverable and cost both found the gates slice carries six deliverables on the critical path of plans 1 and 5.

## Shared blind spot

No juror ran the board or the existing unit and browser tests, so the count of tests that select `CI ✓` text is still unmeasured. No juror traced whether `blockedBy` derives from the `<!-- waits: -->` marker.

## Nothing acted on

The panel reports. No phase moved, nothing was approved or rejected.
