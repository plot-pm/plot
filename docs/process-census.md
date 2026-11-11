# Process census

The process census counts the program images (`execve` and `execveat`) that the board, fleetd and the desk monitors start in fixed scenarios. CI's `census-head`, `census-base` and `census-compare` jobs run it on every change that touches the product and fails a pull request whose count grows past the merge base. Plan: [`2026-11-08-process-census-gate`](plans/2026-11-08-process-census-gate.md). Story: [`nothing-changed-nothing-runs`](stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md).

## Files

All files are test infrastructure under `packages/fleet/test/census/`, and none ships.

| File | Role |
|---|---|
| `strace-execs.ts` | `parseStraceExecs(text)`: one record per started image, with pid, parent pid, path and argv |
| `strace-run.ts` | `traceExecs(command, args)`: runs a command tree under `strace -f` and returns the records; `censusGate` and `findStrace` |
| `census-report.ts` | The report contract below: `recordCensus`, `productRoot`, `readCensusReport`, `compareCensus` |
| `census-gate.mjs` | The comparison CLI that CI runs |
| `vitest.census.config.ts` | Runs `*.census.test.ts` only; `pnpm --filter @plot-pm/fleet run test:census` |
| `census-setup.ts` | Fails the run by name on Linux without `strace`; prints one skip line on macOS |

## The report contract

A census row records each count it measures with `recordCensus` from `census-report.ts`:

```ts
import { productRoot, recordCensus } from './census-report.js';

recordCensus({
  id: 'S4',                                        // S1..S7, P2..P4, P6, P7 or D1
  fixture: { desks: 3, openPrs: 5, host: 'github' }, // host: 'github' | 'bitbucket'
  count: perPass,                                  // the measured figure, in `unit`
  unit: 'execve per pass',
  tolerance: { ratio: 0.1, plus: 2 },              // or 'strict'; absent means 'strict'
  execs,                                           // the ExecRecord[] the count was taken over
});
```

- `recordCensus` appends one JSON line to the file that `PLOT_CENSUS_REPORT` names. With the variable unset it writes nothing, so a local `test:census` run records nothing.
- A row records its count **before** it asserts, so an `it.fails` row still records it.
- `execs` gives the per-command figures that a failure lists. A command key is the image's basename plus the basename of its first argument when that argument is not an option: `git rev-parse`, `bash plot-host.sh`, `sleep`.
- One scenario on one fixture is one comparison key (`S4 github desks=3 prs=5`). A row that records the same key twice keeps the last entry.
- A structural zero takes `'strict'`. The gate holds it to no growth while the merge base reads 0, and to the noise tolerance while the merge base reads more. A measured count that jitters on a loaded runner takes `{ ratio, plus }`.

### The product under test

The rows always come from HEAD. Only the product differs between the two runs: the shipped scripts under `skills/plot/scripts/` and the built bundles under `skills/plot/scripts/board/`. A row finds the product through `productRoot()`, which returns `PLOT_CENSUS_PRODUCT`, or this checkout's root when the variable is unset.

A row must resolve every script, bundle and product source module from `productRoot()`, never from its own `import.meta.url`. A row that imports fleetd's `run` imports it as `join(productRoot(), 'packages/fleet/src/…')`. The merge-base worktree has its own `node_modules` and built bundles, so that import resolves there. Where the merge base lacks a seam the row needs, the row throws in that run, records nothing, and the comparison prints "no before" for it.

## Retired and added rows

| Row | Claim | State |
|---|---|---|
| P1 | an AgentMonitor over one live, idle desk starts no `sleep` | Retired by `liveness-token`, slice *Monitor in fleetd*: its fixture started `plot-agent-monitor.sh`, which that slice removes. fleetd writes the AgentMonitor's findings from its own pass, and the worker wrapper runs the final pass where no fleetd heartbeat is live. |
| P6 | an idle desk with a live agent starts no monitor process | Added by the same slice, in `dispatch.census.test.ts`: over D1's launch, with the agent live and idle for 2 s before it ends, no image is a `*-monitor.sh` script. |
| P7 | an idle fleetd pass starts no `git rev-parse --git-dir` | Added by `triggers-replace-the-tick`, slice *Fleet size*, in `fleetd.census.test.ts`: over the two idle passes of each fixture, no image in fleetd's tree is `git rev-parse --git-dir`. The machine probe (`machine-system.ts`) runs only on a relaunch verdict, a startable slice, an eligible slice for auto-dispatch, or a fixer, verify or spec start that every other gate admits (`auto-writes.ts`). |

## The comparison

`census-gate.mjs` runs the census twice and compares the two reports:

1. It runs the rows from HEAD against HEAD's product, with `PLOT_CENSUS_REPORT` set to a temporary `head.jsonl`. HEAD's product must already be built.
2. It adds a detached worktree at the "before" commit, runs `pnpm install --frozen-lockfile && pnpm run build:board` there, and runs the rows from HEAD again with `PLOT_CENSUS_PRODUCT` set to that worktree. The exit code of this run does not count.
3. It compares the two reports and removes the worktree and its temporary directory.

The "before" is `git merge-base HEAD <ref>` with `--base <ref>`, or the commit itself with `--before <sha>`.

