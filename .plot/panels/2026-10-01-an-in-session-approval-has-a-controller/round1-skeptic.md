# Juror: skeptic who measures (round 1)

**I executed code.** I ran the origin/main `plot-approve.sh` and `plot-controller-gate.sh` from a detached worktree against a scratch repository. I also counted the unowned-receipt rows.

Position: amend

## 1. Does it fix the issue?

Partly. Reproduced: `plot-approve.sh --who jwloka x` on an in-session Draft exits 1 (*"the reviewer is a human in the room"*). The issue asks for the sprint annotation as well. The plan says "skips the plan-PR steps" but does not say that the sprint annotation step still runs.

## 2. Claims checked

- The counts are true: 237 rows, made up of 112 Released, 109 Approved, 11 Rejected and 5 Superseded.
- `plot-approve.sh:200-205` is true: `in-session)` at :200 and `ballot)` at :203.
- `transitions/plan.ts:257-262` is off by 4. The arm is at :253-259 (`case 'in-session': case 'ballot': return refuse(... 'review-human'`).
- `entry/transition.ts:44/139/151` is true, at `packages/board/src/server/entry/transition.ts`.
- **`workflows/approve.ts` is wrong in two ways.** Its `ApproveInput` (:65-70) holds `on` and `who` only. It has **no `channel`**, and the record derives its channel from the PR (`plan-PR #N merged`). Also, the in-session arm is followed by `switch (readings.pr.state)`, which returns `pr-absent` when no PR exists. "Applies the same rule" therefore still refuses an in-session plan, so the plan's new workflow test fails *after* the fix. No file in `packages/*/src` imports it, so the parity claim is with dead code.

## 3. Tests

The four named tests fail today. The `workflows-approve` case cannot pass as specified (see above).

## 4. What breaks or is left to guess

- **The controller gate refuses the skill route.** I measured `plot-controller-gate.sh` with the hook JSON: `plot-approve.sh --reviewer jwloka x` exits **2**. So `/plot-approve` step 3b cannot "call the script" from the repository root without a `/api/approve` receipt. The plan never mentions this gate.
- **`--release` gets through the gate by accident.** `plot-deliver.sh --release 2.22.3 x` exits **0**, because the gate's mode exemption list contains ` --release ` (meant for `plot-dispatch.sh --release`) and matches it for any gated script.
- **`--who` already exists** (`plot-approve.sh:3,115,293`) and names the approver. Adding `--reviewer` creates a second flag for the same field, and their precedence is left unspecified.
- The plan does not say how `reviewer` reaches the agent that `Approve command` spawns.
- "Refuses a plan that is not Delivered" contradicts the domain `release`, which accepts `released` as the idempotent repair.

## Required changes

1. Drop `--reviewer` and reuse `--who`, or state the precedence between the two flags.
2. For `workflows/approve.ts`, either add `channel` and skip the PR switch for in-session, or drop the workflow and the parity claim, since nothing imports it.
3. Name `plot-controller-gate.sh`. State whether step 3b goes through `POST /api/approve` or through `--unowned-action`. Make the `--release` exemption deliberate (scoped per script) and cover it with a gate test.
4. State that the sprint annotation step runs, and how the reviewer reaches the `Approve command` arm.
5. Correct the `plan.ts` line numbers and the `entry/transition.ts` path. Align the Delivered-only refusal with the domain's idempotent `released` case.
