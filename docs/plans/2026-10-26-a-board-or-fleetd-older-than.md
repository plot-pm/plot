# A board or fleetd older than the gate spawns runs the gate refuses

> A board or fleetd that started before a gate changed its spawn contract spawns unattended runs with the wrong markers, and nothing names the gap. This plan gives every spawn a contract number from one domain constant, lets the main-checkout gate name a stale spawner only when that number proves it, and lets the board and fleetd report their number against the gate's.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2728
- **Rounds:** 1
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-27, Jan Wloka, plan-PR #2729 merged
- **Started:** 2026-10-27, Jan Wloka, `bug/a-spawn-carries-its-gate-contract`
- **Started:** 2026-10-27, Jan Wloka, `bug/the-board-and-fleetd-report-their-contract`

## Changelog

- Every unattended run that Plot spawns carries `PLOT_SPAWN_CONTRACT`, and the main-checkout gate names a spawner older or newer than itself in its refusal only when that number differs from its own.
- The board and fleetd report `stale: spawn contract N, gate expects M` in `--status` and on the board when their spawn contract differs from the gate's, and change no process.

<!-- Board impact: slice 2 adds a spawn-contract reading to the /api/board payload and one status entry on the board page, and changes the --status output of two helper scripts (plot-boardctl.sh, plot-fleetctl.sh) and their rows in skills/plot/scripts/README.md. No plan format or template changes. Slices that change a bundle rebuild it locally only (pnpm build:board) and commit no generated bundle. -->

## Motivation

### Incident

Issue #2728 records one failure measured on 2026-10-26. The board (pid 23604) started 2026-10-20 09:33 and fleetd (pid 8692) started 2026-10-17 17:15. `PLOT_MAIN_CHECKOUT_WRITER` arrived in `da7097509` (#2317, 2026-10-22), and the board bundle (`275a8704e`) and fleetd bundle (`286e0483a`) those processes ran contain it 0 times. Every agent session loads the gate from the installed plugin (2.28.1 `plot-gate.mjs` checks the marker). An implement run that the stale board spawned got `PLOT_UNATTENDED=1` without the marker, the gate refused its commit, and the agent left its first writes in the main checkout (#2725). fleetd was equally stale for the brief ask. The board and fleetd were restarted at 21:18 on 2026-10-26.

### Roles today

#2740 (`a98afb890`, 2026-10-26) removed the marker from the implement run: `implement-run.ts:652-659` now sets `PLOT_UNATTENDED`, `PLOT_BRIEF_ONLY`, `PLOT_PLAN_SLUG` and `PLOT_BRIEF_BRANCH` and no marker. Six spawn sites set the marker on `origin/main`: deliver (`packages/board/src/server/deliver.ts:649`), reslice (`reslice.ts:473`), story (`story.ts:514`), auto-deliver (`packages/fleet/src/shared/auto-deliver.ts:272`), brief-ask (`brief-ask.ts:163`) and the dispatch brief launch (`skills/plot/scripts/plot-dispatch.sh:827`). The dispatch brief launch is a shell script that runs from disk on each call, so it skews only when its caller runs it from an old plugin directory. The desk launch (`plot-dispatch.sh:1558`) and the continuation launch (`continuation.ts:1116`) set the marker empty on purpose.

### Gate blindness

`gatesMainCheckout` (`packages/domain/src/rules/main-checkout-write.ts:32-33`) reads `PLOT_UNATTENDED === '1' && marker !== '1'`. That is the designed state of every desk worker and of the idea (`idea.ts:725`), interrogate (`interrogate.ts:490`), auto-verify (`auto-verify.ts:500`), auto-design (`auto-design.ts:757`) and implement (`implement-run.ts:655`) runs. The gate reads only its own environment, so it cannot tell a stale spawner from a correct one. A refusal text that names a stale spawner on that reading blames the wrong cause in most refusals.

### Two directions

The skew runs both ways. A spawner older than a grant omits it, and the gate refuses work that should pass (the incident). A spawner older than a withdrawal keeps the grant, and the gate allows work that should not pass. After the 21:18 restart, #2740 merged, so the running board again set the marker on implement runs that the new design books from a disposable worktree. A spawner older than #2646 (`3ad9450be`, 2026-10-25) omits `PLOT_BRIEF_ONLY`, and the `brief-push` gate (`gate.ts:565`) allows a push it exists to refuse. No refusal text can show an allow.

### Reload scope

A board that `plot-boardctl.sh --start` started runs plain `node` (`plot-boardctl.sh:425`) and does not reload its bundle. A board that `pnpm board` started runs `node --watch` (`package.json:14`) and reloads on each rebuild. fleetd runs the bundle its launchd unit names (`plot-fleetctl.sh:118`, `:219`). Worker loops already detect a newer bundle by content hash and restart at an idle point (`packages/domain/src/rules/loop-restart.ts:85`).

