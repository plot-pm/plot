# Panel moderation: discovery-tab-disables-create-plan-story, round 1

**Reconciliation:** unanimous `amend` (layering, operator, server, testability). Every verdict passed `plot-panel.mjs check` on the first send.

## What each juror looked at

| Juror | Ran |
|---|---|
| layering | `create-plan-button.test.ts` (7/7); a function-level probe of the `?? 'unsupported'` default, `IssueAnswerSchema` and `BoardSchema` |
| operator | `create-plan-button.test.ts` (7/7); a probe calling the real `refusalReason` and `discoveryGroups` with the values `App.tsx` passes when `fleet === null` (reproduces both sentences) |
| server | `create-plan-button.test.ts` (7/7); a vitest probe of `freshCacheEntry()` and `refusalReason` |
| testability | 32 existing tests (all pass); a probe whose target assertion fails today with the issue's sentence |

All four executed and reproduced the defect at function level.

## Where the jurors agree

1. **The source is `/api/board`, not a fleet poll on Discovery.** `/api/board` builds `tickets` from the same cache entry that holds `issueAnswer` (`discoveryLanes` → `ticketLaneData` → `ensureCache`, `fleet.ts:1682-1683`, `index.ts:487-513`), and `ensureCache` starts the issue read on any tab (`fleet.ts:2970-2974`). Add `issueAnswer` and `issueAbsence` beside `tickets`, `.optional()`, never defaulting to `'unsupported'`. Rows and their answer then arrive together; a 4 s fleet poll would cost 7.5 full payloads per 30 s for two fields.
2. **`App.tsx:1328` (`issueAbsence`) has the same defect.** A fresh Discovery page reads "Tickets have not been read yet." where the board knows a standing reason (operator's probe). It belongs in this slice.
3. **No per-row loading state is needed.** The tab already shows `Loading…` until the first board payload (`App.tsx:1340-1343`).
4. **The refusal moves into one domain rule** taking the binding, the answer and the kind, replacing `CreatePlanButton.tsx:83` and `CreateStoryButton.tsx:93`.
5. **The browser tests hid the bug.** Four Discovery browser tests stub `/api/fleet`, which Discovery never fetches, and count buttons without checking `aria-disabled`. One assertion in `discovery-ticket-card` closes it: route `/api/fleet` to the opposite answer and assert the button is enabled.
6. **The plan's Motivation misreads `board.idea`/`board.story`:** they report only the localhost binding (`schema.ts:1316-1324`), not the issue read.

## Where they differ

- **The cold server cache** starts at `issueAnswer: 'unsupported'` (`fleet.ts:2889`), so the first answer after a board start is false on any tab. server: fix it here with a "not read yet" value. testability and operator: no fourth `IssueAnswer` member — it is declared twice and compared in six `AgentList` places and persisted in the index; type the board field `IssueAnswer | null`. layering: a follow-up.
- **Planning-tab fallbacks** (operator): `App.tsx:1485,1498` freeze the plan age after a Delivery visit; `App.tsx:1558`'s sprint-modal fallback depends on whether Delivery was opened. A separate bug.
- layering adds: an unreadable plans directory shows "the issue lookup is failing" (`fleet.ts:2085-2090`).

## Shared blind spot

None measured an older board server serving a newer page (or the reverse) during an upgrade, where the new optional field is absent.

## Amendments the panel asks for

- Source the answer and absence from `/api/board`; drop the fleet-poll option and the per-row loading state.
- One domain refusal rule for plan and story.
- Fix `issueAbsence` in this slice; decide the cold-cache value.
- One browser assertion that proves the board is the source; correct the Motivation.
