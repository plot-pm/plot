## Implementation brief — the-worker-loop-runs-in-js (wave 2: The loop writes through ports)

- **Plan (canonical):** `docs/plans/2026-10-04-the-worker-loop-runs-in-js.md` on `main`
- **Approved:** 2026-10-04, jwloka, in-session
- **Branch:** `infra/the-loop-writes-through-ports` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention. The PR is reviewed as code, and CI is the authority for e2e.

Slice 1 (`infra/the-loop-has-a-workflow`) merged as #1279 on 2026-10-05, so every `Write` kind this slice carries out exists in `packages/domain/src/workflows/decision.ts`. Slice 3 (`infra/the-loop-runs-in-one-process`) waits on this slice: its entry calls `performLoopWrites` and the ports defined here. No other slice of this plan is in flight, and the only open PR on 2026-10-05 is the release PR #1278.

### What to build

The carrying-out half of the loop. `agentLoop` (slice 1) returns ordered `Write` values and touches nothing. Today the shell loop `skills/plot/scripts/plot-worker-loop.sh` performs the same writes inline: 891 code lines in 52 functions on 2026-10-04, none of them covered by a test runner. Slice 2 builds the code that applies those writes through ports, so slice 3 can run the loop with no inline shell.

The parts:

- **`performLoopWrites`** in `packages/board/src/server/entry/loop-writes.ts`. It takes the decision's `writes` and the ports, applies them in order, and returns what each one answered. Its `switch` over the loop's write kinds ends in a `never` check, so a kind with no arm fails `tsc`. Derive the loop's kinds from what `agent-loop.ts` emits (grep `kind: '` there), and type the `switch` over that subset, not over the whole `Write` union: the union also holds the plan, sprint and fleet kinds, and a loop applier has no business with them.
- **A `boundedRun` port** (`packages/domain/src/ports/bounded-run.ts`) and its adapter. It runs a child the caller owns: the prompt, and slice 4's `--self-check`. It is the opposite of `Performer`, which starts detached processes that outlive the caller, so it is its own port.
- **A `desk` port** (`ports/desk.ts`) and its adapter. It writes the desk's files: the ending file and its `endings.jsonl` line, the `PLOT-BLOCKED` marker, the declaration, the correction file, the limited record, the moved worker record and the findings lines.
- **`refs.remoteTip(branch)`**, a new operation on the `Refs` port over `git ls-remote` with a 10 s timeout, in `refs-git.ts` and `refs-fixture.ts`. It reads the remote, not a local ref: `remoteHead` (`ports/refs.ts:497`) and `branchTips` read local refs and cannot see another party's push. Return the tip as a value and compare it in the domain; `RemoteTipReading` (`rules/checks-verdict.ts:106`, `'pushed' | 'other' | 'unknown'`) is the comparison's result and is already the type `agentLoop` takes. A failed or timed-out `ls-remote` is `unknown`, never `other`.
- **A descendants read on `Processes`** (`ports/processes.ts`) and its shell adapter (`adapters/processes/processes-shell.ts`). `Processes` stays read-only.
- **The remaining reads and writes on `refs`, `trees` and `agents`**, as the arms need them. The shell code each arm replaces is in the table below. Add an operation only where the table finds no existing one: `trees` already has `list`, `isClean`, `markers`, `dirtyPaths` and `currentBranch`, `refs.contains` already answers ancestry (its adapter declares `plot-ancestry: evidence`), and `agents` already reads the manifest.
- **`@vitest/coverage-v8` in `packages/board`**, a coverage block in `packages/board/vitest.config.ts` gating `src/server/entry/loop-writes.ts` at 100% lines, branches, functions and statements, and a CI step that runs it beside *Domain tests + coverage gate* (`ci.yml:1245`). These are the first gated files in the board package. Slice 3 adds `worker-loop.ts` to the same block.
- **A group-stop test** (below) and a CI step for it.

The shell each arm replaces. Line numbers are from `main` on 2026-10-05; check them against the code of the day, and read the whole function before writing the arm, because each one carries edge cases (best-effort writes, temp-file-and-rename, empty arguments) that the plan does not list.

| Write kind | Shell today |
|---|---|
| `desk-reset` | `reset_desk` (`plot-worker-loop.sh:1080`) |
| `assignment-clear` | `clear_manifest_branch` (`plot-agent-manifest.sh:108`) |
| `prompt-run` | the first-prompt record in `run_bounded` (`:2261`); find where the manifest or log records it |
| `correction-count` | `raise_manifest_corrections` (`:443`) |
| `agent-attempt` | `raise_manifest_attempts` (`:399`) |
| `agent-resume` | `write_correction` (`:541`) and the resume in `run_bounded` |
| `blocked-marker` | `write_blocked_marker` (`:494`), `marker_writer_line` (`:484`) |
| `declaration` | `seal_declaration` (`:1210`) |
| `slice-spend` | `record_slice_spend` (`:1279`), which already asks `workflows/slice-spend.ts` and the `slice-spend` port |
| `loop-end` | `write_ending` (`:1319`), `write_limited_record` (`:1379`), `clear_limited_record` (`:1386`) |
| `worker-finding` | `plot_worker_publish_finding` (`plot-worker-state.sh:912`) |
| `build-finding` | the findings line `plot-build-monitor.sh` writes |
| the moved worker record | `move_worker_record` (`:1839`) |
| `push` | the claim push and the pushed work; find the caller on the shell side |
| `worker-signal` | the signal the supervisor path already sends |

### Decisions the plan settles — do not re-derive them

**Every write goes through an adapter, and the spawn ratchet does not grow.** `loop-writes.ts` holds no `spawn`, `execFile`, `fs` or `child_process`; every new spawn sits inside `adapters/`. *One place reaches a process* (`ci.yml:655`) counts direct `spawn`/`execFile` sites outside `adapters/` and fails when the count grows past `allowed`. Read that grep before you write the group-stop test: it decides whether a spawn in a test file is counted. Do not raise `allowed`, and do not lower it to make a number look earned.

**The prompt stays in the agent's process group, so `boundedRun` starts it without `detached`.** `plot-dispatch.sh --stop` ends an agent by `kill -TERM -<pgid>`, because the wrapper, the loop and `claude` share one group. Measured 2026-09-30 (#1084): signalling the wrapper's pid ended the wrapper, and the loop, the prompt shell, `claude` and its children survived reparented to pid 1; the group signal ended all of them. A `boundedRun` that sets `detached: true` (or calls `setsid`) puts the prompt in its own group, and the group stop then misses it. This is the failure the slice exists to prevent. Do not reach for `detached` to make the kill simpler.

**On the bound, `boundedRun` signals the prompt's process and its descendants, read through `processes`.** Read the descendants before you signal the root. After the root dies, its children reparent to pid 1 and a read of its descendants finds none: `_kill_tree` (`plot-worker-loop.sh:2054`) reads the children first for this reason. The same kill runs on `SIGTERM` and on the caller's exit.

**`processes` stays read-only, and `performer` keeps its contract.** The descendants read is the only addition to `Processes`. Starting a child the caller owns is `boundedRun`'s, not `performer`'s and not `processes`'s. A reader of a pid must not gain the ability to spawn: the read side is reached from the board's five-second poll.

**`remoteTip` is a new operation because the existing ones are the wrong reading.** `refs.remoteHead` and `refs.branchTips` read local refs; after a person pushes on top of the agent's commit (#1199: `0e64fafd` over the agent's `f743e573`) they still show the agent's tip. The comparison is equality, not ancestry, so it needs no `plot-ancestry` declaration. A connector or git that cannot answer is `unknown`, which keeps the CI wait going inside `Checks wait`: a failure to observe is not evidence.

**`declaration` and `loop-end` are separate arms.** `supervise` reads the declaration file and never the marker. An arm that wrote the ending and skipped the declaration would leave `supervise` answering `correct` to an agent that asked a question. Slice 1 emits both; this slice must apply both, in the order the decision gives.

**`assignment-clear` is not `manifest-clear`.** The first clears the manifest's `branch` field, as `clear_manifest_branch` does; the second deletes the manifest. The loop never emits `manifest-clear`, and its arm in `performLoopWrites` is the one place that should refuse it outright if the loop's kinds ever included it.

**Two counters stay apart in the writes too.** `correction-count` raises `correctionAttempts`; `agent-attempt` raises `attempts`, which the supervisor also reads (`MAX_ATTEMPTS`, `rules/supervision.ts`). Both writes carry the new value, not an increment, so applying one twice lands the same number. Test both directions: applying `correction-count` changes no `attempts`, and applying `agent-attempt` changes no `correctionAttempts`.

**Best effort stays best effort where the shell made it so, and no further.** `write_ending` appends to `.plot/state/endings.jsonl` in the main checkout and treats a failed append as no failure of the ending; the ending file itself is written through a temp file and a rename so a reader never sees a partial record. Carry both properties into the `desk` adapter and test them. Do not turn a best-effort append into a failure, and do not turn the ending file into a best-effort write.

**Rules carried over unchanged.** Absent is not false: an `unaskable` or `failed` port answer is not `no`. Read the exit code, not the emptiness. A function you write is an arrow (`export const f = (…) => …`, CLAUDE.md › The Domain Package), in the board too: the unit is the function, and every function in these new files is yours. The domain imports only `zod` outside `adapters/`, and the port is an `interface` with no runtime code; `ports/bounded-run.ts` names `adapters/` zero times. TSDoc says what an export does, how it fails and what it returns. The history goes into the commit message.

### Done when

The plan's slice 2 list is the specification. The slice is done when every kind `agentLoop` emits has an arm in `performLoopWrites`, each arm has a test against a port fixture, the group-stop test passes on Linux, and the coverage gate passes over `loop-writes.ts`.

Assertions that exist because a naive implementation passes without them:

- **The group-stop test (#1084).** A small Node script, the stand-in parent, calls `boundedRun` on a long-running stand-in prompt. The test starts the stand-in so that it leads its own process group (the dispatch wrapper's `start_worker` runs under `set -m`, so an agent does), sends `SIGTERM` to the negative pgid as `--stop` does, and asserts that both the parent and the prompt are gone. A `boundedRun` that detaches the prompt passes every other test in the slice and fails this one. Wait on the pids you started, not on a process name, and wait for each to exit before the test ends: a spawning test that does not wait leaves a process behind.
- **The kill on the bound reaches grandchildren.** The prompt starts a child that outlives a naive kill of the prompt's pid. After the bound, the child is gone too. Without this, a loop that reads the descendants after it signals the root passes.
- **The kill on the caller's exit.** The parent exits normally, and the prompt ends with it.
- **CI on Linux, including systemd with `KillMode=process` (#1148).** Put the check in the step that already drives systemd, *The systemd unit keeps its agents across a restart* (`ci.yml:397`), and read that step's comments first: the stand-in there is a script file and not an inline `sh -c`, for a reason the comment states. Every CI job runs on `ubuntu-latest`, so the PR records a local macOS run of the same test with the command and its output.
- **A `never` check that bites.** Add a kind to the loop's subset in a scratch edit and confirm `tsc` fails on `performLoopWrites`, then revert the edit through git. A `switch` whose `default` returns instead of asserting `never` passes every runtime test.
- **`remoteTip` answers three ways.** The tip equals the pushed commit, differs from it, and cannot be read (a failed or timed-out `ls-remote`). The third is `unknown` and never `other`. Use a real remote in a temp directory for the first two, and make the third a remote that does not exist.
- **The ending file never appears partial.** Read the file in a loop while the adapter rewrites it, or assert the temp-file-and-rename order. Without it a plain `writeFile` passes.
- **`desk-reset` refuses where plain `git checkout` refuses.** A desk with a file the earlier readings missed makes the write fail rather than overwrite it. `decision.ts:374` says why: `agentLoop` emits `desk-reset` only when `resetRefusals` names nothing, and the write is the second line of defence.

Plus the repo gates. Before each push, run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints: the tests that name a changed file, `vitest related` and the typecheck of the board and the domain, the gate tests and the `scripts/check-*.sh` gates. The suites in the `CI suites` key, including the board's coverage run, run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally. Check that the operator's board is not running before you run a board test: a local board test run takes the operator's board down. Run `pnpm board --status` first (check `/plot-board --status` if that flag differs) and stop if the board answers.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. This slice adds no `.sh` file and changes none. If a change makes you edit one, remove at least as many lines elsewhere in the same change; the gate has no override.

Add a changeset with package `@plot-pm/board` (the new code is in the board package and the domain package it imports), description first, and `plan: docs/plans/2026-10-04-the-worker-loop-runs-in-js.md` in the trailing comment block. Copy the format from `.changeset/` and from `git log -p -- .changeset`. `./scripts/check-changeset-packages.sh` refuses a description under 20 characters and a `bumps:` or `plan:` block written first.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work still moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to the `infra/the-loop-writes-through-ports` line under `## Slices` in the plan, on `main`.
- The PR records the macOS run of the group-stop test: the command and its output.

