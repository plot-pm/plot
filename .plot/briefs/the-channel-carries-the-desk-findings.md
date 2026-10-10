## Implementation brief — the-fleet-reports-what-changed-on-the-host (wave 4: The channel carries the desk findings)

- **Plan (canonical):** `docs/plans/2026-10-09-the-fleet-reports-what-changed-on-the-host.md` on `main`
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1451 merged
- **Branch:** `feature/the-channel-carries-the-desk-findings` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is wave 4 of 8. Waves 1 to 3 merged (#1455, #1460, #1464): fleetd opens the channel on `.plot/fleet.sock` in loop mode, `RunningChannel` has `publish(finding)` and `seen(monitor)`, and `IndexMonitor` publishes through `runIndexMonitor` (`packages/fleet/src/shared/index-monitor.ts`). This wave adds the second publisher. Wave 5 (`/api/events`) subscribes to the same socket and needs both publishers running to be worth testing. The wave waits on nothing else.

### What to build

The three desk monitors (WorkerMonitor, AgentMonitor, BuildMonitor) append to `.plot-worker.monitor.<subject>.jsonl` in their desk, and the board reads those files itself (`packages/board/src/server/findings.ts`, called once at `packages/board/src/server/fleet.ts:5700`). The channel now runs and carries only the IndexMonitor's findings. A subscriber waiting `until owes a review` (`entry/act.ts`) hears nothing, because no process puts a desk finding on the channel. The same holds for `owes an answer` (a `PLOT-BLOCKED` marker) and `build failed`.

Three changes, in this order:

1. **A read on the Desk port.** `ports/desk.ts` has two findings writers (`publishFinding`, `publishBuildFinding`) and no reader. Add one operation that returns the findings a desk's three monitor logs currently hold. Implement it in `adapters/desk/desk-fs.ts` and `desk-fixture.ts`. The parse and the reduction (skip lines that are not a valid `Finding`, last line per slot wins, a `clear` drops the slot, `currentFindings`) move out of `findings.ts` into one domain function that the adapter calls. Keep the 256 KiB tail bound and the named log files (`MONITOR_LOGS`); the named list is deliberate, because a glob would read an agent's own output.
2. **The board reads through it.** `findingsInLog` and `findingsFor` in `board/src/server/findings.ts` call the new domain function or the port, so there is one parser. The branch filter in `findingsFor` stays: a finding counts only where it names the branch being asked about.
3. **The relay.** A function in `packages/fleet/src/shared/` (a new file, in the shape of `index-monitor.ts`) takes a world: the desks (path and checked-out branch), the Desk read, the channel (`findings`, `publish`) and a log line writer. It runs on the fleetd tick, publishes each desk finding that differs from the channel's slot, and publishes `clear` for each slot whose desk or finding is gone. `registryd-main.ts` runs it where the tick runs, next to the existing wiring and with the edit kept small.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The relay runs on the tick and not on the PR clock.** The IndexMonitor runs in the `prs` callback of `startFleetClock`, which follows the PR refresh. A desk finding is not a host reading: `owes a review` must reach a subscriber within one tick (`TICK_INTERVAL_MS = 60_000`, `entry/registryd.ts:76`), and hanging the relay on the PR cadence would delay it by minutes. The cost is one small file read per desk per tick, which is the read the board already makes; the relay adds no host call. Do not add one.

**The monitors and their files do not change.** The board's file read is a deliberate fallback so that a finding shows with no channel running (`board/src/server/findings.ts:3-15`). The relay adds timing, not a second source. Do not edit `plot-agent-monitor.sh`, `plot-worker-loop.sh` or `desk-monitors` code.

**A relayed finding keeps its own monitor, its own `since` and its own `measuredAt`.** The relay measures nothing. It must not rewrite the monitor to `IndexMonitor` and must not re-stamp `measuredAt`: `since` is when the finding first held, which a subscriber needs. Wave 3 made `lastSeen` the time the channel received a reading, so a relayed old finding does not make a live monitor read as silent. The reverse also holds, and it is the decision to keep: **the relay never calls `seen`** for WorkerMonitor, AgentMonitor or BuildMonitor. A relayed file line proves a monitor wrote once, not that it is alive now. The heartbeat for those three stays as it is (silent when they never published on the socket).

**Compare against the channel, as wave 3 does.** The relay reads `channel.findings()` and publishes the difference. There is no second memory of what was relayed, so a restart republishes the current desk state with no special case. **The comparison covers `finding` and `evidence` and excludes `since` and `measuredAt`**, the rule `diffFindings` (`rules/index-findings.ts`) states. The relay's slots are the three desk monitors' only. `diffFindings` already restricts itself to `IndexMonitor` (`f.monitor === MONITOR`), so neither diff touches the other's slots; do not reuse `diffFindings` for the relay by widening it, and do not let the relay clear an `IndexMonitor` slot.

**A desk contributes a finding only where it names the desk's checked-out branch.** This is the board's own test and the reason it is there: a worktree can be switched to another branch while its logs stay, and a leftover log would attribute one branch's debt to another. Take the desk list and each desk's branch from the trees port (`trees.list()`, `Worktree.path` and `.branch`; `''` is a detached head and contributes nothing). Two desks that both hold a finding for the same monitor and branch share a slot; the newest `measuredAt` wins. State that rule in the code and test it.

**Unreadable is not empty.** A failed `trees.list()` publishes nothing and clears nothing. A desk whose log cannot be read keeps its held slots. Only a successful read of the estate that no longer holds a desk or a finding clears its slot. This is the rule wave 3 holds for the index ("a store that cannot be read is not a store with no PRs"), and the relay breaks it first if it answers `[]` for a failure. The channel's `clear` goes only to slots whose monitor is one of the three desk monitors.

**When a desk disappears, its slots are cleared.** The plan says so in these words. A removed worktree, a branch checked out elsewhere and a monitor that wrote `clear` all mean the same thing to a subscriber: the slot no longer holds. A subscriber waiting `until clear`, if it exists, depends on it.

**Evidence is carried verbatim.** The relay adds no facts. If a desk finding's evidence names a timestamp that changes per line, the comparison republishes; that is the monitor's fault, not a reason for the relay to rewrite evidence. Report it if you find one.

**Attention is untouched.** `owes an answer`, `owes a review` and `build failed` are already errands in `rules/attention.ts`, and the board derives its lists from the file read. The relay must not change a list, and no board payload field changes in this wave. Wave 5 is where the page hears the channel.

**Audit is the existing log.** One line per publish and per clear through the `fleetd.log` `processLog`, in the shape `index-monitor.ts`'s `line` writes (`plot-fleetd: desk-relay publish <monitor> <branch>: <finding> (<evidence>)`). No event file.

**Rules carried from the index work, so they are not rediscovered by breaking them:**

- Absent is not false. A desk with no logs contributes nothing and is not an error; a branch checked out nowhere on this machine claims nothing about a machine it cannot see.
- Channel failure never stops fleetd. `channel` is `null` under `--once` and when the bind failed; the relay is not constructed then, and the tick runs as before. A test covers `channel === null`.
- A relay that throws must not end the tick. Catch at the wiring, warn once per failure, and continue, the way `readDefaultBranch` does.
- Arrow functions for everything you write, tests included. No `.default()` in a schema; optional fields stay absent, never `''`. `Worker` vocabulary is for the process: new names say `desk` and `agent`.
- `packages/fleet` cannot import `packages/board`; that is why the read moves into the domain.

### Done when

The plan's wave line is the specification: a subscriber waiting `until owes a review` receives it after a fixture desk's AgentMonitor file gains that line, a removed desk's slots receive `clear`, and the board's findings tests pass through the new Desk read.

The assertions that exist because a naive implementation would pass without them:

- **Two ticks with an unchanged file: the second publishes nothing.** Count the subscriber's received messages. Catches a relay that republishes every tick, which sends a message per desk per minute.
- **The same line with a later `measuredAt` and the same `finding` and `evidence`: no publish.** Catches a comparison that includes the timestamps.
- **The same finding word with new evidence: one publish.** Catches a comparison on the word alone.
- **A desk whose log gains `clear`: the slot receives `clear`.** And a desk removed from `trees.list()`: its slots receive `clear`. Catches a relay that can only add.
- **`trees.list()` fails, or a log is unreadable: a held finding stays held.** Hold an `owes a review`, fail the read, run, and assert the slot is untouched. Catches `[]` read as "no desks".
- **A worktree switched to another branch while its log stays.** The leftover finding is not relayed. Catches a relay that trusts the file's `branch` over the desk's.
- **A detached head contributes nothing.**
- **The relay clears no `IndexMonitor` slot,** and the IndexMonitor's run clears no relayed slot. Hold one of each, run both, and assert each other's slots are intact. Catches a clear keyed on branch alone.
- **The relay never moves `lastSeen`.** After a relay that publishes, the heartbeat for WorkerMonitor, AgentMonitor and BuildMonitor reads as before. Catches a `seen` call added for symmetry with wave 3.
- **A relayed finding keeps its `since` and `measuredAt`.** Catches a re-stamp.
- **End to end on a real socket.** A subscriber with the purpose `until owes a review` joins first, a fixture desk's AgentMonitor file gains the line, one relay run later the subscriber is served. Use a socket path under the test's own temp directory and wait on the server's close or a message, not a sleep.
- **Board parity.** The board's existing findings tests pass through the new read, and a test feeds one fixture log to the board's reader and to the relay's read and asserts they return equal findings. Catches a second parser.
- **`channel === null`:** the tick runs with no relay and no throw.
- **The monitors' files are unchanged:** no edit under `skills/plot/scripts/` and no `.sh` file in the diff.

Mutation-test the gates you add: break the evidence comparison, the branch filter and the unreadable-is-not-empty rule in place, and read the failures before you trust the tests (`mutation-test-a-gate-before-believing-its-tests`). Commit before you mutate.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. This slice touches `packages/domain`, `packages/fleet` and `packages/board/src`, so expect the domain, fleet and board vitest runs, the `tsc --noEmit` projects and the `scripts/check-*.sh` gates on the list; the root `pnpm run typecheck` skips the domain and fleet packages. Do not run board tests while an operator's board is open on this machine; the local checks command prints the board suites, and `scripts/owned-run.sh` isolates them.

**Shell-line gate.** `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, the growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

**Other gates:**

- A changeset in `.changeset/` for package `plot`, description first and the `bumps:` block last, with `plan: docs/plans/2026-10-09-the-fleet-reports-what-changed-on-the-host.md` inside the comment block. Run `./scripts/check-changeset-packages.sh`.
- The one-spawn ratchet (*One place reaches a process*, `ci.yml`) counts `spawn` and `execFile` in `*.ts`. This slice reads files and adds none; the count must not grow.
- `pnpm build:board` only to test locally. The fleetd bundle under `skills/plot/scripts/board/` is generated: restore every generated path from the merge base before you push (`scripts/check-no-bundle-diff.sh`), and never commit a rebuild.
- If `CLAUDE.md` needs a word changed (the part-3 row of *A Decision Reads The Index* already names the IndexMonitor after wave 3), edit it, run `./scripts/check-agents-md.sh --write`, and confirm with `./scripts/check-agents-md.sh`. Do not edit `AGENTS.md` by hand. If nothing is false after this wave, change nothing.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.
- Where a project board is configured, set the new PR to "Ready" with `../plot/scripts/plot-update-board.sh <pr-url> "Ready" <owner> <number>`; skip it otherwise.
- Do not edit the plan's `State:` line or any `Started:` record by hand; `plot-state-gate.sh` refuses it.

### Scope guard

This branch owns:

- `packages/domain/src/ports/desk.ts`, `adapters/desk/desk-fs.ts`, `adapters/desk/desk-fixture.ts`, the new domain function for the log read, and their tests
- `packages/board/src/server/findings.ts` and its tests, and the one call at `packages/board/src/server/fleet.ts:5700` only if the signature forces it
- `packages/fleet/src/shared/` — a new file for the relay and its world
- `packages/fleet/src/server/entry/registryd-main.ts` — construct the relay beside `indexMonitorOver` and run it on the tick. Keep the edit to those two sites.
- the changeset

Branches in flight: waves 5 to 8 have no branch yet, and wave 8 waits on `feature/the-controllers-are-commands` (plan `the-fleet-runs-without-the-board`), which edits `packages/fleet/build.mjs` and `packages/board/src/contract/bundles.generated.ts`. This branch adds no entry point and edits neither file. Check `git ls-remote --heads origin` and `gh pr list` for open PRs on `registryd-main.ts`, `ports/desk.ts` or `board/src/server/findings.ts` before you start; none was known when this brief was written.

Out of scope, owned by later waves, and not to be started here:

- `/api/events`, any board subscription or page change (wave 5), `defaultBranchStatus` and badge changes (wave 6), the mod (wave 7), the merge controller and `--match-head` (wave 8).
- Any change to the IndexMonitor, `diffFindings`, the PR index or the default-branch reading (waves 1 to 3, merged).
- A new finding name, a new monitor name or a change to `READINGS`.

If you find something the plan did not anticipate, report it rather than improvising outside scope. Two cases to expect: `fleet.ts:5700` sits in a synchronous payload build, so moving the board onto an asynchronous port read may ripple past that function. If it does, keep the board's synchronous read and have it call the same domain parse function, say so in the PR description, and do not widen the payload builder. And if the desk list is not reachable from the tick without a new git call, report that rather than adding a spawn.
