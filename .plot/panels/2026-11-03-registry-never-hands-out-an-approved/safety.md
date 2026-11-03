# Safety juror — registry-never-hands-out-an-approved

Position: amend

Lens: what the fix could release wrongly. All code references are to `origin/main` at `791be809d`.

## Summary

The rule that decides admission is already safe. `sliceVerdict` (`packages/domain/src/rules/eligible.ts:139-141`) admits a spike only where phase is `design` (`SPIKE_PHASE`, `eligible.ts:63`), the slice names exactly one branch, `spike === true` and `spikeApproved === true`. Absent flags read as unread and keep `unapproved`. The plan's fix only passes those two fields from `planQueue`, so it cannot widen admission by itself. The risk sits in three places: how the shared builder computes `spike`, what the restart slice widens, and this plan's own `<!-- spike -->` marker, which is wrong and costs a person an intervention.

## Findings

### F1. The cases the lens names stay closed, provided the builder uses `spikeSliceOf` (rubric 1, 4)

- Non-spike branches of a Design plan: every other slice gets `spike: false` and reads `unapproved` (`eligible.ts:141`). After the spike merges, its slice reads `complete` (`eligible.ts:117`), and the next slice still reads `unapproved` because the phase is still `design`. The fold does not open slice 2 of a Design plan. Safe.
- An unapproved spike: `spikeApproved` is `spikeApprovedRaw !== ''` (`plan-walk-assembly.ts:334`). `plot-plan-meta.sh:1283` strips placeholders, and the template carries no `Spike approved:` line. Only `approveSpike` writes the record, under the state gate's receipt key `<plan path>#Spike approved`. Safe.
- A spike of a Draft plan: phase `draft` is not `SPIKE_PHASE`. Safe.
- Two `<!-- spike -->` markers: `spikeOf` answers `undefined` for more than one (`rules/spike.ts`, `found.length === 1`), so `spikeSliceOf` answers `undefined` and no slice gets `spike: true`. Safe **only if the builder derives `spike` from `spikeSliceOf` over the whole plan**. A builder that sets `spike` to "this slice holds a marked branch" admits both slices of a plan with two markers in two slices, each with one branch. The plan names `spikeSliceOf` as an input (`plan:44`) but no test pins the two-marker case on the queue side.
- A spike in a slice that is not the first: `approveSpike` refuses `spike-not-first` (`transitions/plan.ts:553-559`), and in the queue the slice reads `blocked` because no earlier slice is `complete`. Safe.

### F2. `Spike approved:` does not name the branch it licenses, and this fix makes that an unattended start (rubric 4)

`approveSpike` writes the record as `${on}, ${who}, ${channel}` (`transitions/plan.ts:600`). The decision carries `branch` (`plan.ts:493`), but the plan file does not. `sliceVerdict` reads only "a record exists" and "this slice holds the one marker". So an edit during Design that moves `<!-- spike -->` to another branch, or renames the spike branch, after the approval transfers the approval to that branch. Today this reaches only the scan's `eligible` word, and the registry holds the branch. After this fix fleetd hands the moved branch to a free agent with no person in the loop. The state gate covers the `Spike approved:` line and not the marker. Design plans are edited during Design by people, by `Design command` agents and by `/plot-reslice`. This is pre-existing in the rule, but the plan turns it from a wrong word into a started agent.

### F3. The restart slice can widen a shared reading (rubric 3, 4)

`restartBranch` (`packages/fleet/src/shared/restart-command.ts:114-119`) finds the branch through `branchFromPulse` (`continue-command.ts:28`), which walks every branch of every plan in the pulse and checks no verdict. `restartWorker` refuses `unattended`, a live loop, a PR in review and a `PLOT-BLOCKED` marker, and nothing about the slice's admission. Slice 2 says "fix it where one exists" for a phase filter in the pulse writer (`plan:48`, `plan:66`). If that slice widens the plan set the pulse carries, three consumers change at once: `plot-restart-command.mjs`, `plot-continue-command.mjs` and `plot-dispatch-command.mjs`, plus `planAutoDeliver` and the board. A restart would then also find a non-spike branch of a Design plan that has a worktree, and start a worker on it, because nothing on that path asks the verdict. A person is the only caller (unattended is refused), so the harm is bounded, but it is a lifecycle bypass that the controller does not refuse.

### F4. This plan's own `<!-- spike -->` marker is wrong and costs an intervention (rubric 1, 5)