| Case | Result |
|---|---|
| HEAD count ≤ allowed count | `ok` line, passes |
| HEAD count > allowed count | `FAIL` line with the key (scenario and fixture size), both counts, the tolerance, the limit, and the five command keys whose count grew most |
| The merge base recorded no entry for the key | one "no before" line, passes |
| The census run against HEAD exits non-zero | fails |
| The "before" tree does not build | a warning line; every key reads "no before" |

The allowed count is `base × (1 + ratio) + plus` for a `{ ratio, plus }` tolerance. A `'strict'` row whose merge-base count is 0 allows 0, so it fails on any count above 0, also while it is still an `it.fails` row. A `'strict'` row whose merge-base count is above 0 takes the noise tolerance `NOISE_TOLERANCE` from `census-report.ts`, 10 % + 2, and its line reads `tolerance strict→noise 10 % + 2 (base > 0)`. A count over a wall-clock window jitters on a loaded runner, and a zero does not: on sprint PR #3237, S3 read 1428 and 1429 execve per minute and P1 read 58.684 and 58.698, and S1 and S2 read 102 and 111 across two runs of the same code. A row with an explicit `{ ratio, plus }` keeps it.

The gate stores no number. Every "before" count comes from a run of the merge base, so `grep` finds no baseline count in `packages/fleet/test/census/` or in `.github/workflows/ci.yml`.

Run it locally, from the repository root, on Linux with `strace`:

```bash
pnpm run build:board
node packages/fleet/test/census/census-gate.mjs --base origin/main
```

## CI

The census jobs in `.github/workflows/ci.yml` run on `ubuntu-latest`. `census-head` and `census-base` run in parallel after `gates` and `checks` and each upload a report as an artifact; `census-compare` downloads both and runs `census-gate.mjs --compare`:

- The `select` job sets `census` to `true` for a `packages/board`, `packages/domain` or `packages/fleet` check (the rows live under `packages/fleet/test/census/`), for a changed path under `skills/plot/scripts/`, and for every change that selects every job. A push to `main` and a dispatched run select it always.
- One step installs `strace` with `apt-get` when the image lacks it and logs that. A second step reads `kernel.yama.ptrace_scope`, lowers 2 to 1 with a log line, fails by name on 3, and traces a two-level tree once.
- A third step starts the runner user's systemd manager (`loginctl enable-linger`), exports `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` to later steps, and fails by name unless `systemd-run --user` starts a transient service that systemd gives an `INVOCATION_ID`.
- A pull request compares with `git merge-base HEAD origin/<base branch>`. A push to `main` compares with the event's `before` SHA. A dispatched run compares with `main`.
- The jobs are not in `validate`'s `needs:` and are not required checks.
- Each half has a 20-minute step cap and a 25-minute job cap; `census-compare` has a 5-minute job cap. On the first Linux run (PR #3237, 2026-11-08) the census against HEAD took 830 s, and the steps before it 32 s.

## The fixtures

- The sandbox sets no `PLOT_PR_INDEX_HOME` and no `PLOT_ISSUE_INDEX_HOME`. The PR index, the reader lock and the issue index resolve from the sandbox repository's common git dir, as on an operator's machine, so the census counts the `git rev-parse --git-common-dir` that P3 and P4 name.
- The sandbox drops the systemd unit variables (`INVOCATION_ID`, `JOURNAL_STREAM`, `SYSTEMD_EXEC_PID`, `MANAGERPID`, `NOTIFY_SOCKET`). The CI runner's own unit sets them for every step, and a fleetd started by hand would inherit them and read as supervised.
- S3 starts fleetd as a transient service of the user's systemd manager (`systemd-run --user --pipe`), as an operator runs it (jwloka, 2026-11-09). Its heartbeat reads `supervised: systemd`, and a row of S3's suite asserts it. fleetd stays untraced: it is not a descendant of the traced board host.
- The board counts P3 over S3's window, where an attached page runs its pulse. With no page attached the board runs no pass after its first read, so S1's window cannot show P3.
- `board-host.mjs` stops the board's process group and every descendant it lists by pid, and waits until each has exited. The PR reader that the board starts runs in its own process group.

## macOS: the manual measurement

`syspolicyd` checks every new image on macOS, and Linux `execve` is the accepted proxy for that cost (jwloka, 2026-11-05). macOS has no `strace`, and exact counting needs root, so the operator's macOS figure is a manual measurement:

1. Stop every board and fleetd except the one under measurement, and record the desk count and the open PR count.
2. Give the terminal Full Disk Access (System Settings › Privacy & Security), which `eslogger` requires.
3. Record 60 seconds of exec events:

   ```bash
   sudo eslogger exec > exec.ndjson & pid=$!; sleep 60; sudo kill "$pid"
   ```

4. Count the images and the top commands:

   ```bash
   wc -l < exec.ndjson
   jq -r '.event.exec.target.executable.path' exec.ndjson | xargs -n1 basename | sort | uniq -c | sort -rn | head
   ```

5. Record the figure with its date, machine, desk count, open PR count and the processes that ran, in the story's Measures table.

`eslogger` sees every exec on the machine. Filter by the board's and fleetd's process trees (`.process.ppid` against their pids) when other software runs.
