# The reaper keeps leftovers that no controller removes

> The reaper keeps three kinds of leftover that no controller removes: a desk whose recorded pid a later process reuses, a local-only empty claim whose deferral sits in a delivered or released plan, and a deferred desk whose head is on the remote; one plan changes the reaper's readings for all three.

## Status

- **State:** Released
- **Type:** feature
- **Sprint:**
- **Issue:** #2757
- **Rounds:** 1
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-27, Jan Wloka, plan-PR #2758 merged
- **Started:** 2026-10-27, Jan Wloka, `bug/the-reaper-reads-a-reused-pid-as-a-live-worker`
- **Started:** 2026-10-27, Jan Wloka, `bug/a-local-only-empty-claim-branch-has-a-controller`
- **Started:** 2026-10-27, Jan Wloka, `bug/a-deferred-desk-with-a-pushed-head-is-reapable` (brief only, no claim yet)
- **Delivered:** 2026-10-27
- **Released:** 2026-10-28, v2.29.0

## Changelog

- The reaper no longer reads a reused pid as a live worker. It removes an empty local claim branch that any plan defers, and it removes a deferred desk whose head is on the remote. The remote ref of a deferred branch stays.

<!-- Board impact: one change. The shell's start-time check in plot-worker-state.sh feeds board rows, so a desk whose recorded pid a later process reuses shows `ended` instead of `running` when a per-pid start time is recorded. The plan format, the template, the helper scripts' output contracts and the docs/plans layout stay unchanged. The registry's rowState stays unchanged (see Out of scope). -->

## Motivation

Issue #2757 groups three tickets. Each ticket holds its own observation; this plan holds the measured cause of each and what the three share: the reap entry (`packages/board/src/server/entry/reap.ts`) keeps a leftover that no controller removes. Per *The Master Agent Uses The Controllers* in `CLAUDE.md`, that gap is the finding.

The panel (round 1, four jurors) reproduced all three defects at `4a1b8a5fa` with the shipped `plot-reap.mjs --dry-run` against a fixture repository with a bare origin.

### #2697: a reused pid reads as a live worker

Three causes hold the desk, and the reaper adds the last one on top of a shell answer that is correct in two of three fixtures.

- `plot_pid_is_current` (`skills/plot/scripts/plot-worker-state.sh:301-338`) answers *stale* only when the process started before the manifest's `startedAt` minus 3 s (`:335-337`). A reused pid belongs to a process that started after the worker launched, so it always passes. The code juror ran it: a `sleep` started at test time against a `startedAt` of `2026-10-24T08:00:00Z` answers *current*. The second reader at `:1443` and the domain mirror `agentState` (`packages/domain/src/rules/agent-state.ts`, `PidLiveness 'stale'`) use the same one-sided comparison.
- The bare `.plot-worker.pid` path (`plot-worker-state.sh:1213-1219`) reads `kill -0` only when no manifest names the desk and no wrapper file exists. Measured on this machine: 8 desk directories against 2 manifests in `.plot/agents`.
- `deskWorkerPid` (`reap.ts:312-319`) re-asks `deskLoopAlive` over the manifest's `pid` and `wrapperPid` with `pidAliveEverywhere` (`packages/fleet/src/shared/desk-loop.ts:39-46`), which is `process.kill(pid, 0)`, whenever the shell answers anything but `running`. `desk-loop-alive.ts:66-72` accepts a recycled pid as alive on purpose for its continue callers. So the reaper overrides a correct shell `ended` (rootcause fixture d3) and prints `worker alive (pid N)` (`reap.ts:714`). `runDirtyKind` (`reap.ts:1043`) uses the same `deskWorkerPid`.

The manifest's `startedAt` is not the process's own start. `write_agent_manifest` stamps it when the dispatch script writes the manifest (`plot-dispatch.sh:476-490`), before the worker starts, and `manifest-stamp.ts:50,87-92` rewrites it on every relaunch while `wrapperPid` keeps an earlier start. A two-sided check against `startedAt` therefore reads a slow-starting live worker, or a live wrapper, as reused.

### #2705: a local-only empty claim whose deferral the reaper cannot see

