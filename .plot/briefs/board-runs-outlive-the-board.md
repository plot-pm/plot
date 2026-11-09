## Implementation brief — the-board-starts-agent-runs-in (wave 1: Runs outlive the board)

- **Plan (canonical):** `docs/plans/2026-11-08-the-board-starts-agent-runs-in.md` on `main`
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3275 merged
- **Branch:** `bug/board-runs-outlive-the-board` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** the `plot/review` check is required on `main` (`Review required since` 2026-10-15); `Auto-review` is on

This is the plan's only slice. Nothing waits on it and it waits on nothing. Story `nothing-changed-nothing-runs` Phase 4 builds the full move later, and this slice does not build any part of it.

### What to build

A board stop or restart ends every agent run the board started. Measured 2026-11-08 at 19:42: a board restart ended the `state-branch` implement run before it booked its brief (`the board exited with code 143 before the run ended`), and the plan was dispatched again (issue #3274). After this slice, a run that a board route starts keeps going when `plot-boardctl.sh --stop` stops the board's process tree, and it records its own end.

Three changes carry it. First, an adapter in `packages/domain/src/adapters/agent-run/` starts the run through a shell launcher that re-parents it, so the run's parent is `launchd`/init and the run is not a descendant of the board. Second, the launcher writes the run's pid and start time into the run-state file when the run starts, and its exit code and end time into the same file when it ends. Third, `readRunState` reads a run whose pid is dead and whose file holds no exit record as `failed` with a reason of its own, and reads a live pid as `running`.

Read the plan first. It is canonical and this brief only adds what the plan does not say.

### Where the code really is — the plan's table is out of date

- `packages/board/src/server/board-run.ts` is one line, `export * from '@plot-pm/fleet/shared/board-run'`. `startBoardRun`, `markBoardRun`, `readRunState`, `endHeldRuns` and `parseRunMarker` live in `packages/fleet/src/shared/board-run.ts`.
- Seven board modules call `startBoardRun` directly: `idea.ts`, `story.ts`, `story-plan.ts`, `approve.ts` (its agent arm only), `deliver.ts`, `reslice.ts`, `interrogate.ts`. None passes an `onEnd` callback.
- `implement.ts` does not call `startBoardRun`. `POST /api/implement` and `POST /api/dispatch` go through `startImplement` (`packages/fleet/src/shared/implement-run.ts:642`), which does pass an `onEnd` callback. This is the path of the incident, so it is the path the test of this slice must cover.
- fleetd calls the same `startBoardRun` for `auto-deliver`, `auto-design`, `auto-verify`, `brief-ask` and `implement-run`, and each needs its `onEnd` in-process. The detached start is therefore opt-in per call, set by the board's routes only. fleetd's callers keep today's behaviour byte for byte.
- The `approve.ts` script arm (no `Approve command`) already starts its child `detached` through `scriptsFor(...).start`, with a comment that explains why it keeps its handle. This slice does not touch that arm.

### Decisions the plan settles — do not re-derive them

**The launcher is a shell script that exits before the run does.** `detached: true` alone does not work. `plot-boardctl.sh --stop` walks the board's descendants by parent chain (`ps -eo pid=,ppid=`, `plot-boardctl.sh:159-174`), and a `detached` child keeps the board as its parent, so it is still stopped. Only a launcher whose direct child exits at once re-parents the run. `bounded-run-process.ts` is never `detached` by design, so a bounded kill reaches the whole group; it keeps that behaviour, and so do its other callers.

**The run's pid and exit code travel through the state file, and the board no longer learns a run's end from `child.on('exit')`.** The marker grammar today is `running <pid> <startedAt>`, parsed in one place, `parseRunMarker`, whose doc comment says every reader parses it there. The pid in today's marker is the board's. `readRunState` already treats a marker naming another live pid as `running` while `alive(pid) && !recycled`. A marker that names the run's pid therefore needs no new reader path for the live case.

**The board keeps today's behaviour for a role on the `sdk` connector.** `agent-run-sdk.ts` runs in the board process, and an in-process run cannot outlive the board. The plan names the cost in the log and in the state file.

**Runs an older board started keep their old behaviour.** Their state files hold the board's pid and are read as today.

**The domain decides what a state file means, as a pure rule with unit tests.** Readings go in as values (`marker`, `alive`, `startedAt`, `recorded`) and a state comes out. `readRunState` stays as the reader and asks the rule. Do not add a port call to the rule.

### Traps the plan does not name — each one passes a naive implementation

- **`endHeldRuns` overwrites the detached run's state file.** The board's `exit` listener writes its own exit code (143 on SIGTERM) into every state file in `held`, and appends `the board exited ... and the run ended with it` to the log. A detached run is not held. Call `held.delete(statePath)` when the run is handed to the launcher, or the first board stop after this slice writes `143` over the file the launcher owns. The test of this slice must stop the board and then read the state file after the stub run ends.
- **`onStarted(pid)` reports the wrong pid.** `startImplement` passes `onStarted: (pid) => recordImplementAgent(...)`, and the implement lock reads that pid to decide whether a run lives. With a launcher that exits at once, the pid `boundedRun` sees belongs to the launcher, which is dead within milliseconds, so the lock reads stale and a second run starts beside the first. The pid the callback receives must be the run's pid. Check `takeImplementLock` and its stale rule before you choose where the launcher reports it.
- **`startImplement`'s end callback runs in the board.** It restores the checkout, logs drift, writes the branch-keyed state, releases the lock and calls `onExit`. When the board is gone, none of that runs. Decide which parts the launcher's end record must cover (at least the branch-keyed state and the lock release; `--brief-only` runs write nothing to the checkout, so the restore is a backstop), and write what you decided in the PR body. Do not leave the lock held by a dead run: the stale rule above is the net.
- **The bound moves into the launcher.** Today `boundedRun` kills the run on `boundSeconds` and the state file records `124` (`IMPLEMENT_TIMEOUT_MS / 1000` for implement). A re-parented run has no board watching it, so the launcher applies the bound and writes `124`.
- **The limit-line classification does not travel.** `agentRunCommand` reads the appended log through `promptExit` and reports `wait`, `end-limited` and `dropped`. The launcher records the raw exit code and the end time, as the plan says. Routes that pass no `onEnd` lose nothing a card shows; say in the PR body that the classification stays for the in-board path.
- **`processStartedAt` answers on Linux only.** It reads `/proc`; on macOS it returns `null`, so the recycled-pid check is inert there today, and the operator's board runs on macOS. The plan says the liveness check is the pid plus its start time, as `plot-worker-state.sh` reads a desk worker. Record the start time from the same source the reader compares (as `markBoardRun` does) and measure on macOS before the PR says the check holds there. Without a second signal on macOS, a reused pid reads `running`.
- **The plan's `in-board` word has no reader.** `RunState.state` is `unknown | running | done | failed` and seven route modules and the page consume it. Do not widen it silently. Name the cost in the log line, which the plan also names, and report in the PR body if the page needs a state word.
- **The dead-pid record is a new constant.** `STOPPED_RECORD` reads `on the board stopping before the run ended`, which is false for a detached run. Add a second record, `the run ended without an exit record`, next to it.
- **Write the exit record atomically.** Write a temporary file in the state file's own directory, then `mv` it over the state file, so a reader never reads half a code.

### Rules carried over unchanged

- **A missing or unreadable state file is `unknown` or `running` by the log's presence, never `failed`.** Absent is not false.
- **The layering rule holds.** A controller calls the domain. The launcher script is reached from an adapter only. `agentRunFor` chooses the adapter, and the domain imports no adapter. `scripts/check-*.sh` includes the purity gate and the one-place-reaches-a-process ratchet (`allowed=28`); a spawn inside `adapters/` does not count against it.
- **The wrapper is not a second runner.** Do not add a request path from the board to fleetd, a fleetd change, or a `fleet-not-running` refusal. The issue's third `Done when` item belongs to the story, and the plan's Scope says so. The PR does not close #3274: write `Refs #3274`.
- **Functions you write are arrows** (`export const f = (…) => …`), in the domain, the fleet package and the tests alike.
- **A comment states the current behaviour.** The comments at `idea.ts:808-815` and the header of `fleet/src/shared/board-run.ts` say a run stays in the board's process group and ends with it. Change them in the same diff. The reasoning goes in the commit message.

### Done when

The plan's `## Slices` entry is the specification: board-started runs start through a re-parenting launcher, write their pid and exit record into the run-state file, and the board reads a dead pid with no exit record as `failed`. A test starts a stub run through the idea route, stops the board's process tree as `plot-boardctl.sh --stop` does, and asserts the stub run keeps going and books its exit code.

Lift these assertions, because a naive implementation passes without them:

- **The stub's parent is not in the board's descendant set.** Walk the parent chain with `ps -eo pid=,ppid=`, as `plot-boardctl.sh` does. A process-group check passes for `detached: true` and proves nothing.
- **The state file reads the stub's exit code after the board stopped.** It catches the `endHeldRuns` overwrite.
- **A second route (`startImplement`) is covered by its own test.** It catches the wrong pid in `onStarted` and the lock that reads stale.
- **A state file with a dead pid and no exit record reads `failed` with the new reason.** It is a unit test of the rule, with no process.
- **A run started by `leaveBoardRunsToTheBoard(true)` and a fleetd caller behave as before.** `auto-dispatch-brief-ask.test.ts` and `implement-lock*.test.ts` keep passing unchanged.

Plus: add a changeset (description first, the `bumps:` block last, package `plot` or `@plot-pm/board`; a change under `skills/plot/scripts/` bumps skill `plot`). Do not commit a rebuilt board bundle: `check-no-bundle-diff.sh` refuses it, and `main` builds its own. Run `node ../plot/scripts/board/plot-local-checks.mjs` before each push (resolve the path from the skill directory) and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. The launcher is new shell, so remove an equal number of commands elsewhere in the same change, or write more of it in the domain and ask it through a bundle. The gate counts commands, not lines: joining statements with `;` or `&&`, or folding `fi` or `done` onto the line before, is not a payment. It stores no number and has no override. The detached wrappers at `plot-dispatch.sh:811-840` and `:1507` are the models for the re-parenting; the one at `:1507` is a long one-liner that also writes a desk manifest, so copy the shape, not the line.

Test hygiene, from this repo's measured failures: a board test that spawns must wait for the child's exit before it removes its fixture; clear `PLOT_UNATTENDED` and `PLOT_REPO_ROOT` in the test's environment; remove temp entries by the exact name `mkdtempSync` returned; and never run board tests while the operator's board is open, because `test:board` stops it.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves). Never run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/fleet/src/shared/board-run.ts`, `packages/fleet/src/shared/implement-run.ts`, `packages/fleet/src/shared/agent-run-for.ts`, `packages/domain/src/adapters/agent-run/`, a new rule under `packages/domain/src/rules/`, the seven board route modules' `startBoardRun` calls, the new launcher under `skills/plot/scripts/`, its README row (`check-helper-table.sh` is the gate), their tests, and the changeset.

Verified at dispatch on `origin/main` (2026-11-08): no open pull request changes `board-run.ts`, `agent-run*`, `bounded-run*` or `plot-boardctl.sh`, and no other branch of this plan exists. `bounded-run-process.ts` and `plot-boardctl.sh` stay as they are.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
