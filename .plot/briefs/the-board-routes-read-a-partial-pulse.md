## Implementation brief — fleet-state-is-read-whole-and-from-one-home (wave 6: Partial-pulse readers)

- **Plan (canonical):** `docs/plans/2026-11-21-fleet-state-is-read-whole-and-from-one-home.md` on `main`, Slice 6 and the Motivation paragraph "#3136, readers take a partial pulse as whole"
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3609 merged
- **Branch:** `bug/the-board-routes-read-a-partial-pulse` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review through the repository's review channel (`Review: pr`)

Waves 1 to 5 of this plan are merged (#3624, #3659, #3666, #3669, #3672). This wave waits on none of them. Wave 7, `bug/the-pulse-lookup-moves-into-the-domain`, waits on this one: it moves `lookupBranch` into `packages/domain/src/rules/pulse-branch.ts`, the file this wave adds `pulsePlanReading` to.

### What to build

Three board readers look a branch or a plan up in the raw `pulseFor(opts)`, and a pulse from an unfinished scan lacks the plans and branches that the scan has not reached. `pulseBranchReading` (`packages/domain/src/rules/pulse-branch.ts:30`) already separates a partial pulse from a complete one for restart, continue and the agent panel. The three readers do not use it:

- `workerLog` calls `worktreeForBranch(pulseFor(opts), branch)` (`packages/board/src/server/worker-log.ts:176`). A branch that the scan has not reached answers `no-worktree`, which tells the operator the desk is missing when the scan is late.
- The dispatch route calls `startReadingFromPulse(pulseFor(o), planSlug, br)` (`packages/board/src/server/dispatch.ts:388`).
- The implement route calls the same function (`packages/board/src/server/implement.ts:285`). For a plan absent from a partial pulse the reading is `no-reading` (`packages/domain/src/rules/auto-dispatch.ts:643`), and the route then starts a run with no branch (`implement.ts:285-295`). That run is the observable failure.

`packages/board/src/server/deliver.ts:397` is the precedent: it reads `pulseFor`, `pulseCompleteFor` and `lastCompletePulseFor` and passes all three to `deliveryPulse`. `agentPanel` (`agent-panel.ts:160-175`) is the precedent for the `deps` seam (`pulse`, `pulseComplete`, `lastComplete`) that `workerLog` gains.

Build, in this order, with the failing cell written first each time:

1. `pulsePlanReading(live, liveComplete, lastComplete, slug)` in `packages/domain/src/rules/pulse-branch.ts`. It is the plan-level twin of `pulseBranchReading` with the same four answers in the same order (`no-pulse`, `listed`, `pulse-partial`, `unknown-branch`; name the last one by what it says about a plan if the plan's text reads better, but keep the four-answer shape). "Lists the plan" means `pulse.plans` holds a plan whose file slug is `slug` (`planSlug`).
2. `startReadingFromPulses(live, liveComplete, lastComplete, slug, branch)` as a named pure function, next to `startReadingFromPulse` in `packages/fleet/src/shared/dispatch-command.ts:122`. It replaces the inline default at `dispatch.ts:388` and `implement.ts:285`. `NamedBranchRefusal` and `DispatchReadingFor` (`auto-dispatch.ts:670-675`) gain `pulse-partial`. The dispatch route answers it with 409. The implement route answers it with 409 and starts no run, also when no branch is named.
3. `workerLog` takes a `deps` argument shaped like `agent-panel.ts:167-173` and reads the branch through `pulseBranchReading`. `LogMissReason` (`worker-log.ts:64`) gains `pulse-partial` and `no-pulse`. Both answer 404, as `continue` does (`continue-command.ts:84-89`).
4. `missWord` (`packages/board/src/app/components/WorkerLogModal.tsx:45`) gains two sentences: "The fleet scan has not reached this branch yet; ask again after the scan finishes." and "There is no fleet reading to look this branch up in." The word for each reason is a domain property that the modal reads; do not decide it in the `.tsx`.
5. `packages/fleet/test/unit/fleet-clock-bridge.test.ts`, a characterisation test of the bridge. fleetd writes the bridge only through `writeScan` after `scanOnce` returns (`packages/fleet/src/shared/fleet-scan.ts:1120-1150`, `fleet-clock.ts:203`), and `recordAttempt` rewrites only `attempt` (`fleet-clock.ts:164-168`). The test asserts that a scan that throws, or a refused write, leaves every field except `attempt` unchanged. It passes on today's code; it records the behaviour that makes "no `complete` field" safe.
6. `skills/plot/scripts/plot-fleet-scan.sh:222` names `write_bridge`, a function that no script defines. Change the comment to name `writeScan`. Add no shell lines.

### Settled decisions — do not re-derive them

**The bridge gets no `complete` field.** Operator decision, 2026-11-21. `BRIDGE_VERSION` stays 1 (`packages/domain/src/adapters/fleet-state/fleet-state-file.ts:28`). The alternative, a `complete` flag on `last-pulse.json`, would bump the version and make every older reader refuse the file. The board-free commands already default `pulseComplete ?? true` (`continue-command.ts:135`, `restart-command.ts:139`), because `writeScan` runs only after a scan returns: a file on disk is always a finished scan's. They need no change, and `packages/fleet/src/server/entry/dispatch-command.ts:153` keeps calling `startReadingFromPulse` over the bridge. Do not delete `startReadingFromPulse`; that entry still uses it.

**No new behaviour for a complete pulse.** `pulsePlanReading` answers `listed` with `live` whenever `live` lists the plan, and the existing readings of `dispatchReadingFor` then answer as today. Only the partial-and-absent case changes. A test that a complete pulse without the plan still answers `no-pulse-reading` or `no-reading` as today catches an implementation that turns every absence into `pulse-partial`.

**Absence from a partial pulse says nothing about the plan.** This is the rule `pulseBranchReading`'s TSDoc states, and it is the same absent-is-not-false rule this repository keeps re-learning. Ask the last complete pulse before refusing; refuse `pulse-partial` only where neither lists the plan.

**Do not move `lookupBranch`, `branchFromPulse` or `ContinueRefusal` here.** That is wave 7. `worker-log.ts:114` `worktreeForBranch` stays a function over a pulse in this wave; the log reads the branch through `pulseBranchReading` and then calls it on the `listed` pulse. Moving the walk now makes wave 7 a conflict.

### Done when

The plan's Slice 6 test list is the specification:

- `packages/domain/test/pulse-branch.test.ts`: `pulsePlanReading` cells — null live; live lists the plan; complete live without it; partial live with the last complete pulse listing it; partial live with neither listing it.
- `packages/domain/test/auto-dispatch.test.ts`: a `pulse-partial` cell for `startReadingFromPulses`.
- `packages/board/test/unit/worker-log.test.ts`: a partial-pulse cell through `deps`, and the distinct-`missWord` assertion extended to the two new reasons (a shared sentence would pass a weaker test, so assert all reasons map to different words).
- `dispatch-brief-branch.test.ts` and `implement-route.test.ts`: one cell each over `startReadingFromPulses`. The implement cell asserts no `startImplement` call, and it must name no branch, because the branchless run is the defect.
- The partial-pulse cells fail on today's code. Run each against `main` first and see it fail.

Plus: the board gains a source change, so run `pnpm build:board` locally to test, and commit no bundle: `scripts/check-no-bundle-diff.sh` refuses one. Add a changeset, description first and the `bumps:` block last; the Changelog line of this plan about the worker log and the `pulse-partial` refusals is the text to use. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e`. The slice touches no `.sh` line except one comment word on line 222: `scripts/check-shell-lines.sh` counts commands, and a comment edit adds none.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns: `packages/domain/src/rules/pulse-branch.ts`, `packages/domain/src/rules/auto-dispatch.ts` (the two types), `packages/fleet/src/shared/dispatch-command.ts` (`startReadingFromPulses`), `packages/board/src/server/{worker-log,dispatch,implement}.ts`, `packages/board/src/app/components/WorkerLogModal.tsx`, the named tests, `packages/fleet/test/unit/fleet-clock-bridge.test.ts`, one comment in `skills/plot/scripts/plot-fleet-scan.sh`, and a changeset.

In flight: wave 7 (`bug/the-pulse-lookup-moves-into-the-domain`) holds no branch yet and edits `pulse-branch.ts`, `continue-command.ts`, `continuation.ts` and `agent-panel.ts`; add to `pulse-branch.ts` without reordering what is there. Open PR #3605 (`a-continuation-resumes-the-asking-agent`) changes `continuation.ts`; this wave does not touch that file.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