A controller already removes an abandoned empty claim: `runClaimKind` (`reap.ts:963-1023`) calls `ctx.trees.deleteBranch` (`:1009`) when `claimDisposition` answers `abandoned`. `claimDisposition` (`reap.ts:942-961`) reads only the Active index (`activeDir`, resolved at `:1098-1100`) and matches annotation text with `line.includes(...)`. Both branches #2705 reports carry `<!-- deferred: moved to a-row-is-a-tuple … -->` in `2026-08-20-waiting-on-you-says-what-kind-of-waiting.md:361-362`, a Released plan, so the reaper never reads the annotation and keeps both as `needs judgment`. `plot-dispatch.sh --release` answers "holds no claim" (`:2186-2190`) because its claim is the remote lock, which is correct for its scope.

### #2714: a deferred desk with its head on the remote

Two refusals hold the desk, in this order:

- `blocked-marker` (`packages/domain/src/rules/reapable.ts:122-124`): `markerRecordsWork` (`reap.ts:653-667`) is true whenever `origin/<default>..HEAD` holds a file-changing commit, pushed or not. The deferred branch holds 4 pushed commits.
- `no-merged-pr` (`reapable.ts:131-133`): `MergeReading` is `merged | not-merged | unreachable`, and a deferred branch never merges.

The second `keep` line in #2714 (`unlanded work — no merged PR`) is the kind-2 local-branch sweep (`reap.ts:870-905`, `firstBranchRefusal` in `rules/sweepable.ts`), not the desk.

## Design

### Approach

Each slice changes one reading in the domain and the reap entry that consumes it. No slice adds an ancestry decision, deletes a remote ref, or adds shell to `plot-dispatch.sh --release`.

