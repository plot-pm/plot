## Implementation brief — the-reaper-keeps-leftovers-that-no (wave 1: Pid reuse)

- **Plan (canonical):** `docs/plans/2026-10-27-the-reaper-keeps-leftovers-that-no.md` on `main`
- **Approved:** 2026-10-27, Jan Wloka, plan-PR #2758 merged
- **Branch:** `bug/the-reaper-reads-a-reused-pid-as-a-live-worker` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 1 of 3. `bug/a-local-only-empty-claim-branch-has-a-controller` and `bug/a-deferred-desk-with-a-pushed-head-is-reapable` wait on this wave's merge. The third slice reuses this wave's live-worker reading.

### What to build

`plot-reap.mjs --dry-run` prints `worker alive (pid N)` for a desk whose recorded pid a later process reuses. Measured at `4a1b8a5fa` by the panel (round 1): a `sleep` started at test time against a manifest `startedAt` of `2026-10-24T08:00:00Z` reads *current*, and the reaper overrides a correct shell `ended` (fixture d3). Issue #2757, ticket #2697.

Record each worker pid's own start time beside the pid, and decide identity from it:

1. Every writer of a pid the reaper reads records that process's start (`ps -o lstart`, the processes adapter at `processes-shell.ts:192`): the manifest's `pid` and `wrapperPid`, and `.plot-worker.pid`. List the writers, including the relaunch awk in `plot-dispatch.sh` (the `sh -c` wrapper near `:1573-1606`). A test proves each one records a start.
2. One exported domain rule, extracted from `isRecorded` (`packages/domain/src/rules/implement-lock.ts:34-65`) and its copy in `continue-lock.ts:26-35`: a pid with a recorded start is the same process only when `kill -0` succeeds and the live start lies within 3 s of the recorded start on either side (`IMPLEMENT_LOCK_SKEW_MS`). A pid with no recorded start keeps `kill -0`. A live start that cannot be read reads *alive*.
3. `deskWorkerPid` (`packages/board/src/server/entry/reap.ts:312-319`) uses that rule instead of `pidAliveEverywhere`. `runDirtyKind` (`:1043`) changes with it, because it calls the same function.
4. The shell's `plot_pid_is_current` (`plot-worker-state.sh:301`) and the domain mirror `agentState` (`rules/agent-state.ts`, `PidLiveness 'stale'`) change together: with a per-pid start recorded, both compare against it within 3 s on either side; with none recorded, both keep today's lower bound against `startedAt`. The second reader at `plot-worker-state.sh:~1443` follows. `packages/domain/corpus/agent-state.corpus.test.ts` gains rows for both arms and the 3 s edge.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**Not the manifest's `startedAt`.** `write_agent_manifest` stamps it when the dispatch script writes the manifest, before the worker starts, and `manifest-stamp.ts:50,87-92` rewrites it on every relaunch while `wrapperPid` keeps an earlier start. A two-sided check against `startedAt` reads a slow-starting live worker, or a live wrapper, as reused. The plan's kept-fixtures name both.

**Not the command line.** A relaunched loop has the same command line as the process it replaced.

**A live start that cannot be read reads *alive*.** A wrong *not-alive* runs `git worktree remove --force` under a live agent. A wrong *alive* costs one more reap pass.

**Out of scope, and the reason is a measurement of callers, not a preference.** `deskLoopAlive`, `pidAliveEverywhere`, `continueOnDesk`, `readDeskLoop` and `--stop` through `board/plot-desk-loop.mjs` read a recycled pid as alive on purpose: a wrong *not-alive* starts a second loop on the desk (#1294). The registry's `deskPidAlive` and `rowState` (`packages/fleet/src/shared/registry.ts:140-169`) choose the false *alive* for the same reason. Do not edit them. The reaper gets its own reading.

**The bare `.plot-worker.pid` path** (`plot-worker-state.sh:1213-1219`) reads `kill -0` only when no manifest names the desk and no wrapper file exists. Measured: 8 desk directories against 2 manifests in `.plot/agents`. So the pid file needs its own recorded start, not only the manifest.

Carried over from related work: absent is not false (no recorded start means keep today's reading, not *stale*); read the exit code, not the emptiness.

### Done when

The plan's `## Acceptance › Pid reuse` list is the specification. Assertions that exist because a naive implementation passes without them:

- A desk whose manifest `pid` is a live `sleep` with a recorded start 1 h before the child's real start no longer prints `worker alive (pid N)`. A fix that only edits the shell leaves this red, because `reap.ts` re-asks `kill -0`.
- The same child with a manifest `startedAt` 1 h in the future, through the `kill -0` fallback alone. It catches a fix that trusts the manifest.
- `plot_pid_is_current` for a `sleep` started now against a recorded start 1 h earlier answers *stale*.
- Kept: a recorded start equal to the child's start within 3 s; a manifest `startedAt` 60 s before the child's start with a matching per-pid start (a slow-starting worker); a live `wrapperPid` whose recorded start predates a relaunched `startedAt`; a pid with no recorded start (`test/reconcile/reap-agent-liveness.test.mjs:266` stays green unedited); a live start that cannot be read. These catch an over-eager *not-alive*.
- Domain unit tests cover the identity rule before, at and after the 3 s edge on both sides.
- No test relies on real pid reuse. Each test spawns its own child and awaits its exit in teardown (`test/reconcile/own-process.mjs`).

Plus: tests that run the built `plot-reap.mjs` need `pnpm build:board` first; restore the generated bundle before push (`scripts/check-no-bundle-diff.sh`). Add a changeset (description first, `bumps:` block last). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. The start-time writes in `plot-dispatch.sh` and the shell comparison add lines, and this change pays for them: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override. Write new domain functions as arrows.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `plot-worker-state.sh`, the pid writes in `plot-dispatch.sh`, `packages/domain/src/rules/{implement-lock,continue-lock,agent-state}.ts` and their tests, `packages/domain/corpus/agent-state.corpus.test.ts`, `packages/board/src/server/entry/reap.ts` (`deskWorkerPid` only), and the new tests under `test/reconcile/`.

Other branches in flight: the two later slices of this plan. The claim-branch slice touches `claimDisposition` and `runClaimKind` in `reap.ts`; the deferred-desk slice touches `markerRecordsWork`, `rules/reapable.ts` and `rules/sweepable.ts`. Keep your `reap.ts` diff to `deskWorkerPid` and its imports.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