### Scope guard

This branch owns:
- `packages/board/src/server/entry/loop-writes.ts` and its test under `packages/board/test/unit/`
- the new ports `ports/bounded-run.ts` and `ports/desk.ts`, their adapters and fixtures under `packages/domain/src/adapters/`, and their exports in `packages/domain/src/index.ts`
- `refs.remoteTip` in `ports/refs.ts`, `refs-git.ts` and `refs-fixture.ts`
- the descendants read in `ports/processes.ts` and `adapters/processes/processes-shell.ts`
- any further operation the table above finds missing on `refs`, `trees` or `agents`
- `@vitest/coverage-v8` in `packages/board/package.json` and the lockfile, the coverage block in `packages/board/vitest.config.ts`, and the CI steps in `.github/workflows/ci.yml` for the coverage run and the group-stop test

It does not touch:
- `packages/board/src/server/entry/worker-loop.ts` and `skills/plot/scripts/board/plot-worker-loop.mjs`: the entry and its bundle are slice 3
- `skills/plot/scripts/**`: the shell loop keeps running unchanged, and this slice only builds the code that will replace it
- `packages/domain/src/workflows/agent-loop.ts`, `decision.ts` and the other slice-1 files, except to read them. If an arm needs a field a write does not carry, report it with `PLOT-BLOCKED`
- `rules/desk-lifecycle.ts`, `rules/supervision.ts`, `workflows/supervise.ts` and `rules/checks-reading.ts`
- the `reexec` port, which is slice 4

Branches in flight, verified 2026-10-05: no slice PR is open. The only open PR is the release PR #1278 (`changeset-release/main`), which edits changelog and version files. `git ls-remote --heads origin 'infra/*'` lists no branch.

If you find something the plan did not anticipate, report it with `PLOT-BLOCKED` rather than improvising outside scope.