1. **Pid reuse (#2697).** Each writer of a pid the reaper reads records that process's own start time (`ps -o lstart`, through the processes adapter, `processes-shell.ts:192`) beside the pid, at the moment it writes the pid: the manifest's `pid` and `wrapperPid`, and `.plot-worker.pid`. The slice lists every writer, including the relaunch awk in `plot-dispatch.sh:1576-1606`, and a test proves each one records a start. One exported domain rule, extracted from `isRecorded` (`packages/domain/src/rules/implement-lock.ts:34-65`) and its copy in `continue-lock.ts:26-35`, decides identity: a pid with a recorded start is the same process only when `kill -0` succeeds and the live start lies within 3 s of the recorded start on either side. A pid with no recorded start keeps `kill -0`. A live start that cannot be read reads *alive*, because a wrong *not-alive* runs `git worktree remove --force` under a live agent. `deskWorkerPid` replaces `pidAliveEverywhere` with this rule, so `runDirtyKind` changes with it. The shell's `plot_pid_is_current` and `agentState` change together: when a per-pid start is recorded, both compare against it within 3 s on either side; when none is recorded, both keep today's lower bound against `startedAt`. `packages/domain/corpus/agent-state.corpus.test.ts` holds the pair and gains rows for both arms and the 3 s edge. The shell lines the start-time writes add are paid in the same change under `check-shell-lines.sh`.
2. **Claim branch (#2705).** The reap entry reads the slice annotation from every plan under the configured `Plan directory` (active, delivered and released) through the plan parser's slice `intent`, not from the Active index by text match. The reading moves into the domain as one rule, `branchGivenUp`, which #2714 reuses. `firstClaimRefusal` (`rules/sweepable.ts:144-174`) stays unchanged, and the removal stays in `runClaimKind`. An unannotated local-only empty claim stays `needs judgment`: deleting it would race a dispatch between its local claim commit and its push (`agent-loop.ts:723`, `auto-design.ts:734-741`). The report reason stays `abandoned claim (plan says deferred/moved)`, so `quiet-kinds-render.browser.test.ts:159` and `sweep.test.mjs:305` stay unchanged.
3. **Deferred desk (#2714).** A desk is reapable on this path only when all of these hold: `branchGivenUp` answers true; no live worker (the slice 1 reading); no uncommitted path besides the root marker; `unpushed` (`reap.ts:349-376`) is `[]`; and the host reports no open PR on the branch (`RefReadings.openPr`, `reapable.ts:204`), with an unanswered host keeping the desk. For this case `markerRecordsWork` counts file-changing commits against `origin/<branch>` instead of `origin/<default>`, and the rule lifts only `blocked-marker` and `no-merged-pr`. The reap entry saves the marker text to `.plot/state/refusals.tsv` (as `reap.ts:745-760` does for `refused-empty`), then removes the checkout and its manifest. It deletes the local branch only when `unpushed` is `[]` against an `origin/<branch>` it fetched in the same run; on a failed fetch the local branch stays. It never deletes `origin/<branch>`: `refDeletionProblems` keeps refusing `given-up` first (`reapable.ts:235-254`), and `plot-release-refs.sh:326` keeps printing "a given-up branch keeps its ref". The rule reads no closed-PR state, so it adds no host verb and no Bitbucket `DECLINED`/`SUPERSEDED` mapping: with the conditions above, removing the checkout loses nothing whatever the PR state.

### What "given up" means

The annotation word does not carry the meaning. At `4a1b8a5fa`, 8 of the `<!-- deferred: … -->` annotations under `docs/plans/` (40 by this count, 43 by the panel's) say "moved to" another plan, including both #2705 branches, and 7 annotations use `<!-- moved: … -->`. The plan parser already reports `intent: 'deferred'` for both words (`packages/domain/src/entities/plan.ts:134-151`).

`branchGivenUp` answers true when at least one plan's parser reports the branch's slice as `deferred`, and no plan in the Active index schedules the same branch as an `active` slice. The second condition covers a slice that moved and continues on the same branch under its receiving plan: that branch is not given up, and both kinds keep it. Both #2705 branches pass: the receiving plan `2026-08-20-a-row-is-a-tuple.md` is Released and names them in a table and in prose, not as slices. The claim kind deletes only a wholly empty claim, so a wrong *given up* there costs an empty commit; the desk kind removes a checkout, so it also requires `unpushed` to be `[]` and keeps the local branch unless a fresh fetch confirms the head.

### Out of scope

- `deskLoopAlive` (`rules/desk-loop-alive.ts`), `pidAliveEverywhere` and their callers `continueOnDesk`, `readDeskLoop` (`desk-loop.ts:82-89`) and `--stop` through `board/plot-desk-loop.mjs`. They read a recycled pid as alive on purpose: a wrong *not-alive* starts a second loop on the desk (#1294). The reaper gets its own reading instead.
- The registry's `deskPidAlive` and `rowState` (`packages/fleet/src/shared/registry.ts:140-169`), for the same reason: they take a shell `finished` to `running` and choose the false *alive*. A board row can still show a reused-pid desk as `running` through this path; a separate plan may change that direction with its callers' consent.
- `plot-dispatch.sh --release`. Its claim is the remote lock, and a change there costs shell lines in a decision script.

### Acceptance

Each slice adds a test that fails on `4a1b8a5fa` and the opposite arms that must stay kept. Tests that run the built `plot-reap.mjs` need `pnpm build:board` first, and the generated bundle is restored before push. A test spawns its own child and awaits its exit in teardown (`test/reconcile/own-process.mjs`); none relies on real pid reuse.

- **Pid reuse.** Fails today: a desk whose manifest `pid` is a live `sleep` with a recorded per-pid start 1 h before the child's real start prints `worker alive (pid N)`; after the slice the row names no live worker. Fails today: the same child with a manifest `startedAt` 1 h in the future (tests juror's fixture), through the `kill -0` fallback alone. Fails today: `plot_pid_is_current` for a `sleep` started now against a recorded start 1 h earlier answers *current*. Kept: a recorded start equal to the child's start within 3 s; a manifest `startedAt` 60 s before the child's start with a matching per-pid start (a slow-starting worker); a live `wrapperPid` whose recorded start predates a relaunched `startedAt`; a pid with no recorded start (`reap-agent-liveness.test.mjs:266` stays green unedited); a live start that cannot be read. Domain unit tests cover the identity rule before, at and after the 3 s edge on both sides. The corpus test feeds the shell and `agentState` the same rows.
- **Claim branch.** Fails today: a local-only empty claim annotated `deferred:` in a plan linked only from `delivered/` reads `keep … needs judgment`; after the slice it reads `would` and `--yes` deletes it. The same for a Released plan that neither index links. Kept: an unannotated local-only empty claim (`sweep.test.mjs:294-308` stays green unedited); a `deferred:` branch that an Active-index plan schedules as an active slice; a claim branch that carries a real file (`sweep.test.mjs:310`); a branch checked out in a worktree. Domain unit tests cover `branchGivenUp` with `deferred:`, `moved:` and `deferred: moved to …`.
- **Deferred desk.** Fails today: a desk on a branch whose plan says `deferred:`, with one file-changing commit pushed, head equal to `origin/<branch>`, an untracked root `PLOT-BLOCKED.md`, a dead worker and no open PR reads `keep … PLOT-BLOCKED marker`; after the slice `--yes` removes the checkout and its manifest, saves the marker text to `refusals.tsv`, deletes the local branch after a fetch, and leaves `origin/<branch>`. Kept, each with one input flipped: an open PR; an unanswered host; a live worker; a dirty path besides the marker; one unpushed commit (the row names its sha); a branch an Active-index plan schedules as active. The local branch stays when the fetch fails.

### Open Questions

- [x] #2697: which signal identifies the worker's process? — A start time recorded per pid at launch, compared within 3 s on either side. Not the manifest's `startedAt` and not the command line: a relaunched loop has the same command line. Operator decision, panel round 1.
- [x] #2705: does the removal belong to `plot-dispatch.sh --release` or to the reap entry? — The reap entry, which already deletes through `runClaimKind`. Operator decision, panel round 1.
- [x] #2714: must the remote head be deleted with the desk? — Never. The checkout and its manifest go; the local branch goes only after a fresh fetch shows nothing unpushed. Operator decision, panel round 1.
- [x] Does the report text change? — Not for #2705. #2697 removes a `worker alive` row; #2714 turns a `keep … PLOT-BLOCKED marker` row into a removal row.
- [ ] #2714: does a marker written after the deferral date keep the desk? The annotation carries a date and the marker has an mtime. The slice saves the marker text before removal either way.

## Slices

### Pid reuse

- `bug/the-reaper-reads-a-reused-pid-as-a-live-worker` — the reaper compares a start time recorded per pid at launch, and the shell's one-sided start-time check becomes two-sided against it (#2697) → #2785

### Claim branch

- `bug/a-local-only-empty-claim-branch-has-a-controller` — the reaper reads a slice's deferral from every plan, so it removes an empty local claim that a delivered or released plan defers (#2705) → #2791

### Deferred desk

- `bug/a-deferred-desk-with-a-pushed-head-is-reapable` — the reaper removes a deferred desk whose head is on the remote and keeps `origin/<branch>` (#2714) → #2797

## Notes

- Created from issue #2757 by `/plot-idea`, unattended. The Design question had no explicit answer, so the plan starts in Draft.
- Related plans: `2026-10-17-desk-markers-and-the-reaper.md` (Released) and `2026-09-25-the-reaper-sees-the-desks-the-fleet-leaves.md` (Rejected). Neither addresses these three cases.
- This plan's panel, round 1: `.plot/panels/2026-10-27-the-reaper-keeps-leftovers-that-no/` (rootcause, code, safety, tests; unanimous amend). The operator chose the narrow #2705 rule over deleting every local-only empty claim, a per-pid recorded start over the manifest's `startedAt`, the reaper-only scope for #2697, and keeping the remote ref for #2714.
- The third slice's branch was `bug/a-deferred-desk-with-a-closed-pr-is-reapable`. Round 1 dropped the closed-PR condition, so the branch is now `bug/a-deferred-desk-with-a-pushed-head-is-reapable`. No ref exists under either name.
- `PLOT-UNASKED: Does this plan carry significant design decisions? — default — proceeded; State: Draft`
- `PLOT-UNASKED: Is this intentionally separate from the two reaper plans above? — default — proceeded; overlap named`
- `PLOT-UNASKED: Is reapable a duplicate of the candidates the deliverable search listed? — default — proceeded; the plan changes those rules and builds nothing new`