## Design

### Approach

One number, two readers.

1. **The spawn contract.** The domain exports `SPAWN_CONTRACT`, a positive integer, and `SPAWN_CONTRACT_ENV = 'PLOT_SPAWN_CONTRACT'`, in a new rule file `packages/domain/src/rules/spawn-contract.ts`. `spawnContractEnv()` returns `{ PLOT_SPAWN_CONTRACT: String(SPAWN_CONTRACT) }`. Every site that already forces `backgroundGateEnv()` (`agent-run-env.ts:38`) last also forces `spawnContractEnv()` last: `agentRunEnv` (`agent-run-env.ts:67`, the SDK runner), `agent-run-command.ts:67` (the command runner), `prompt.ts:161` (the `--background-gate` export lines) and `worker-loop.ts:1573` (the desk prompt). These four sites cover every `startBoardRun` role (`board-run.ts:184`) on both runners and every desk prompt, including desks that `continuation.ts` and the dispatch desk launch start. The dispatch brief launch (`plot-dispatch.sh:827`) spawns the `Brief command` directly, so it reads the number from its own bundle through `plot-prompt.mjs --background-gate` and exports it.
2. **The gate reads it.** `spawnContractReading(env)` answers `absent` (variable unset), `empty` (set to `''`), `unreadable` (not a positive integer), or `{ number }`. Unset and empty stay distinct: `absent` means the spawner predates the contract, and `empty` means a spawner cleared it, which no current spawner does. `mainCheckoutWriteRefusal` takes the reading and names a spawner older than the gate only for `absent` or a smaller number, and a gate older than the spawner only for a larger number. `empty`, `unreadable` and an equal number add no spawner sentence.
3. **The board and fleetd report it.** Each records its own `SPAWN_CONTRACT` at start and reports it against the number of the gate that agents load now. The report changes no process.

