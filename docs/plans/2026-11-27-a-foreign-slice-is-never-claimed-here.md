# A foreign slice is never claimed here

> The pulse places a slice whose line names another repository as `foreign`, so the fleet never claims or dispatches it here, and a free agent's ended wait writes its own ending instead of reading `failed`.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:**
- **Issue:** #3735
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged
- **Started:** 2026-11-27, Jan Wloka, `bug/a-foreign-slice-is-never-claimed-here`

## Changelog

- The fleet no longer claims a slice that its plan places in another repository: the pulse shows such a slice as `foreign`, and dispatch refuses it by name. A free agent whose wait reaches `Worker bound` ends with `free-wait-expired` and no longer reads `failed`.

<!-- Board impact: a new branch state `foreign` on the pulse and the plan card. No change to the plan format, the template or the docs/plans layout. -->

## Motivation

The Approved plan `the-bitbucket-client-sends-an-access-token` names its first slice as `` - `feature/bb-sends-an-access-token` — quatico-solutions/agent-skills: … ``, a bare branch with no arrow (`docs/plans/2026-11-23-the-bitbucket-client-sends-an-access-token.md:54`). The fleet pushed `e1cf66e9b plot: claim feature/bb-sends-an-access-token` to plot-pm/plot at 2026-11-24 20:53 UTC. The GitHub events API holds 106 `CreateEvent` and 102 `DeleteEvent` entries for that ref between 2026-11-24 21:30 and 2026-11-26 17:53 UTC, 200 of them on 2026-11-25; between 17:32 and 17:56 UTC that day it holds 4 creates and 3 deletes. No work was done. A person released the claim on 2026-11-26 and added a `deferred:` marker to the slice line.

`branchState` (`packages/domain/src/rules/branch-state.ts:389`) gives up a branch only for `deferredByPlan`, which `plan-walk-branches.ts:528` reads from the slice line. No reading says the slice belongs to another repository. `crossRepoReferences` (`rules/cross-repo-reference.ts`) reads a foreign `→ owner/repo#N` for delivery, and nothing on the claim path reads it.

The same desk then read `failed`. `.plot/state/endings.jsonl` holds `{"reason":"unreadable","actor":"supervisor","branch":"feature/bb-sends-an-access-token","detail":"the worker exited 124 and wrote no ending"}`, and 13 more of its 49 lines carry the same detail. `agentLoop` row 2 (`packages/domain/src/workflows/agent-loop.ts:648`) ends a free wait past the bound with exit 124 and no `loop-end` write, because "no ending reason applies here". `killedWorkerEnding` (`rules/ending-action.ts:698`) then composes `unreadable` from the non-zero exit. The worker log already says "Nothing was cut short" (`packages/fleet/src/server/entry/worker-loop.ts:2038`).

## Design

### Approach

- **One rule names the foreign repository.** A new domain rule, `sliceForeignRepo(line, thisRepo)`, answers the `owner/repo` a slice line names where the description starts `<owner>/<repo>:` or a claim line carries `→ owner/repo#N`, and that repository is not `thisRepo`. It answers `null` otherwise. It reuses the reference grammar of `cross-repo-reference.ts`.
- **`foreign` is a branch state.** `BranchStateSchema` (`entities/fleet.ts:56`) gains `foreign`. `branchState` returns it after `deferred` and before every git reading, so no claim count, ref or PR answer overturns it. `plan-walk-branches.ts` passes the rule's answer as a new reading `foreignRepo`.
- **Nothing claims a foreign branch.** The pulse counts it as settled for wave eligibility only where the foreign PR reads merged, and lists it as `foreign` otherwise. `plot-dispatch-command.mjs --branch` refuses it as `branch-foreign`, naming the repository. Auto-dispatch never offers it.
- **A waiter reads the foreign PR.** A branch whose `waits:` names a foreign branch reads that branch's `→ owner/repo#N` through `Host.prMerged(branch, { repo })`. A foreign branch with no arrow keeps its waiter `waiting`, and the reason names the repository.
- **A free wait writes its own ending.** `EndingReasonSchema` (`entities/ending.ts:146`) gains `free-wait-expired`. Row 2 of `agentLoop` writes a `loop-end` with that reason, actor `agent`, exit 124. `killedWorkerEnding` composes nothing for a desk that holds an ending, so the supervisor writes no `unreadable`. The ending action for `free-wait-expired` reaps the desk as a finished one.

### Open Questions

- [ ] `[question-this-repo-unread]` Where `thisRepo` is unread, the rule cannot tell a foreign repository from this one. Recommendation: treat every `owner/repo:` prefix as foreign, because a missed claim costs a person one dispatch and a false claim costs a ref churn.
- [ ] `[question-prefix-or-anywhere]` The rule reads the `owner/repo:` form only at the start of the description. Recommendation: start only, as the template prescribes; a repository named later in prose is not a placement.

## Slices

### Claim Guard

- `bug/a-foreign-slice-is-never-claimed-here` — `sliceForeignRepo`, the `foreign` branch state, the pulse placement, the `branch-foreign` dispatch refusal and the waiter's foreign PR reading <!-- builds: sliceForeignRepo, the foreign-slice rule --> <!-- tests: a slice line `quatico-solutions/agent-skills: …` in plot-pm/plot reads foreign over a claim commit and an open ref; a line whose arrow names a PR in other/repo reads foreign; a line naming this repository reads its own state; dispatch --branch refuses branch-foreign; auto-dispatch offers no foreign branch -->

### Free Wait Ending

- `bug/a-free-wait-writes-its-own-ending` — `free-wait-expired` in `EndingReasonSchema`, the row-2 `loop-end` write in `agentLoop`, and its ending action <!-- builds: the free-wait-expired ending --> <!-- tests: agentLoop with no assignment and waitedSeconds at the bound writes loop-end free-wait-expired with exit 124; killedWorkerEnding composes null for that desk; the desk reads finished, not failed -->

## Notes

Created on 2026-11-27 for the sprint fleet-runs-safely-alone.
