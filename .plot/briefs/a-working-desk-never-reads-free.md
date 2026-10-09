## Implementation brief — no-controller-resumes-a-claimed-slice (wave 1: A working desk never reads free)

- **Plan (canonical):** `docs/plans/2026-10-09-no-controller-resumes-a-claimed-slice.md` on `main`
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `bug/a-working-desk-never-reads-free` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI must pass

Wave 1 of 3. Waves 2 (`feature/a-time-out-writes-its-ending`) and 3 (`feature/a-timed-out-slice-gets-a-fresh-agent`) wait on this one and are not yours. Wave 2 edits the same file, `packages/fleet/src/server/entry/worker-loop.ts`, so keep your diff to the assignment reading.

### What to build

The fix for #1409: a loop whose agent works a slice must read its assigned branch as that slice, not as `''`.

The observed failure, 2026-10-09: the agent on `feature/the-fleet-package-exists` ran at desk `.worktrees/free-1c9c57a0`. The loop's log repeated `free on ? — nothing handed over yet`, and the AgentMonitor recorded `"branch":""`. `readPass` (`worker-loop.ts:723`, `:731`) takes `assignedBranch` from `manifest.branch`, and with `''` it counts a free wait (`:779-782`). At `waitedSeconds >= boundSeconds` the loop ends with 124 (`:1610`) and takes the working agent with it. The same blank branch is why no loop waited on PR #1408's checks in #1409.

**Reproduce first, and name the writer that left the branch blank.** The plan does not measure this. Candidates to rule in or out, in this order:

1. The hand-over in `packages/fleet/src/server/entry/registryd-main.ts` (`:1150-1200`, `:1971`) writes the manifest's `branch` for one session, while the loop reads another session's manifest (`PLOT_MANIFEST_FILE`, `worker-loop.ts:2270`).
2. `clearAssignment` (`packages/domain/src/adapters/agents/agents-fs.ts:391-404`) sets `branch = ''` and runs while the agent still works.
3. A loop restart (`PLOT_WAIT_STARTED`, `worker-loop.ts:2290`) re-reads a manifest the hand-over has not yet written.

Write the failing test against the writer you find, not against `readPass`: `readPass` reads `''` correctly. The test fails on `origin/main` today.

### Settled decisions — do not re-derive them

**Fix the cause, not the bound.** Raising `Worker bound` or exempting a working agent from the free-wait bound hides the blank branch, and every consumer of `assignedBranch` (checks wait, correction, take-up log) stays blind. The plan's Open Question 1 was answered from code, 2026-10-09: the 124 came from this blank reading.

**Slices 2 and 3 stay as the fallback.** This slice does not remove the `bound` ending path. Do not edit `agent-loop.ts` row 6 or `ending-action.ts`.

**Absent is not false.** A manifest that cannot be read yields `EMPTY_MANIFEST` (`worker-loop.ts:426`), which reads as free. Do not widen that: a hand-started loop with no manifest is legitimately free.

### Done when

The plan's `## Done when` list is the specification. This slice owns its first part: the reproduced 2026-10-09 case fails on `origin/main` and passes on the branch. Assert two things a naive fix passes without:

- The manifest read by the loop holds the branch for the whole run of the agent, not only at the first pass (catches a fix that sets the branch once and a later `clearAssignment` blanks it).
- A loop with no manifest still reads free (catches a fix that treats `''` as an error).

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows against its merge base; this slice should touch no `.sh` file. Add a changeset (description first, `bumps:` block last) and run `./scripts/check-changeset-packages.sh`.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `## Slices` in the plan. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/fleet/src/server/entry/worker-loop.ts` (assignment reading only), `packages/fleet/src/server/entry/registryd-main.ts` and `packages/domain/src/adapters/agents/agents-fs.ts` where the reproduction points, plus their tests. Not yours: `packages/domain/src/workflows/agent-loop.ts`, `packages/domain/src/rules/ending-action.ts`, and the exit paths of the worker loop (wave 2).

If you find something the plan did not anticipate, report it rather than improvising outside scope. Two findings from #1409 are not in this plan: the loop runs under Node 26 against the pinned Node 24, and two LOW review findings on #1408. Report them; do not fix them here.
