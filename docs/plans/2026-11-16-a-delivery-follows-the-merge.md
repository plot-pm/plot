# A delivery follows the merge

> `POST /api/deliver` asks the PR index and then the host before it refuses a plan whose pulse reads a slice unmerged, so a plan is deliverable as soon as the host reports its last slice merged, and a refusal names the branch the host reads open.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** bug-fixes-2-35-0
- **Issue:** #3472
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3475 merged
- **Started:** 2026-11-16, Jan Wloka, `bug/a-delivery-follows-the-merge`
- **Delivered:** 2026-11-16
- **Released:** 2026-11-19, v2.35.0

## Changelog

- The board's Deliver action accepts a plan as soon as the host reports its last slice merged, without a wait for the next PR read and pulse. A refusal names the branch that the host reads open, and a host that cannot answer refuses as `merge-unconfirmed`, never as "not merged".

<!-- Board impact: board server code and one domain rule. No change to the plan format, the plan template, the helper scripts or the docs/plans layout. -->

## Motivation

On 2026-11-16, PR #3467, the only slice of `a-deferred-slice-keeps-its-branch`, merged at 18:51:16Z. `POST /api/deliver` answered `not-deliverable` ("has a branch that is not merged") at least three times until about 18:56Z. In the same window `plot-ask.mjs deliverable` answered `deliverable: true, merged: 1, unmerged: []` (#3472).

The PR index `.plot/state/index/github.json` was last written at 18:46:04Z and held #3467 as OPEN until its next write at 18:54:06Z. After that write `.plot/state/last-pulse.json` read the branch `merged`. The route still refused until the board's own pulse (`/api/fleet`) read `merged` at 18:55:09Z. A delivery therefore waits for one PR index write and one later pulse after the merge: about 4 minutes in this case.

The defect is on `origin/main` at `5850be951`:

- `deliverability` (`packages/board/src/server/deliver.ts:364`) judges the merge from the board's in-memory pulse only. It picks the pulse with `deliveryPulse` (`deliver.ts:392`, rule at `packages/domain/src/rules/deliverable.ts:364`) and maps `deliveryLanding` (`deliverable.ts:133`) onto a verdict at `deliver.ts:418-427`. No path in the route asks the PR index or the host.
- A slice whose pulse verdict is not `complete` makes `slicesOf` answer `not-merged` (`deliverable.ts:236-240`). A pulse built from a stale OPEN row is such a pulse, so the route maps it to `not-merged` through the `default:` arm at `deliver.ts:425`.
- `handleDeliver` turns `not-merged` into `not-deliverable` with the sentence "has a branch that is not merged" (`deliver.ts:701-707`). The sentence names no branch, and it states as a fact what is only the pulse's reading. The comment above the `scan-incomplete` refusal (`deliver.ts:677-680`) states the rule this breaks: a reader told that a merged branch is not merged goes looking for work that does not exist.
- The controller that answers from the index and the host already exists. `deliverabilityOf` (`packages/board/src/server/controllers/deliverability.ts:262`) reads `MERGED` rows from the PR store first and asks `Host.prMerged` only for the other branches (`mergedBranches`, `deliverability.ts:163`). A host `unknown` refuses as `cannot-tell` (`deliverability.ts:330`). `plot-ask.mjs deliverable` (`packages/board/src/server/entry/ask.ts:127`) and `plot-deliver.mjs` (`packages/board/src/server/entry/deliver.ts:465`) call it. The board route does not.

The PR index lag itself is fleetd's PR beat, which stretches under rate pressure (`prRefreshMsFor`, `packages/fleet/src/shared/pr-refresh.ts:680`). That cadence protects the host budget and is not in scope here. The route needs a reading that follows the merge for one plan, on demand, when a person asks.

A user sees the defect as a Deliver call that refuses a finished plan for minutes and says its work is not merged. A master agent that reads the refusal literally looks for an open PR that does not exist.

## Design

### Approach

The fix lives in the board's deliver controller and one domain rule. The pulse stays the first reading, so a plan the pulse reads as landed costs no host call.

1. **Domain rule.** Add `confirmedLanding` to `packages/domain/src/rules/deliverable.ts` as an arrow function with a factual TSDoc block. It takes the pulse's `DeliveryLanding` and, where the caller asked, the host answer's `{ deliverable, reason, unmerged }`. It returns the route's verdict: `merged` where the pulse reads `merged` or the host answer is deliverable; `merge-unconfirmed` where the host answer refuses `cannot-tell`; `not-merged` with the host's `unmerged` branch names where the host answer refuses for an open branch; and the pulse's own answer where no host answer was read. Export it from `packages/domain/src/index.ts`.
2. **Controller.** In `deliverability` (`packages/board/src/server/deliver.ts:364`), where `deliveryLanding` answers `not-merged` or `merge-unconfirmed`, call `deliverabilityOf` with the estate's `planStore`, `host`, `refs` and `prIndex` and the plan file the route already resolved. Pass both readings to `confirmedLanding`. The estate comes from a new optional `DeliverDeps.ports`, defaulting to `realEstate` (`packages/board/src/server/estate.ts:81`), so a test passes fixture ports and no test spawns `plot-host.sh`. `scan-incomplete` and `already-delivered` keep their current paths, and `deliverabilityOnBranch` is unchanged.
3. **Refusal text.** Extend the `not-merged` verdict with the branch names, and make the `not-deliverable` detail at `deliver.ts:701-707` name them: "plan `<slug>` has a branch the host reads open: `<branch>`". The `merge-unconfirmed` detail stays as written at `deliver.ts:690-697`.

