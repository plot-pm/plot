# Safety juror — partial-board-pulse-reported-as-unknown

Lens: what can this change stop, delete, merge, overwrite or misreport, and does every uncertain case end in a named refusal rather than a guess?

Position: amend

## Summary

The change is a refusal-wording change on three readers, and as written it starts, stops, deletes or merges nothing new. One ordering ambiguity can turn it into a new refusal on the no-board restart path that `plot-dispatch.sh --restart` uses today, and the plan does not close it. A second gap: a null pulse and a partial pulse are two different readings, and the plan gives them one name.

## Findings

1. **Claims verified.** `restart.ts:64-68` passes `(deps.pulse ?? pulseFor)(opts)` and never reads `pulseCompleteFor` (origin/main). `fleet.ts:3301-3303` is `pulseFor`; `fleet.ts:3305-3326` is `pulseCompleteFor`, which returns `true` on a cold cache. `restart-command.ts:115-118` refuses `unknown-branch` with 404. `continue.ts:122` and `agent-panel.ts:161` read `pulseFor` the same way. `deliver.ts:314` passes `pulseCompleteFor(opts)`. All true.

2. **The no-board restart proceeds without a pulse listing today, and the new rule must not stop it.** `restart-command.ts:116` falls back to `input.worktree` when the pulse does not list the branch: `found = listed ?? (input.worktree ? {…worker: 'elsewhere'…} : null)`. The entry `packages/fleet/src/server/entry/restart-command.ts:88` fills `worktree` from `PLOT_RESTART_WORKTREE`, which `plot-dispatch.sh --restart` sets (`skills/plot/scripts/README.md:86`). The bridged pulse carries no completeness (plan Open Question 2). Approach step 4 says "the rule treats a null pulse as partial". If the rule replaces the `!found` check on `listed` rather than on `found`, or if a missing completeness input defaults to `false`, a restart that proceeds today with a git-reported worktree refuses `pulse-partial` instead. That stops a fleet restart the sprint goal depends on, and no named test in the plan catches it.

3. **A null pulse is not a partial pulse.** `pulseCompleteFor` doc (`fleet.ts:3316-3319`) says a caller holding a null pulse "must not read `true` as the scan finished". The plan maps null to "partial", whose proposed detail is "the board's scan has not finished". On the board that is roughly right; on the no-board commands a null pulse means `last-pulse.json` is missing or unreadable (`entry/restart-command.ts:44-51`), which is "no scan has been bridged", not "a scan is in progress". The detail text then misreports the cause and sends the reader to wait for a scan that no fleetd will run.

4. **The safe direction holds otherwise.** Every new arm only replaces the wording of an existing refusal; none admits a start the current code refuses. The rule must keep that property explicitly: the partial-pulse arm must never fall through to `continueOnDesk`, and must never look the branch up in `lastCompletePulseFor` to find a worktree (a stale pulse can name a desk that `/plot-reap` has since removed — that would start a worker in a guessed directory, which `continue-command.ts:75-77` refuses by design).

5. **Retry (Open Question 3) is an action, not a wording.** A route that waits for the scan and retries starts an agent at a later time against a pulse the caller never saw. That is a decision the person who clicked did not make. Name only.

6. **Exhaustive switches catch the client half.** `ContinueWithAnAnswer.tsx:refusalWord` switches over `ContinueRefusal`, so a new member fails typecheck until a word exists. `AgentPanelMiss` (`agent-panel.ts:60-64`) is a separate union; its two doc comments are swapped on origin/main (`no-worktree` carries the "no worktree on this machine" text and `unknown-branch` carries "the pulse knows the branch"). A slice that adds a third member should correct them, or the panel misreports its own reasons in docs.

7. **Status code.** A 404 today; the plan leaves 409/503 open. No client code branches on `status === 404` for these routes (grep of `packages/board/src/app` on origin/main found none), so either is safe. 503 fits "the reading is not ready"; 409 is what every other desk refusal uses. This is a person's or the agent's choice, not a safety risk.

## Required amendments

A1. State in the Design: the rule runs only where `restartBranch` / `continueBranch` / `agentPanel` would refuse `unknown-branch` today — after the `input.worktree` fallback in `restartBranch`. It never adds a refusal where the current code proceeds.

A2. State the default for a reader with no completeness (the no-board commands): `complete: true`, so they keep `unknown-branch` — or a distinct reason. Never default to partial.

A3. Give a null pulse its own reason or detail (`no-pulse`: "no scan has been read yet; on the board wait for the first scan, with no board start fleetd") rather than folding it into `pulse-partial`.

A4. Close Open Question 3 as "name only, no retry".

A5. Name the tests: (a) restart with a partial pulse that omits the branch and no `worktree` refuses the new reason; (b) restart with a partial pulse that omits the branch and a `worktree` input reaches `continueOnDesk` exactly as today; (c) a complete pulse that omits the branch keeps `unknown-branch` 404; (d) null pulse gives the null reason on continue, restart and the panel. Test (b) fails if A1 is violated; the existing `restart-route.test.ts:52` keeps passing.

## Decisions for a person

- HTTP status for the new refusal (409 or 503).
- Whether the no-board commands get a completeness field in `last-pulse.json` now or later (A2 makes "later" safe).

## What I ran versus read

Ran (read-only): `gh issue view 3118`; `git show origin/main:` of `restart.ts`, `fleet.ts:3290-3330`, `restart-command.ts`, `continue-command.ts`, `continue.ts`, `agent-panel.ts`, `continuation.ts`, `ContinueWithAnAnswer.tsx`, `entry/restart-command.ts`; `git grep` for `pulseFor`, `pulseCompleteFor`, `unknown-branch`, `last-pulse`. Read only: plan, CLAUDE.md, juror brief. Ran no tests, no board, no fleet command, no host write.
