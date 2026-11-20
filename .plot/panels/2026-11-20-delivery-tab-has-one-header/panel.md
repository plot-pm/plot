# Panel — delivery-tab-has-one-header

Round 1, 2026-11-20. Lenses: estate, testability, user. Reconciliation: **unanimous `amend`** (estate, testability, user). No juror rejects.

## What all three found

1. **The header follows Mine today, and the plan does not stop it.** `TodoList` and the header counts are built from the Mine-filtered placement (`AgentList.tsx:639,1170-1195`; `delivery-readings.ts:461`); only `releaseCards` reads mode `all`. Amend: name a mode-`all` reading for the header and a unit test that toggling Mine (off / mine / strict) leaves it unchanged.
2. **The Release bar has five states, not four.** `SLICE_STATES` (`slice-states.ts:9`) includes `being-built`; the plan and the spec name four. Amend: five segments.
3. **"last vX.Y.Z <date>" has no source.** The `none` card has no version or date (`release-card.ts:185-198`) and the payload has no last-release field. Amend: name a source the server already reads (e.g. the newest release tag) as a new payload field, or drop the text.

## Where they differ in weight

- **Missing and stopped states** (user lens): the triage count, the release reading (`RELEASE_READING_MISSING`), and machine fields can be null; a stopped fleet reads as `idle` with zeros. The other lenses did not test the header's empty states. Amend: each group names its unread and stopped form.
- **Dead "open ›" links** (user lens, confirmed by the folds panel): `scrollToAnchor` (`DeliveryRows.tsx:20-22`) does nothing for an anchor in a folded section. Amend: every jump opens its target section first, as `jumpToReleasePlan` does (`AgentList.tsx:525-535`), and the plan waits on plan 2.
- **Status line decided in a component** (testability): the "ready · waits N min" vs disabled-reason choice is computed in `ReleaseApprove.tsx:16-24` from a passkey `useEffect`, and no reading carries a "ready since" time (`release-approvable.ts:13-20`). Amend: one domain function of group, PR reading, passkey answer and now; name the wait-time source.
- **Slice size** (testability): one slice is too large to verify. Amend: split into frame + You/Work/Fleet/Machine, and the Release group; list the changing tests (`delivery-tab-header`, `release-approve:82`, `delivery-fleet-look:100`, `fleet-settings:330`, `delivery-filters`, screenshots, unit `fleet-card.test.ts`) against `EXPECTED_FILES=99`, `EXPECTED_TESTS=719`.

## Undecided by the spec

My-sprint scope: a reader who owns several sprints gets all of them (`delivery-scope.ts:56-61`) but the scope line names one; "counts only my sprint" has no meaning for Fleet and Machine; which PR the action slot holds under my-sprint; several ready release PRs. These need the operator, not the builder.

## What the jurors looked at

All three opened code; none ran the board. The shared blind spot: the spec's "no new data sources" rule was checked against two fields only by the estate lens; the plan should list every field the header reads and its source.
