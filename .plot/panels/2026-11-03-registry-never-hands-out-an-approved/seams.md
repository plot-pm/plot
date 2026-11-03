# Juror verdict — seams lens

Plan: `docs/plans/2026-11-03-registry-never-hands-out-an-approved.md` (PR #3095, issue #3092). Read against `origin/main` at `791be809d`.

Position: amend

## Summary

Slice 1 fixes the named defect and its claims about the code are true. Slice 2 aims at a symptom whose cause the code already answers, and its Changelog line promises a behaviour the restart controller is not built to give. Two of the three open questions can be settled now from the code, and the third is settled by the shape of `QueuedBranch`. The plan names no changeset, puts a third `sliceVerdicts` caller in the wrong slice, and carries a `<!-- spike -->` annotation on its own first slice that is a trap if the plan ever enters Design.

## Findings

### F1. The "shell twin" no longer exists; the scan is the domain walk

- `skills/plot/scripts/plot-fleet-scan.sh:252-276` is a launcher. It `exec`s `board/plot-scan-walk.mjs`, which calls `assemblePlanWalk` (`packages/board/src/server/entry/scan-walk.ts:141,339`). No spike rule lives in shell: `git grep -i spike -- 'skills/plot/scripts/*.sh'` finds only the parser (`plot-plan-meta.sh:285-290,724,1018,1283`), which emits `spike` and `spike_approved_raw` and decides nothing.
- No corpus test pairs a spike rule with shell, and none is needed: the disagreement is TS-versus-TS (`planQueue` against `assemblePlanWalk`). The plan's "corpus-style test" is therefore a unit test in `packages/domain/test/`, not a corpus-tier file under `packages/domain/corpus/` (that tier is rule-versus-shell over the real estate, `CLAUDE.md` "A Shell Script Asks The Domain"). The plan must say "unit test" so an agent does not build a corpus file with `compare.ts`/`production.ts` plumbing.
- `plot-verdicts.mjs` (`packages/board/src/server/entry/verdicts.ts:86-117`) already accepts the spike columns and has no shell caller on `origin/main`. Not a gap.

### F2. Code claims check out

- `eligible.ts:132` spike admission and `eligible.ts:157` `sliceVerdicts`: true.
- `plan-walk-assembly.ts:330-340`: the readings are built at 320-336, `spikeApproved` at 334, `spikeSliceOf` and the `sliceVerdicts` call at 337-340. True.
- `queue.ts:928-936`: `sliceVerdicts` at 928 with `outstanding`, `phase` (932), `branches` (935) only. True.
- `restart-command.ts:117-118`: the `unknown-branch` refusal. True.
- Board impact note: the board's rows come from the scan pulse (`assemblePlanWalk`), and `verdicts.ts` already passes the spike fields. "None expected" holds. The registry's held count drops by one per approved spike; nothing renders that as a domain decision.

### F3. A third queue-path caller omits the spike fields, and it belongs in slice 1

- `packages/domain/src/rules/known-pr.ts:192-205` `blockingBranches(phase, slices, settled)` calls `sliceVerdicts` with `{ outstanding, phase, branches }` only. Its one caller is the queue path itself, `packages/fleet/src/shared/queue-reading.ts:622` (`landedWithoutListing`).
- Effect after slice 1 alone: for a Design plan with an approved spike, `blockingBranches` still answers `[]`, so the per-branch landing question is never asked for the spike. The queue then learns of the spike's merge only from the merged listing. The queue and the walk disagree again on exactly the branch this plan fixes, in a degraded-listing pass.
- The signature takes `phase` and not the plan record, so the shared readings builder cannot reach it without a signature change. That is a queue change, not a restart change. Open question 2 is therefore answered: yes, `known-pr.ts` omits the fields, and the fix goes into slice 1.

### F4. Open question 1 is settled by the code: no phase filter drops Design plans

- `assemblePlanWalk` skips only `LEFT_PHASES = released, rejected, superseded` (`plan-walk-assembly.ts:19,302`) and delivered docs/infra plans (`:303`). A Design plan is walked; the issue's own scan output (`claimable=1`) proves the walk listed the spike.
- `branchFromPulse` (`packages/fleet/src/shared/continue-command.ts:28-45`) has no phase test.
- `restartBranch` answers `unknown-branch` whenever `branchFromPulse` returns `null`, and that includes a `null` pulse. `bridgedPulse` (`packages/fleet/src/server/entry/restart-command.ts:49-52`) returns `null` for an absent bridge, a foreign version, or one older than `BRIDGE_MAX_AGE_MS = 15 min` (`packages/domain/src/adapters/fleet-state/fleet-state-file.ts:17,72-79`). The likeliest cause of the issue's second symptom is a stale or absent bridge reported with the wrong detail ("no plan on this board names that branch").

### F5. Slice 2's promise cannot be met by the restart controller

- `plot-dispatch.sh:4005-4037` hands over without a worktree, a claim or a worker ("THE HAND-OVER IS A REPORT AND NOT A WRITE"). A spike handed to the registry therefore has no desk.
- `restartBranch` refuses `no-worktree` when the pulse lists no worktree (`restart-command.ts:120-123`), and `restartWorker` exists for "a claimed slice whose worker is dead" (`CLAUDE.md` controllers section). A never-started spike is neither claimed nor has a dead worker.
- So even with a perfect lookup, `plot-restart-command.mjs <spike>` moves from `unknown-branch` to `no-worktree`. The Changelog line "restarts the worker of an approved spike of a Design plan instead of answering `unknown-branch`" is false for the issue's scenario. After slice 1 the registry hands the spike out, and restart has no role in starting it.

### F6. Open question 3 is settled by the queue's types

- `QueuedBranch` carries `claimable: boolean` and no verdict word (`queue.ts:965-976`). The hold word comes from `queue.ts:600`: `not-claimable` or `prior-unknown`, and `registryd-main.ts:3246` files `not-claimable` under `estate`.
- The queue cannot "report `unapproved`" without a new field. The agreement test must assert `claimable === (walkVerdict === 'eligible')` per branch, not word equality. Adding a verdict word to the queue is a scope change the plan does not ask for.

### F7. The agreement test needs fixtures where the two `outstanding` rules agree

- The walk counts `outstanding` from `branchState` with loose-readiness exceptions (`plan-walk-assembly.ts:321-329`); the queue counts merged-only via `settled` (`queue.ts:930`). They differ on purpose (plan Design bullet 2 says so).
- A test asserting equal verdicts "across phases" must use branches that are all open or all merged, or it fails on a designed difference rather than on drift. The plan must state that constraint, or name the comparison as "same `spike`/`spikeApproved`/`phase`/`branches` readings", which is the shared part.

### F8. Slice order and the spike annotation on this plan

- `### Restart lookup` is a second heading, so `sliceVerdicts` makes it wait for `### Queue verdicts` to land. That order is right if slice 2 survives.
- Slice 1's line carries `<!-- spike -->`. In Draft and Approved the annotation is inert (`awaitsSpike` and `spikeCardState` read only `design`, `spike-confirm.ts:35-55`). If this plan is ever sent to Design (`needs-design`), its spike is the one kind of branch the registry cannot hand out until this plan lands — a deadlock on the very defect. Nothing in the plan says why the bug fix is a spike.

### F9. No changeset is named

- PR #3095 carries the plan and the active symlink only. The fix ships in `plot-fleetd.mjs` and the domain, so it needs a `'plot': patch` changeset, description first, `plan:` line in the comment block (`CLAUDE.md` Versioning). The issue's reporter runs fleetd from the marketplace checkout at `820a708`, so the fix reaches them only through a release.

### F10. Downstream of the queue, nothing else refuses a Design plan

- `registryd.ts` and `registryd-main.ts` read no phase; `plot-worker-loop.sh` reads no approval or spike field. After slice 1 the hand-out path is open end to end. A reader verifies the fix with the issue's own reproduction: a fleetd tick prints `handed=1` and one agent manifest names the spike branch.

## Amendments required

1. Slice 1: also change `blockingBranches` (`known-pr.ts:192`) to take the shared readings (or the plan record) so the queue's landing walk admits an approved spike; extend the slice 1 test to cover it.
2. Remove the `known-pr.ts` item from slice 2 and from open question 2; close open question 2 with F3's answer.
3. Close open question 1 with F4's answer: no phase filter exists; the `unknown-branch` refusal comes from a `null` bridged pulse.
4. Close open question 3 with F6's answer, and rewrite the agreement test as a unit test in `packages/domain/test/` that compares `claimable` against `verdict === 'eligible'` over fixtures whose branches are all open or all merged (F1, F7).
5. Slice 2: drop it, or retitle it to "restart names a missing or stale pulse" — a distinct refusal (for example `no-pulse`) where `bridgedPulse` returns `null`, instead of `unknown-branch` with a detail that blames the plan. Delete or rewrite the second Changelog line to match; restart must not claim to start a never-started spike.
6. Remove `<!-- spike -->` from slice 1's branch line, or state why the fix is a spike.
7. Name the changeset: `'plot': patch`, description first, `plan: docs/plans/2026-11-03-registry-never-hands-out-an-approved.md` in the comment block, in slice 1's branch.

## Decisions for a person

- Whether slice 2 survives as a refusal-wording fix (amendment 5) or is dropped. Either is safe for an agent once chosen; choosing is scope, so it belongs to the plan's approver.

## What I ran versus read

- Ran: `git show origin/main:<file>` and `git grep` over `packages/` and `skills/plot/scripts/` for every file named above; `gh issue view 3092`; `gh pr view 3095 --json files`; `git log origin/main..HEAD` in the idea worktree.
- Read only: the plan, the issue, `CLAUDE.md`. I ran no test suite, no fleet or board command and no host write, so the claim that the restart symptom came from a stale bridge (F4) is inferred from the code paths, not reproduced.
