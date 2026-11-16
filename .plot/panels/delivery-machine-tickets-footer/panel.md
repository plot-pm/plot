# Panel: delivery-machine-tickets-footer

Run unattended, 2026-11-16. Subject: `docs/plans/2026-11-16-delivery-machine-tickets-footer.md`. Siblings: 8 read, 0 unread (no sprint active; the 8 unfinished plans in `docs/plans/active/`).

Reconciliation (`plot-panel.mjs reconcile`): `unanimous amend` — estate, contradiction, deliverable, cost. All four verdict files passed the gate (exit 0). Nothing is approved, rejected or moved.

## What the jurors looked at

All four read the plan, the design spec, the sibling plans and the code (`packages/board/src`, `packages/domain/src`) with grep and file reads. None ran the board or a test. Every finding below is a reading of source at HEAD.

## Findings the panel shares

1. **The healthy line's readings are not on the board payload.** Estate, contradiction and cost each found no load, cores, remaining-quota or CI-queue field in `schema.ts`. Load and cores exist domain-side (`machine-system.ts:79-88`, `entities/machine.ts`), `LimitReading` exists as a connector answer (`entities/limit.ts:59-72`), and a CI queue count exists nowhere. The plan says these readings "already exist" and names no gap, which breaks its own rule. The Machine slice is a payload, schema and producer change, and "no host call is added" holds only if the CI-queue and GitHub-left figures are dropped or taken from data already on the machine. Open Questions lists only the next-read question.
2. **The dot's verdict is already decided in the domain.** `entities/machine.ts:39-50,121` makes load average "context only, never the verdict"; the verdict is `Headroom` (`clear`/`tight`/`starved`). "Left to the Builder" invites amber and red thresholds on load. Contradiction holds this as `blocks`.
3. **Both Open Questions are answerable at HEAD.** `prNextInSeconds`, `prAgeSeconds` and `prIntervalMs` exist (`schema.ts:4551-4590`, null means age only, no countdown). The `idea` controller exists (`packages/board/src/server/idea.ts`, `CreatePlanButton.tsx`, `AgentList.tsx:1535-1545`), and returns `unsupported` on Bitbucket. The part still open is the no-fleetd footer text and the ticket-as-source input.
4. **The Tickets section and the footer already exist in part.** `AgentList.tsx:1499-1506` renders "Tickets and plan runs", which also holds verify and spec runs that plan 4 (`delivery-fleet-rows-per-agent.md:92`) claims for Fleet. `AgentList.tsx:1577-1620` renders a footer line, and `view.notPlaced` (`delivery-view.ts:183,218-220`) already produces the desks-not-placed list. The plan says "adds" where it reworks and names no owner for the shared block.
5. **Cross-plan order is unstated.** Plan 2 removes ticket rows from You (`delivery-you-blocks-or-feeds.md:74`) and asks where the count links until plan 6 ships (lines 63, 93). Plan 6 waits only on plan 1, so shipping plan 2 first leaves 30 tickets visible nowhere.
6. **"Rebuild the board artifact with each slice" contradicts CLAUDE.md.** A PR carries no generated bundle (`check-no-bundle-diff.sh`); the rebuild is a local test. Plan 1 lists the same defect.
7. **The footer's "details" is not a named domain fact** (deliverable), and the existing "none" string has no stated test site. The 2026-11-10 `HostAnswer` vocabulary (`unasked`/`unreachable`) is not asserted for the one-line form (estate, contradiction).

## Disagreements

None on position. On severity: cost files the rebuild instruction as `blocks` and contradiction and deliverable as `misleads`; estate files the missing readings as `blocks` and cost as `misleads`. The panel agrees these are fixable in plan text.

## One juror only

- Contradiction: the story file linked in Motivation, `docs/stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md`, is absent at HEAD (plan 1 records the same gap).
- Deliverable: three slices touch the same files, so the pulse reads them as one wave; the plan does not say they are independent. The `GitHub` label hardcodes a host that is configurable.
- Cost: the unassigned count for the Tickets header already exists as `waiting.unassigned` (`waiting-view.ts:91`).

## Shared blind spot

All four jurors judged the plan against the code at HEAD and none judged it against what plan 1's slices will have changed by the time these slices start. Their shared source set was the same eight plans. None checked the design spec's *Non-goals* wording against the "Readings" bullet word for word, and none ran anything, so every "exists at HEAD" claim is unexecuted.
