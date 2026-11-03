# Layering juror — registry-never-hands-out-an-approved

Position: amend

Lens: where slice readings are built, whether one shared builder in `packages/domain/src/rules` is the right seam, and whether the restart lookup keeps its decisions in the domain. All references are to `origin/main` at `791be809d`.

## Findings

### F1. The plan's code claims are true

- `sliceVerdicts` is at `packages/domain/src/rules/eligible.ts:157`. The spike exception is at `eligible.ts:132-134`.
- `planQueue` builds readings at `packages/domain/src/rules/queue.ts:928-937` with `outstanding`, `phase` and `branches` only.
- `assemblePlanWalk` (`packages/domain/src/workflows/plan-walk-assembly.ts:229`) builds them at `:320-340`. It sets `spikeApproved` from `record.spikeApprovedRaw` at `:334` and `spike` through `spikeSliceOf` at `:337-340`.
- `restartBranch` refuses `unknown-branch` at `packages/fleet/src/shared/restart-command.ts:118`.
- The fleet scan is `assemblePlanWalk`: `plot-fleet-scan.sh:271` execs `board/plot-scan-walk.mjs`, built from `packages/board/src/server/entry/scan-walk.ts:339`. So the plan compares the right pair.

### F2. There are four hand-built reading sites, not two, and the plan names only three

`git grep sliceVerdicts` over `packages/*/src` gives four callers:

| caller | passes `spike` / `spikeApproved` | input shape |
|---|---|---|
| `workflows/plan-walk-assembly.ts:340` | yes | `PlanRecord` + per-branch states |
| `rules/queue.ts:928` (`planQueue`) | no | `PlanRecord` + `merged` set |
| `rules/known-pr.ts:200` (`blockingBranches`) | no | `phase` + `SliceLine[][]` |
| `board/src/server/entry/verdicts.ts:131` | yes, from TSV columns 4-6 | shell stdin protocol |

`blockingBranches` is called from `packages/fleet/src/shared/queue-reading.ts:622` with `plan.phase` and `plan.slices.map(s => s.branches)`. Its caller holds the whole `PlanRecord`, so it can use the same builder as `planQueue`. Today it answers `[]` for an approved spike, because the slice reads `unapproved`. The effect is small: `landedWithoutListing` never asks whether the spike landed by PR number, and nothing behind the spike in a Design plan is eligible. It is still the same divergence, and it is a queue-verdict caller, not a restart caller. The plan puts it in the restart slice (`Slices`, second bullet). It belongs in the first slice.

`verdicts.ts` reads a TSV wire protocol and holds no `PlanRecord`. A `PlanRecord` builder cannot serve it, and it already passes both fields. The plan's board-impact note is right about it.

### F3. The seam is right; the field optionality is the defect the seam leaves open

A pure builder in `packages/domain/src/rules/` is the right place. It reads values, spawns nothing, and `queue.ts:6` and `auto-deliver.ts` already import `PlanRecord` as a type from `ports/plan-store.ts`, so the import is not a new shape.

The root cause is not that two callers build readings by hand. It is that `SliceReadings.spike` and `SliceReadings.spikeApproved` are optional (`eligible.ts:41`, `:48`). `planQueue` and `blockingBranches` compiled without them, and nothing reported the omission. A shared builder fixes the two callers this plan touches. It does not stop a fifth caller from building readings by hand and omitting the fields again. That is a rule. Making the keys required (`spike: boolean | undefined`, `spikeApproved: boolean | undefined`) makes `tsc` the gate: every site that builds `SliceReadings` must state both, and "unread" stays expressible as an explicit `undefined`, which keeps `verdicts.ts:120-121`'s "absent means unread" contract.

### F4. The builder's inputs are under-specified

The plan says the builder takes "`PlanRecord`, `spikeSliceOf` and the `outstanding` count per slice". `spikeSliceOf` (`rules/spike.ts:57`) is a function for callers that see annotation COUNTS of shown slices only. A builder that holds the whole `PlanRecord` has the branches, so it calls `spikeOf(plan.slices)` (`spike.ts:43`) and takes the `.slice` index. Passing a function in as an input invites a Sonnet agent to make it a parameter. The two answers agree for a whole plan, but the plan should name one.

`assemblePlanWalk` sets `spikeApproved` with `record.spikeApprovedRaw !== undefined && record.spikeApprovedRaw !== ''`. `PlanRecord.spikeApprovedRaw` is `string` (`ports/plan-store.ts:53`), never `undefined`. The builder should own one predicate (for example `spikeApprovedRaw.trim() !== ''`, which is what `board/src/server/entry/gate.ts:575` and `approve.ts:723` use). Otherwise the walk and the queue can still disagree on a whitespace-only record.

### F5. The parity test is a TS-to-TS comparison and does not belong in the corpus tier

The plan calls it "corpus-style". The corpus tier (`packages/domain/corpus/`) holds a declared shell-versus-domain duplicate, per `CLAUDE.md` › *A Shell Script Asks The Domain*. `planQueue` and `assemblePlanWalk` are both domain code. The test goes in `packages/domain/test/`.

The two callers also count `outstanding` differently. `planQueue` counts `!deferred && !settled(merged)` (`queue.ts:931`). The walk counts by `branchState` with `wip`, `--loose` readiness and plan landings (`plan-walk-assembly.ts:321-329`). A parity test over a fixture with a `wip` or claimed branch compares the two `outstanding` rules, not the shared field set, and fails for a reason the plan keeps on purpose (Approach, second bullet). The fixture must hold only `open` and `merged` branches, and the test compares per-branch `claimable` from `planQueue` with `isClaimable(verdict, state)` from the walk, since `planQueue` returns no verdict. Add `delivered` to the phase list: the finished-phase arm (`eligible.ts:119`) is the other branch of the rule that reads `phase`.