The first slice line (`plan:62`) carries `<!-- spike -->`. The parser reads it (`plot-plan-meta.sh:1018`, the regex matches the second comment on the line).

- The plan is Draft with `Review: pr`, so it goes Draft to Approved and never enters Design. In phase `approved` the marker does not change any verdict, so it releases nothing wrongly.
- It does change delivery. `assemblePlanWalk` sets `tracer: planSpikes > 0` (`plan-walk-assembly.ts:391`), and `planRow` puts `tracer: true` on the pulse row (`plan-walk-assembly.ts:552`). `fleet-scan.ts:754` builds fleetd's pulse from this. `planAutoDeliver` (`rules/auto-deliver.ts:293`) skips a tracer plan until a dependent delivers, and "a tracer plan with no dependent is delivered by a person" (`auto-deliver.ts:281`). No plan waits on this one, so a person must deliver it. That is an intervention, against the sprint goal.
- If the plan is ever moved to Design, the marker makes it worse: `confirmRefusal` holds approval until slice 1 merges (`rules/spike-confirm.ts:110-119`), and until slice 1 lands the queue cannot hand out a spike at all. The spike would need the manual worktree start the issue names as its workaround.
- The slice is the whole fix, not a tracer that proves a design. The marker misnames it.

(Side note, outside this plan's scope: `AssembledPlan.tracer` derives from the spike marker, while `entities/fleet.ts:714` documents `tracer` as `Tracer: yes`. The two meanings disagree. A person should decide which one the pulse carries.)

### F5. `known-pr.ts:200` is conservative, not unsafe

`blockingBranches` calls `sliceVerdicts` without the spike fields. For a Design plan's spike slice the verdict reads `unapproved`, so the function asks no landing for it. That withholds a lookup; it releases nothing. If slice 2 adds the fields there, the same two-marker and moved-marker tests apply.

## Amendments required

1. Remove `<!-- spike -->` from the `bug/the-queue-hands-out-an-approved-spike` line. Keep the `builds:` annotation.
2. State in Approach that the shared builder sets `spike` as `spikeSliceOf(counts, planSpikes) === sliceIndex` over all slices of the plan, the way `plan-walk-assembly.ts:337-340` does, and never per slice.
3. Add negative queue tests to slice 1, each asserting zero claimable items from `planQueue`:
   - a Design plan with `Spike approved:` and two marked branches in two single-branch slices;
   - a Design plan with one marked branch and no `Spike approved:` record;
   - a Draft plan with one marked branch and a `Spike approved:` record;
   - a Design plan with `Spike approved:` whose spike slice also names a second (or deferred) branch;
   - a Design plan whose approved spike has merged: slice 2 reads `unapproved` and its branches are not claimable.
4. Restrict slice 2: it must not change which plans the pulse carries without a person's decision (see below). Whatever lookup it fixes, `restartBranch` must refuse a branch whose slice verdict is `unapproved`, with a named reason, and a test must show a non-spike branch of a Design plan with a worktree is refused.
5. Name F2 in Open Questions and take the decision below before slice 1 ships, or add to slice 1 a check that holds the spike when the marked branch differs from the one the approval licensed.

## Decisions for a person

- F2: should `Spike approved:` name the branch it licenses (for example `2026-11-03, jwloka, pr — feature/x`), so the queue admits only that branch? This changes the record format that `approveSpike`, the state gate receipt and `plot-approve.mjs --spike` write, and it decides how existing records without a branch read. That is not a call for an unattended agent.
- F3: if the restart failure is a pulse that omits Design plans, may the pulse start to carry Design plans? It changes fleetd's scan cost and five consumers.
- F4 side note: which meaning `tracer` carries on the pulse.

## What I ran versus read

Ran (read-only): `git fetch origin main`; `git show origin/main:<file>` and `git grep` over `eligible.ts`, `queue.ts`, `spike.ts`, `spike-confirm.ts`, `transitions/plan.ts`, `plan-walk-assembly.ts`, `auto-deliver.ts`, `entities/fleet.ts`, `known-pr.ts`, `verdicts.ts`, `queue-reading.ts`, `restart-command.ts`, `continue-command.ts`, `plot-plan-meta.sh`, `plot-fleet-scan.sh`, the plan template; `git log -S` for the `tracer: planSpikes` line (`45ae8a839`); `gh issue view 3092`.

Only read, not executed: every behaviour claim above comes from reading source. I ran no test, no bundle and no fleet or board command. The tracer-blocks-auto-delivery chain (F4) is traced through code, not observed on a live pulse.