Refusing to spawn from a stale spawner (the issue's third option) is not in the plan. It would stop runs that the gate allows.

### Bump Rule

A contributor raises `SPAWN_CONTRACT` by one in the same change that does any of these: adds, removes or renames an environment variable that a gate reads (today `PLOT_UNATTENDED`, `PLOT_MAIN_CHECKOUT_WRITER`, `PLOT_BRIEF_ONLY`, `PLOT_BRIEF_BRANCH`, `PLOT_SPAWN_CONTRACT`), or changes which spawn sets or clears one of them. The TSDoc of `SPAWN_CONTRACT` states this rule.

`test/reconcile/spawn-contract-gate.test.mjs` makes a forgotten bump visible. `spawn-contract.ts` exports `SPAWN_CONTRACT_SHAPE`: for the current number, the sorted list of variable names the gates read and, per name, the sorted files that set it to a value. The test reads the variable names from `packages/board/src/server/entry/gate.ts` and the domain rules it imports, and the setter files by a grep over `packages/*/src` and `skills/plot/scripts/*.sh`. A difference fails with `the spawn contract changed: raise SPAWN_CONTRACT to N+1 and record the new shape`, and names the added and removed entries. The file name matches `*gate*`, so the `**` local check (`node --test test/reconcile/*gate*.test.mjs`) runs it on every change. The test sees names and setter files, not a change in a value's meaning; a reviewer reads that.

### Gate Text

Slice 1 splits `mainCheckoutWriteRefusal` (`main-checkout-write.ts:391`) into two texts. `gate.ts:534` returns the first when `gatesMainCheckout` decided the arm and the second when only `gatesStrandingReset` (`main-checkout-write.ts:351`) did.

- `mainCheckoutWriteRefusal(scriptDir, reading)` keeps the desk-worktree instruction. When the reading proves a skew, it adds one paragraph addressed to the operator: the spawner's number (or "none") and the gate's number, and that the process which spawned this run loaded code older (or newer) than this gate. It then tells the agent: if this run writes the main checkout by design (a deliver, reslice, story, auto-deliver or brief run), stop and report this refusal, and do not work around it. In that paragraph's case the text drops the "route it through a disposable worktree" advice (`main-checkout-write.ts:404-405`), which sent the #2725 agent around the refusal.
- `strandingResetRefusal(scriptDir)` holds only the mixed-reset paragraph, so a marked deliver, reslice or story run never reads that a marker is missing.
- Neither text names a stop, restart, `kill` or `bootout` command.

`gatesMainCheckout`, `gatesStrandingReset` and the `wants` and `ask` decisions do not change. Slice 1 also corrects the docstrings at `main-checkout-write.ts:13-17` and `gate.ts:507-510`, which still list the implement run as a marker setter.

### Spawner Status

Slice 2 is report-only. No consumer of the reading starts, stops, kicks or reloads a process.

- **Gate number.** The reader resolves the gate that Claude Code loads for this repository: the `plot@*` entry in `~/.claude/plugins/installed_plugins.json` whose `scope` is `project` and whose `projectPath` is the repository root, else the `user` entry, else the repository's own `skills/plot/scripts/board/plot-gate.mjs`. It asks `node <gate> --spawn-contract`, which slice 1 adds to the gate entry, and caches the answer by the file's size and mtime. A gate that does not answer reads `unknown`.
- **Board.** The board holds its compiled `SPAWN_CONTRACT` and the content hash of its bundle at start, and serves both with the gate number in the `/api/board` payload. A domain rule `spawnerStatus(reading)` in `packages/domain/src/rules/spawn-contract.ts` returns a `BoardStatus` (`default-branch.ts:279`) or `null`, rendered beside `checkoutHealthStatus` (`AgentList.tsx:945`). `plot-boardctl.sh --status` prints the line from the `/api/board` body it already fetches (`:206`).
- **fleetd.** fleetd writes `.plot/state/fleetd-start.json` under the common git dir once at start: `pid`, `startedAt`, `spawnContract`, `bundlePath`, `bundleHash`. fleetd's entry (`registryd-main.ts`) is its one writer, and a test in the shape of `one-issue-index-writer.test.ts` holds that. `plot-fleetctl.sh --status` prints the line that `plot-ask.mjs spawner` answers from that file. A file whose `pid` is not the running supervisor's pid reads `unknown`.
- **Words.** The reading is `current` (equal numbers), `stale: spawn contract N, gate expects M` (different numbers, in either direction), or `unknown` (no recorded identity, or no gate number). A stale line also says what a restart stops (for the board, the runs it started; for fleetd, the agents it runs) and recommends a restart when those are idle.
- **Bundle drift.** The board compares its start hash with the hash of the artifact `plot-board-probe.sh` resolves now; fleetd's reading compares its start hash with the hash of the bundle its unit names and of `$script_dir/board/plot-fleetd.mjs`. A difference prints as `bundle differs from <path> (evidence, not the verdict)` and never as `stale`. Hashes reuse `refs.hashFilesSync`, as `worker-loop.ts:362-363` does for `loop-restart.ts`, and a read re-hashes only when the size or mtime changed. `plot-fleetctl.sh:828`'s `BUNDLE MISSING` check moves into the same `plot-ask.mjs spawner` answer.
- **Contract.** `plot-fleetctl.sh --status` keeps its exit code and its first `summary:` line, including the `supervisor=` word (`:971`), as `supervisor-reading.ts` reads them.

Plugin-installed processes: in an adopting repository the board and fleetd run from a versioned plugin cache directory, and a plugin update adds a new directory beside the old one. The contract number compares across those two directories because both sides read their own compiled constant. The reading does not detect a session started with `--plugin-dir` or another `CLAUDE_CONFIG_DIR`, whose gate the reader cannot resolve, and it does not detect an agent session that loaded the plugin before an update, because a session keeps the gate it loaded at start. The status line names the gate path it compared, so the operator sees which gate was read.

### Tests

- **Slice 1, domain:** `spawnContractReading` answers `absent` for an unset variable, `empty` for `''`, `unreadable` for `x` and `0`, and a number for `3`. `mainCheckoutWriteRefusal` with `absent` and with a smaller number names both numbers and the stop-and-report sentence; with a larger number names the older gate; with an equal number, `empty` or `unreadable` adds no spawner paragraph. No text from either refusal function contains `--stop`, `restart`, `kill` or `bootout`. `strandingResetRefusal` contains no marker sentence.
- **Slice 1, env:** `agentRunEnv`, the command runner's env, `backgroundGate()` and the desk prompt env each carry `PLOT_SPAWN_CONTRACT` equal to `SPAWN_CONTRACT`, and a caller's own value cannot override it.
- **Slice 1, gate:** through `mainCheckoutGateOf` with injected readings, the existing `main-checkout-gate.test.ts` cases give the same allow and refuse set as before; a marked writer with a mixed reset gets `strandingResetRefusal`; an unmarked unattended run with `PLOT_SPAWN_CONTRACT` unset gets the stale-spawner paragraph.
- **Slice 1, contract:** `spawn-contract-gate.test.mjs` passes on the slice and fails on a fixture copy that adds a gate-read variable without a bump.
- **Slice 2, domain:** `spawnerStatus` answers `current`, `stale` for N < M and N > M, and `unknown` for a missing record, a pid mismatch and a gate that does not answer. Bundle drift with equal numbers gives an evidence line and no `stale`.
- **Slice 2, no action:** the board status read and `plot-ask.mjs spawner` with a stale reading make zero calls on a fake processes port.
- **Slice 2, fleetctl:** a `test/reconcile/` contract test with a fixture `fleetd-start.json` prints the stale line, keeps exit code 0 and the same `summary:` line as the fixture without a record, and prints `unknown` without a record. A plugin fixture with `cache/<old>/` and `cache/<new>/` gate bundles of different numbers reads `stale`.

### Acceptance

Each item fails on `origin/main` today.

- **Slice 1:** `pnpm --filter @plot-pm/domain exec vitest run test/main-checkout-write.test.ts test/spawn-contract.test.ts` and `pnpm --filter @plot-pm/board exec vitest run test/unit/main-checkout-gate.test.ts` pass with the cases above; on `origin/main` the stale-spawner and split-text cases fail. `node --test test/reconcile/spawn-contract-gate.test.mjs` passes. A `ps eww` sample of a deliver run that the slice's board spawns shows `PLOT_SPAWN_CONTRACT=<SPAWN_CONTRACT>`; on `origin/main` it shows none. Agents see the new refusal only after the next release updates the installed plugin.
- **Slice 2:** with the slice's fleetd and board running and a gate bundle whose number differs, `plot-fleetctl.sh --status` and `plot-boardctl.sh --status` each print `stale: spawn contract N, gate expects M`, the board page shows the status entry, and `--status` exits as before with the same `summary:` line. With equal numbers both print `current`. On `origin/main` neither prints a spawn-contract line.
- **Both:** `./scripts/check-shell-lines.sh` and `./scripts/check-decision-count.sh pr` pass. Slice 1 adds one export at `plot-dispatch.sh:827` and removes at least as many shell commands elsewhere in the same change. Slice 2 adds the `plot-ask.mjs spawner` call to `plot-fleetctl.sh` and one print to `plot-boardctl.sh`, and removes the shell `BUNDLE MISSING` arm (`plot-fleetctl.sh:827-828`) and other lines to at least break even. The comparison lives in a bundle, so no README row changes its Kind.

### Changesets

Each slice adds a changeset for package `plot`, with its Changelog line as the description.

### Open Questions

- [x] Content hash or mtime? — Content hash, as `loop-restart.ts` uses, measured at 1–2 ms per bundle; the hash is evidence only, and the verdict reads the contract number.
- [x] Where does the report show? — `plot-board --status`, `plot-fleet --status` and one `BoardStatus` entry on the board page.
- [x] Domain rule or entry? — The domain: the text is `mainCheckoutWriteRefusal` (`main-checkout-write.ts:391`), and `gate.ts:534` only returns it.
- [x] Does every rebuild count as stale? — No. Only a different contract number reads `stale`; bundle drift is an evidence line.
- [x] Report or self-restart? — Report only. Operator decision, panel round 1: a restart stops agents, and nothing gates an unattended restart.
- [ ] Does the "route it through a disposable worktree" advice leave every main-checkout refusal, or only the stale-spawner case? The plan removes it only where the contract reading proves a skew. Operator to decide.

## Slices

### Spawn Contract

- `bug/a-spawn-carries-its-gate-contract` — `SPAWN_CONTRACT` and `PLOT_SPAWN_CONTRACT` in `rules/spawn-contract.ts`, forced into every agent run env and the dispatch brief launch; `mainCheckoutWriteRefusal` split from `strandingResetRefusal` and naming a stale spawner only on a proven contract difference; `plot-gate.mjs --spawn-contract`; the bump test; corrected docstrings <!-- builds: a spawn-contract number every unattended spawn exports and the main-checkout gate compares --> → #2751

### Spawner Status

- `bug/the-board-and-fleetd-report-their-contract` — the board and fleetd record their start contract and bundle hash, `fleetd-start.json` with fleetd as its one writer, `spawnerStatus` and `plot-ask.mjs spawner`, and the stale, current or unknown line in both `--status` outputs and on the board page, changing no process <!-- waits: bug/a-spawn-carries-its-gate-contract --> <!-- builds: a spawn-contract reading for the board and fleetd -->

## Notes

- Source: the #2726 panel, round 1 (`.plot/panels/2026-10-26-implement-leaves-its-brief-and-plan/`, now on `origin/main`). This plan's panel, round 1: `.plot/panels/2026-10-26-a-board-or-fleetd-older-than/`. Related: #2725, #2740, #2646.
- The issue and the #2726 panel list the continuation launch as a marker role. It is not: `continuation.ts:1116` clears the marker on purpose.
- Reverse skew: the contract number covers it in slice 2, because the status reports any difference in either direction, including a spawner that still grants a withdrawn marker or omits `PLOT_BRIEF_ONLY`. The gate does not detect it: the gate sees nothing on an allow, and slice 1 keeps the `wants` and `ask` decisions unchanged.
- The skew window opens only when a merged change alters a spawn contract and a long-lived board or fleetd keeps running. A number that changes only then makes both readings fire rarely, and each time with a cause.