### F6. The restart slice is aimed at a refusal that hides two causes, and the plan's hypothesis is already refuted by the code

The plan's open question asks whether the pulse omits Design plans. It does not. `assemblePlanWalk` drops only `released`, `rejected`, `superseded` and delivered docs/infra plans (`plan-walk-assembly.ts:19`, `:302-303`), and an offer drops only `TERMINAL_PHASES` (`:16`, `:201-202`). A Design plan is in every pulse. `branchFromPulse` (`packages/fleet/src/shared/continue-command.ts:28-45`) applies no phase filter.

What does produce `unknown-branch` with a Design plan on the estate:

1. **No trustworthy pulse.** `restart-command.mjs` reads the bridge through `fleetStateFile().readSync()` (`packages/fleet/src/server/entry/restart-command.ts:49-52`). `parseBridge` returns `null` for a foreign version or an age above `BRIDGE_MAX_AGE_MS` = 15 min (`packages/domain/src/adapters/fleet-state/fleet-state-file.ts:17`, `:73-80`), and a missing file also reads `null`. `branchFromPulse(null, …)` returns `null`, and `restartBranch` then says *"no plan on this board names that branch"*. That sentence is false in this case. The refusal conflates "no reading" with "branch not listed".
2. **Even when the pulse lists the spike, the restart refuses next.** The issue's spike was handed to the registry and no agent took it: all three manifests read `"branch": ""`. So no desk exists, `local_worktree` is empty, and `restartBranch` refuses `no-worktree` at `restart-command.ts:120-122`. `restart` is defined as "starts a new agent on a claimed slice whose worker is dead" (`CLAUDE.md` › *The Master Agent Uses The Controllers*). An unstarted spike is not a restart case.

So slice 2's changelog line ("restarts the worker of an approved spike … instead of answering `unknown-branch`") cannot hold for the issue's case. Once slice 1 lands, the registry hands the spike out and no restart is needed. The defect slice 2 can honestly fix is the refusal wording: a `null` pulse gets its own refusal (for example `no-pulse: the fleet has written no current reading`), distinct from `unknown-branch`. That decision is a lookup outcome, not a domain rule, so it may stay in `packages/fleet/src/shared/`. The domain decision (`restartWorker` in `workflows/dispatch-verbs`) is already in the domain and the plan need not move it.

### F7. The hold-word open question is moot as worded

`planQueue` does not carry the verdict word. A non-claimable queue item reports `not-claimable` or `prior-unknown` (`queue.ts:600`), and fleetd files `not-claimable` under `estate` (`registryd-main.ts:3246`). The scan reports `unapproved`. They use different vocabularies today for every unapproved plan, not only a spike, and this plan does not change that. Either close the question as out of scope or state the intended word. It is not something an unattended agent should decide.

## Required amendments

1. Make `SliceReadings.spike` and `SliceReadings.spikeApproved` required keys typed `boolean | undefined` in `eligible.ts`, so `tsc` refuses any site that builds readings without stating them. Name this in Approach as the gate.
2. Name the builder's signature: `(plan: PlanRecord, outstanding: readonly number[]) => SliceReadings[]` (or a per-slice outstanding callback), computing `spike` with `spikeOf(plan.slices)` and `spikeApproved` with one named predicate over `spikeApprovedRaw`. Remove "`spikeSliceOf`" as an input.
3. Move `blockingBranches` (`known-pr.ts:200`) into slice 1. Change its signature to take the `PlanRecord` (its only caller, `queue-reading.ts:622`, holds one) and build readings through the same builder. `assemblePlanWalk` calls the builder too, as the plan says.
4. Place the parity test in `packages/domain/test/`, not the corpus tier. Restrict its fixtures to `open` and `merged` branches, compare per-branch claimability, and cover `draft`, `design` (with and without `Spike approved:`, spike in slice 0 and in slice 1), `approved` and `delivered`.
5. Rewrite slice 2. Drop the "pulse omits Design plans" hypothesis (F6). Its goal becomes: `restartBranch` refuses a `null` pulse with its own reason and detail rather than `unknown-branch`, with a test that a stale bridge yields that reason. Rewrite the second changelog line to match, or drop it. Remove the `known-pr.ts` check from this slice (amendment 3).
6. Resolve or remove open question 3 (F7).

## Decisions for a person

- Whether slice 2 stays in this plan at all. With slice 1 merged, the issue's symptom is gone; the misleading `unknown-branch` text is a separate defect that could be its own issue.
- Whether the queue should ever report the scan's verdict word (`unapproved`) instead of `not-claimable` (F7). That is a vocabulary choice across fleetd's held list and the board.

## What I ran versus read

Ran (read-only): `git fetch`, `git show origin/main:<file>` and `git grep` over `packages/*/src` and `skills/plot/scripts`, and `gh issue view 3092`. Read: the plan, the juror brief, `eligible.ts`, `queue.ts`, `known-pr.ts`, `spike.ts`, `plan-walk-assembly.ts`, `ports/plan-store.ts`, `board/src/server/entry/verdicts.ts`, `fleet/src/shared/queue-reading.ts`, `fleet/src/shared/restart-command.ts`, `fleet/src/shared/continue-command.ts`, `fleet/src/server/entry/restart-command.ts` and `adapters/fleet-state/fleet-state-file.ts`. I ran no test, typecheck, build or fleet command. I did not reproduce the `unknown-branch` refusal; F6 names what the code makes possible and does not prove which cause the issue hit.
