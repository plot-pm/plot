# panel — delivery-sections-count-alike

Reconciled: unanimous amend (estate, testability, user). Round 1, 2026-11-22.

## What each juror looked at

- **estate** read `origin/main` with `git show` and `git grep`, and ran no tests.
- **testability** read the same files and the existing tests at `release-plan-rows.test.ts`, `delivery-view.test.ts` and `sprint-delivery-view.test.ts`, and ran no tests.
- **user** read the code, the sprint's design spec and mockups, and the live `/api/fleet` payload. It is the only juror that measured the running board.

## Agreements

- Slice 1 holds, but `HeaderStrip` and the three `delivery-view.ts` callers change with it. The section header's bar already holds all five states.
- A `sliceHold` rule already exists (`verdict.ts:106`), so the new rule needs another name.
- `heldNote: null` was the wrong evidence: it is the held-view note, not a slice hold.
- No new hold state file. The two holds in the Motivation are already on the `/api/fleet` rows (`brief`, `startability`, `blockedBy`), and a per-tick hold file is a second persisted verdict.
- `planForBranch` runs only on the server, so slice 3 cannot call it where the Fleet row is built.
- Show zero counts, and give the `unknown` reading its own bug plan.

## Disagreements

- **Why a working row shows no "acts on" line.** estate and testability name `linked` (`delivery-placement.ts:454`): the agent's item is absent from the readings. user names the cause one step earlier: 28 of 29 live agents are synthesized desks with `branch: ""`, so they act on nothing. user measured the live payload and the others did not; the amended plan takes user's cause and reads `branch`, then `checkout`.
- **Where the hold reasons show.** testability proposes held sub-parts with reasons in the header. user cites the spec ("header and folded summaries are visual, not sentences") and the mockup, which puts "not started · waits on …" on the slice line. The amended plan follows the spec: the header counts held slices, and the slice line names the reason.
- **The blocked row's branch.** testability traces it to `RoleRunSchema`, which has no `branch`; user traces it to the empty `branch` of a desk. Both causes are real for different rows, and the amended slice 3 covers both.

## Shared blind spot

All three read the plan's two named contradictions and none asked whether the operator needs a sprint count in Fleet. user raised it last; the amended plan decides it (no, per the spec's "Fleet takes no scope") and records the per-row sprint mark as the answer.