This follows *A Decision Reads The Index*: `deliverabilityOf` takes only terminal `MERGED` rows from the store and asks the host for every other branch, so the index never says "not merged". The host call runs once per Deliver request and only after the pulse refused, which the cost rule in *A Shell Script Asks The Domain* permits for a once-per-operator-command path. The route reaches the host only through the `Host` port, so the layering rule holds and the CI spawn ratchet does not move. The route can now accept a plan before its card shows the Deliver button; `/plot-deliver` re-asks the host for every slice before it writes anything, so an early accept cannot deliver unmerged work.

The change adds no shell/domain duplicate and no corpus row.

### Open Questions

- [x] **Which reading decides a refusal after the pulse refuses?**
  - A: Re-ask through `deliverabilityOf` (PR index first, then the host) where the pulse answers `not-merged` or `merge-unconfirmed`, and refuse only on the host's answer. One host call per branch the store does not settle, per request.
  - B: Keep the pulse as the only reading and change only the refusal: answer `merge-unconfirmed` or a new `pulse-stale` reason that names the pulse's age and the next PR read, so the refusal stops stating that a merged branch is not merged. No host call, and the wait stays about one PR beat plus one pulse.
  - C: A, and also re-ask on `scan-incomplete`, so a board with no finished scan since its start can deliver.
  - **Recommendation: A.** `plot-ask.mjs deliverable` and `plot-deliver.mjs` already answer from this controller, so the route and the command a person runs next reach one answer. B removes the false sentence but keeps the minutes of refusal that #3472 reports. C widens the change to the cold-start path, where the phase read at the pulse's `read_ref` (`deliver.ts:404`) has no pulse to read from; keep it for a separate issue if it shows.
  - **Decided 2026-11-16, Jan Wloka: option A.**

## Done when

| Claim | Check | Slice |
|---|---|---|
| A pulse that reads the last slice open while the store holds its `MERGED` row answers `deliverable` with zero host calls | test *"a stale pulse delivers from the PR index's MERGED row"* in `packages/board/test/unit/delivery-follows-the-merge.test.ts` | Host confirmation |
| A pulse that reads the last slice open while the host reads it merged answers 202 and spawns the deliver run | test *"a stale pulse delivers once the host reads the branch merged"* in the same file | Host confirmation |
| A branch that the host also reads open refuses `not-deliverable`, and the detail names that branch | test *"a branch the host reads open is named in the refusal"* in the same file | Host confirmation |
| A host that cannot answer refuses `merge-unconfirmed`, never `not-deliverable` | test *"a host that cannot answer refuses merge-unconfirmed"* in the same file | Host confirmation |
| A plan the pulse reads as merged asks the host nothing | test *"a landed pulse asks the host nothing"* in the same file | Host confirmation |
| `confirmedLanding` maps each pulse answer and host answer to one verdict | `pnpm --filter @plot-pm/domain exec vitest run test/deliverable.test.ts` with a new `describe('confirmedLanding')` | Host confirmation |
| The existing refusals stay as they are | `pnpm --filter @plot-pm/board exec vitest run test/unit/deliver-route.test.ts test/unit/delivery-reads-the-last-finished-scan.test.ts` | Host confirmation |

## Slices

### Host confirmation

- `bug/a-delivery-follows-the-merge` — `confirmedLanding` in `packages/domain/src/rules/deliverable.ts` and its export, `deliverability` and the `not-deliverable` detail in `packages/board/src/server/deliver.ts`, `DeliverDeps.ports`, tests in `packages/domain/test/deliverable.test.ts` and a new `packages/board/test/unit/delivery-follows-the-merge.test.ts`, and a `plot` patch changeset whose `bumps:` block names `plot-deliver: patch` <!-- builds: confirmedLanding, the deliver route's host confirmation --> → #3477

## Notes

- `plot-deliverable-search.sh "deliveryHostConfirmation"` and `"POST /api/deliver re-asks the host before a not-merged refusal"` found no existing deliverable. The hits were on the common words `POST`, `api`, `deliver` and `delivery`, and none names a host re-ask in the deliver route.
- `docs/plans/2026-10-07-delivery-reads-one-source.md` (Released, v2.24.1) built `mergedBranches` over the PR store in `deliverabilityOf`. This plan reuses that controller from the board route and does not replace it.
- `docs/plans/2026-10-01-delivery-reads-the-last-finished-scan.md` built `deliveryPulse`, which picks the last finished pulse. This plan keeps that rule as the first reading.
- Commit `49a2df573` ("plot-scan: the PR index confirms a merge over a stale OPEN listing row") lets the scan take a `MERGED` index row over a stale listing row. In #3472 the index row itself was OPEN until 18:54:06Z, so that fix did not apply.
