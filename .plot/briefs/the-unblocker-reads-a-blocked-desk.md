## Implementation brief — the-unblocker-reads-a-blocked-desk

- **Plan (canonical):** docs/plans/2026-11-16-the-unblocker-reads-a-blocked-desk.md on main
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3475 merged
- **Branch:** `bug/the-unblocker-reads-a-blocked-desk` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot-review` on the PR (`Review: pr`)

This is the only slice of the plan, in the sprint `bug-fixes-2-35-0`. Nothing waits on it and it waits on nothing.

### What to build

fleetd never starts an unblocker on a real desk (issue #3320). `unblockWorldForRepo` (`packages/fleet/src/server/entry/registryd-main.ts:1412`) asks `processes.workerState(worktree, true)`. The `true` is `hasPr`. For a dead agent, `agentState` falls to `taskState`, and `taskState` returns `finished` on `hasPr` before it reads the `PLOT-BLOCKED` marker (`packages/domain/src/rules/task.ts:88-89`). So a dead desk with a marker reads `finished`, `deskDeadFromWorkerState` answers `{ dead: true }`, and `unblockerDue` refuses `not-waiting`. An agent that asks a question and stops waits for a person, although the unblocker role exists to answer it.

The change is one argument: `deskDead` asks `processes.workerState(worktree, false)`. `TaskReadings.hasPr` documents that case: a caller that cannot know says `false`, and the tree then answers. Update the TSDoc of `unblockWorldForRepo` to say it reads the desk with no PR assumed.

The wiring test at `packages/fleet/test/unit/registryd-main.test.ts:3307-3311` hides the defect. It stubs the reader to return `waiting`, and its comment states the cause. Replace the stub with a real desk read through the default `processesFiles` reader, so the test fails while the world passes `true`. The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

- **Do not change a domain rule, port or adapter.** `unblockerDue` and `taskState` stay as they are. The `hasPr` contract already covers the no-PR case, so the fix belongs at the one caller that holds no PR fact.
- **Do not switch to the `deskDead` rule** (`packages/domain/src/rules/desk-dead.ts`). It reads a marker before liveness and answers `waiting` for a live agent too. Issue #3320 asks that a live agent answers no start. With `false`, a live pid reads `running`, which answers `live` and refuses `not-waiting`.
- **Leave the fixer tick's `true` alone** (`packages/fleet/src/shared/auto-fixer.ts:373`). That caller reads PR rows, so its `true` is a real fact.
- **A non-zero exit still reads `failed`**, which answers dead and refuses `not-waiting`, as before. Do not add a test that expects otherwise.
- **No shell/domain duplicate is involved**, so no corpus row changes.
- **Absent is not false.** If the reader cannot read the desk, `deskDead` answers `{ dead: false, why: 'unread' }` today. Keep that branch as it is.

### Done when

The plan's `## Done when` table is the specification. Three assertions exist because a naive implementation would pass without them:

1. *"unblockWorldForRepo reads a blocked desk with a dead agent as waiting"* — an untagged `PLOT-BLOCKED` marker, a dead pid, exit 0 and an open PR for the branch must make `unblockerDue` answer `{ start: true }` through the default `processesFiles` reader. It catches a fix that passes `false` but is proved only against a stub. It must fail on `main`, where `deskDead` answers `{ dead: true }`; run it against the unchanged source first and confirm the failure.
2. *"unblockWorldForRepo reads a blocked desk with a live agent as live"* — the same desk with a live pid must answer `{ start: false, why: 'not-waiting' }`. It catches a fix that reads every marker as `waiting` regardless of liveness.
3. `grep -n "state: 'waiting' as const" packages/fleet/test/unit/registryd-main.test.ts` prints no line in the `unblockWorldForRepo and unblockPortsFor` block. It catches a test that keeps its stub beside the new ones.

Build the fixtures from the files the real reader reads (see `packages/domain/src/adapters/processes/processes-files.ts:373` and `agentState` in `packages/domain/src/rules/agent-state.ts:160-164`), not from a stubbed state.

Plus: a changeset for `plot` (patch), with the description first and the `bumps:` block last:

```
---
'plot': patch
---

fleetd starts an unblocker on a desk whose agent asked a question with `PLOT-BLOCKED` and then stopped.

<!--
plan: docs/plans/2026-11-16-the-unblocker-reads-a-blocked-desk.md
bumps:
  skills:
    plot: patch
-->
```

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite, and not `test:e2e`. The change touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count; if you add shell anyway, remove an equal number of lines elsewhere in the same change. A `packages/fleet/src/**` change also needs `pnpm --filter @plot-pm/fleet exec tsc --noEmit -p .`. Commit no rebuilt board bundle.

### Bookkeeping

- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.
- Push the first real commit as soon as it exists.
- New functions you write, including test helpers, are arrows.

### Scope guard

This branch owns `packages/fleet/src/server/entry/registryd-main.ts` (the `unblockWorldForRepo` argument and its TSDoc), `packages/fleet/test/unit/registryd-main.test.ts` (two real-desk tests; the wiring test loses its `waiting` stub), and one changeset file under `.changeset/`.

Other work in flight touches `desk-probes-in-domain` (PR #3319, merged) and `fleetd-starts-the-unblocker` (briefed earlier). Do not edit the domain rules those plans own. If you find something the plan did not anticipate, report it rather than improvising outside scope.
