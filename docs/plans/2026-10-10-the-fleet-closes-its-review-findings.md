# The fleet closes its review findings

> `plot-fleetctl.sh --status` answers within the board's bound and reads a free agent as running, and the open review findings on the fleet's supervisor, its logs, its endings and its queue are fixed or recorded as kept.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-gates-and-the-review-findings
- **Issue:** #1436, #1438, #1439, #1440, #1441, #1443, #1445, #1450, #1453, #1454, #1487
- **Review:** pr
- **Impl:** own branches

## Changelog

- The board no longer shows FLEET STOPPED while the fleet runs. A `--status` run that the board stops at its bound reads as *fleet status unknown*, and `--status` no longer waits on `lsof`.
- `/plot-fleet --status` lists a free agent in its free wait as running, and `--status`, `--stop` and `--start` agree on which agents run on the machine.
- `/plot-fleet --once` prints its tick and its holds on the terminal again.
- A slice whose agent was killed, or ended quiet with work on its branch, gets one fresh agent, in the way a timed-out slice does.
- The supervisor no longer holds slices of Released or Delivered plans on `waits`.
- The fleet writes the scan bridge once per scan, the board writes no PR index, and the board shows the fleet's PR reader error.
- A delivery that fails leaves no mark that blocks its retry.
- The supervisor unit runs the harness `--start` names, not a copy in node's directory.

<!-- Board impact: the board's supervisor reading (packages/board/src/server/supervisor-reading.ts) gains the timed-out fact, and the domain rule supervisorState reads it. No change to the plan format, the plan template or the docs/plans layout. Generated bundles under skills/plot/scripts/board/ are rebuilt by main after each merge. -->

## Motivation

On 2026-10-10 the operator's board showed "FLEET STOPPED … 3 agents are running" while `launchctl` reported `com.plot-pm.fleetd` running as pid 94477 and `.plot/logs/fleetd.log` ticked. `plot-fleetctl.sh --status` took over 120 s with 3 desks. The same run printed the three free agents as `finished` while their loops ran. Eleven issues of review findings on the fleet are open beside it. This plan answers all of them, and puts the status defect first because it misleads the operator now.

### The status defect, measured 2026-10-10

A `bash -x` trace of `--status` (20:20 CEST, load average 19.56) shows two separate faults.

**`--status` blocks on `lsof`.** The run printed its `summary:` line and then stopped inside `plot_processes_block`, at `process_cwd` (`skills/plot/scripts/plot-fleetctl.sh:361-364`), which runs `lsof -a -p <pid> -d cwd -Fn` with no bound. At 20:2x the machine held 71 `lsof` processes in state `U` (uninterruptible wait), all reparented to launchd: 12 of them `lsof -a -p <pid> -d cwd -Fn` left by earlier `--status` runs (the oldest 5 min 34 s old), and 59 `/usr/sbin/lsof -nP -a -p …` from a caller outside this repository. A manual `lsof -a -p 45499 -d cwd -Fn` did not return within 100 s, and `SIGALRM` did not end it. A timeout cannot reclaim a process in state `U`, so each bounded `--status` run leaves one more.

**The board reads a run it killed as a stopped fleet.** `--status` prints `summary:` at `plot-fleetctl.sh:948` and only then runs the process block at `:955`. `readSupervisor` (`packages/board/src/server/supervisor-reading.ts:148-158`) stops the run at `SUPERVISOR_TIMEOUT_MS` = 5 000 ms (`:50`). The comment at `:59-61` states that `execFile` reports that kill as exit code 1. The stdout already holds the summary, so `summarised` is true and `install=running`. `supervisorState` (`packages/domain/src/rules/supervisor-reading.ts:247-254`) then answers `down`, and the verdict at `:430-437` renders FLEET STOPPED. The module's own rule is that a run stopped at its bound reads `unknown`; the summary-first order defeats it.

**A free agent reads `finished`.** For each free desk the trace shows the manifest pid alive (`kill -0 57548` succeeds, `ps etime` 04:16:00), no `claude` child under it, and the desk clean except `.plot-worker.freewait`. `plot_worker_state` (`skills/plot/scripts/plot-worker-state.sh:1319-1327`) then asks the desk, and `plot-task.mjs` answers `finished`. A free loop waits for a hand-over with no agent child by design, so the reading is wrong for every free desk. `--status` printed `agents_running=0 agents_other=4` while the three loops ran. This is the disagreement #1450 reports: `plot-dispatch.sh --start` counts any live `.plot-worker.pid` (`plot-dispatch.sh:2337-2346`) and reported 3 running. The domain already has `deskLoopAlive` (`packages/domain/src/rules/desk-loop-alive.ts`) and `FREE_WAIT_FILENAME` (`:92`); only the continuation path calls it (`packages/fleet/src/shared/continuation.ts`).

### The review findings, checked on `origin/main` at `c9d63311d`

| Issue | Finding | On main | Evidence |
|---|---|---|---|
| #1436 | a `quiet` ending with work beyond the claim gets no fresh agent | holds | `ending-action.ts:118-119` lists `quiet` under `leave` |
| #1438 M1 | the old-label migration is a shell decision | holds | `retire_old_label`, `old_label_checkout` in `plot-fleetctl.sh`, `--status` arm at `:786` |
| #1438 M2 | `'"'"'` quoting makes messages hard to read | holds | 11 `printf` lines in `plot-fleetctl.sh` |
| #1438 L1 | `plot-registryd` left in docs | partly | fixed in `registryd-main.ts` by `428dabd94`; holds at `CLAUDE.md:177`, `AGENTS.md:177`, `README.md:110`, `skills/plot-pulse/README.md:13`, `docs/definition-of-done.md:68` |
| #1438 L2 | dated measurements carry the new name | holds | `.gitattributes:43`, `ci.yml:888`, `scripts/check-bundle-attributes.sh:8`, `test/reconcile/artifact.test.mjs:260` |
| #1438 L3 | log files still `registryd.*` | **fixed** | `5181c3b2b` (#1442) opens `fleetd.log`/`fleetd.err` (`registryd-main.ts:2287-2288`) |
| #1438 L4 | `unit_name` fallback names `plot-registryd-<label>` | holds | `plot-fleetctl.sh:107-115`, arm at `:112` |
| #1438 L5 | `supervisor_bundle_path` prints awk `$1` | holds | `plot-fleetctl.sh:236` |
| #1439 | `--stop` from a linked worktree stops the main checkout's agents | holds | `resolve_wt_root` (`plot-fleetctl.sh:694-700`) asks `plot_desk_root` of the main checkout; no override |
| #1440 | a killed agent's claimed slice has no controller that restarts it | holds | a missing ending answers `leave` (`ending-action.ts:235`) |
| #1441 | `--once` prints nothing | holds | the main block passes `processLog(fleetd.log)` as the writer for every mode (`registryd-main.ts:2287-2295`); `--once` returns at `:2099` |
| #1443 M1 | the log fallback chooses by existence | holds | `plot-fleetctl.sh:499` |
| #1443 M2 | the comment names the wrong condition | holds | `plot-fleetctl.sh:494-496` |
| #1443 L1 | "Read why before restarting" names only `fleetd.log` | holds | `plot-fleetctl.sh:826`, `:866` |
| #1443 L2 | undated "exists too" | holds | `process-log.ts:21`, `test/reconcile/log-rotation.test.mjs:6` |
| #1443 L3 | wrong message on a stale bundle | holds | `log-rotation.test.mjs:292` |
| #1443 L4 | no cleanup line for old `registryd.*` logs | holds | `skills/plot/units/README.md` |
| #1443 L5 | the test matches exact source text | holds | `log-rotation.test.mjs:272-273` |
| #1450 | `--status`, `--stop` and `--start` disagree on which agents run | holds | see *The status defect*; `--restart` reads only the pid file |
| #1454 | merged slices of Released plans held on `waits` | holds | tick of 2026-10-10 still prints the 3 entries; `queue-reading.ts:263`, `:313` queue every plan; `:328-333` reads `landed` as `not-landed` for a slice with no brief |
| #1445 M1 | the fleet writes the bridge twice per scan, the first thin | holds | `fleet-clock.ts:99` passes `record: true`; `plot-fleet-scan.sh:314`, thin payload at `:5182`; `fleet-scan-clock.test.ts:85-93` asserts recording |
| #1445 M2 | the board keeps a path that writes the PR index | holds | `packages/board/src/server/fleet.ts:1655-1659` defaults `store` to `prStoreFor`; `one-pr-index-writer.test.ts:16-20` greps only `foldPrIndex` |
| #1445 M3 | the board hides a failing PR reader while a fleet runs | holds | `readPrsFromStore` (`fleet.ts:1634-1647`) |
| #1445 L1 | `--dry-run` starts the scan clock | holds | `registryd-main.ts:139` doc, `:1918` clock |
| #1445 L2 | `CLAUDE.md` names the wrong `foldPrIndex` caller | holds | `CLAUDE.md:483`, `AGENTS.md:483`; caller is `pr-refresh.ts:1275` |
| #1445 L3 | an `unknown` supervisor reading makes the board scan | holds | `scan-owner.ts:45` |
| #1445 L4 | owned-mode refresh repeats the display reads | holds | `fleet.ts:1918`, `:1926`, `:1932`, `:1770` |
| #1445 L5 | domain TSDoc narrates history | holds | `ports/fleet-state.ts:7,11,65`, `fleet-state-file.ts:12`, `scan-owner.ts:16` |
| #1445 L6 | blank lines; `--log-pulse` thin write; changeset restart note | partly | 12 blank lines before `fleet.ts:1609`; `plot-fleet-scan.sh:295`; the changeset note is **obsolete** (released and consumed) |
| #1453 M1 | delivery marks never expire | holds | `pruneDelivering` (`auto-deliver.ts:321-343`), renewed at `:598-610` |
| #1453 M2 | no test proves the `fleetAutoWrites` wiring | holds | `registryd-main.ts:1937` |
| #1453 M3 | the changeset lacks the restart note | **obsolete** | changeset released and consumed |
| #1453 L1 | `planAutoDeliver` is a pure rule outside the domain | holds | `auto-deliver.ts:258` |
| #1453 L2 | the board's `machine-reading.ts` has no caller | holds | `packages/board/src/server/machine-reading.ts` |
| #1453 L3 | the in-flight file is written every scan | holds | `auto-deliver.ts:608`, `in-flight-store.ts:210-243` |
| #1487 M1, L3 | node's directory overrides the resolved harness | holds | `plot-fleetctl.sh:1114-1118`; `com.plot-pm.fleetd.plist:66`, `plot-fleetd.service:47` |
| #1487 L1 | the dedupe of node's directory has no test | holds | `plot-fleetctl.sh:1118`; `fleetctl.test.mjs:727` covers another case |
| #1487 L2 | `$node_dir` goes into sed unescaped | holds | `plot-fleetctl.sh:1115-1119`; unquoted `Environment=PATH=` at `plot-fleetd.service:47` |
| #1487 L4 | text defects in the test | holds | `fleetctl.test.mjs:767` indent; `:745` says three placeholders, `:748` holds five |

## Design

### Approach

**Decisions move into the domain where a slice touches one.** `scripts/check-shell-lines.sh` ratchets shipped shell lines against the merge base, so each slice that changes shell removes at least as many lines as it adds. Slice 1 and slice 2 put the decision in the domain (`supervisorState`, `deskLoopAlive`) and leave the shell to collect readings.

**Slice 1 fixes the board's reading and the wait, and both halves are needed.** The board's half: `SupervisorRun` gains a `timedOut` fact from the runner, and `supervisorState` answers `unknown` for a run stopped at its bound whatever stdout holds. The script's half: `--status` takes no cwd from `lsof`. Two options, for the implementer to measure: (a) the board asks for the summary only (the process block becomes its own verb or a flag), so the board's call never reaches `lsof`; (b) `process_cwd` reads cwd from a source that cannot enter state `U`. A bounded `lsof` alone is not a fix: the hung process survives its timeout. Slice 1 makes `unknown` more frequent, so `fleetOwnsScan` (`scan-owner.ts:35`, #1445 L3) changes with it: an `unknown` reading with a bridge younger than `OWNED_BRIDGE_MAX_AGE_MS` leaves the scan to the fleet.

**Slice 2 makes one reading of "which agents run here".** A desk whose loop pid is alive and which holds `.plot-worker.freewait` reads `running`. `--status`, the `--stop` enumeration, `plot-dispatch.sh --start`'s count and `--restart`'s refusal take the same domain answer, and `--restart` refuses a desk whose loop is alive under any recorded pid (`.plot-worker.pid`, manifest `pid`, manifest `wrapperPid`), the order `deskLoopAlive` already defines.

**Slice 4 extends `endingAction`, it does not add a rule.** `quiet` with a commit beyond the claim or a dirty tree takes the `bound` row. A worker that the fleet reads `failed` with no ending file (SIGTERM, exit 143) gets an ending the tick can read, so the same row answers. The fresh-session allowance stays one per slice.

**Slice 5 filters by plan phase before any landing is read.** A slice of a Released or Delivered plan never enters the queue. A slice whose own PR merged reads `already-merged`, from the PR index or `mergedAt`, never from a ref (the three branches have no ref).

**One branch per heading, so the slices run one after another.** Each `###` heading is a wave. Slices 1, 2, 9, 10, 11 and 12 touch `plot-fleetctl.sh`; slices 3, 8 and 13 touch `registryd-main.ts`; slices 6, 7 and 8 touch the fleet's PR and scan code. No two slices that share a file run in parallel. The order puts the operator-facing defect first.

### Open Questions

- [ ] Slice 1: does the board call `--status --summary` (no process block), or does `process_cwd` change its source? The trace proves `lsof` blocks; it does not prove which other cwd source stays responsive on macOS under the same load.
- [ ] Slice 1: the 59 `/usr/sbin/lsof -nP` processes come from a caller outside this repository. Who starts them is not measured here, and Plot cannot fix it.
- [ ] Slice 2: #1450 names a loop that restarted itself under a new pid. `restartAnswer` now replaces the process through `ports.reexec.replace` (`packages/fleet/src/server/entry/worker-loop.ts:395`), which keeps the pid where `process.execve` exists. Whether the four 2026-10-10 loops ran on a Node without `execve` (pid 70519 ran Node 26.7.0) is not measured.
- [ ] Slice 12 (#1439): resolve a linked worktree's own estate, or refuse and name the estate? The issue accepts either.
- [ ] Sprint `the-gates-and-the-review-findings` has no file under `docs/sprints/` on `origin/main` at `c9d63311d`.

## Slices

### The status answers within its bound

- `bug/the-status-answers-within-its-bound` — a `--status` run the board stops at `SUPERVISOR_TIMEOUT_MS` reads `unknown`, never `down`, the board's `--status` call never waits on `lsof`, and `fleetOwnsScan` does not hand the scan to the board on an `unknown` reading while the fleet's bridge is fresh; answers #1445 L3, 2026-10-10 measurement <!-- builds: timedOut in SupervisorRun, read by supervisorState -->

### A free agent reads running

- `bug/a-free-agent-reads-running` — a live loop on a desk with `.plot-worker.freewait` reads `running`; `--status`, `--stop`, `--start` and `--restart` take one domain reading of the live agents; answers #1450 <!-- builds: deskLoopAlive as the one live-agent reading for fleetctl and dispatch -->

### The gate prints its tick

- `bug/the-gate-prints-its-tick` — under `--once` the tick line and the hold detail go to stdout and an `incomplete` tick to stderr; the log stays the looping daemon's; `skills/plot-fleet/SKILL.md` and the writer assertion at `log-rotation.test.mjs:272` follow; answers #1441 <!-- builds: a mode-chosen writer in registryd-main -->

### A dead agent gets a fresh agent

- `bug/a-dead-agent-gets-a-fresh-agent` — `endingAction` gives a `quiet` ending with work beyond the claim, and a killed worker with no ending file, the `bound` row; answers #1436, #1440 <!-- builds: quiet and killed rows of endingAction -->

### A released plan queues nothing

- `bug/a-released-plan-queues-nothing` — the queue drops slices of Released and Delivered plans before any landing is read, and a slice whose own PR merged reads `already-merged`; answers #1454 <!-- builds: a plan-phase filter in the queue reading -->

### The scan writes once

- `bug/the-scan-writes-once` — the fleet clock scans with `record: false` and its test asserts it; `--log-pulse` writes no thin bridge beside the one writer; answers #1445 M1, L6 (`--log-pulse`) <!-- builds: a single bridge write per scan -->

### The board writes no index

- `bug/the-board-writes-no-index` — `refreshPrs` takes a required store, the store-writing tests move to `packages/fleet`, the one-writer test covers `prStoreFor` and `prIndexFile`, the board shows the fleet's last PR error, owned-mode refresh skips display reads while `bridged.at` is unchanged, and the blank-line runs go; answers #1445 M2, M3, L4, L6 (blank lines) <!-- builds: the fleet's last PR error beside the index -->

### A failed delivery retries

- `bug/a-failed-delivery-retries` — a delivery mark expires when its delivery fails, `planAutoDeliver` moves into `packages/domain/src/rules/`, the in-flight file is written only on change, a test fails when the `fleetAutoWrites` wiring is removed, and the board's unused `machine-reading.ts` goes; answers #1453 M1, M2, L1, L2, L3 <!-- builds: planAutoDeliver as a domain rule -->

### The log reads the fresher file

- `bug/the-log-reads-the-fresher-file` — `tick_age_seconds` takes the newer mtime of `fleetd.log` and `registryd.log`, with a test where `fleetd.log` is older; the comments, the restart hint and the units README name `fleetd.err`, the journal and the cleanup; `log-rotation.test.mjs` loses its exact-source match; answers #1443 <!-- builds: freshness choice between the two supervisor logs -->

### The label migration leaves shell

- `bug/the-label-migration-leaves-shell` — the old-label decision moves into a domain rule that `plot-fleetctl.sh` asks; the `'"'"'` messages read plainly again; the `unit_name` fallback and `supervisor_bundle_path` are fixed; answers #1438 M1, M2, L4, L5 <!-- builds: the old-label migration rule in the domain -->

### A stop stays in its estate

- `bug/a-stop-stays-in-its-estate` — `--stop` and `--status` from a linked worktree resolve that worktree's estate or refuse and name the one they would reach, and a test points the desk root at a sandbox; answers #1439 <!-- builds: an estate check in resolve_wt_root -->

### The unit runs its harness

- `bug/the-unit-runs-its-harness` — `--start` refuses where node's directory holds a different harness than the one it resolved, or puts a fleet-owned directory of symlinks first on PATH; the placeholder values are escaped and the systemd PATH is quoted; the dedupe gets its test and the test file its text fixes; answers #1487 <!-- builds: a harness check on the unit PATH -->

### The docs name fleetd

- `bug/the-docs-name-fleetd` — `plot-registryd` leaves the five current docs, `AGENTS.md` is regenerated, and the four dated measurements say `plot-registryd.mjs (since renamed plot-fleetd.mjs)` and the domain TSDoc says what each export does; `CLAUDE.md` names `pr-refresh.ts` as the one `foldPrIndex` caller; `registryd-main.ts` documents `--dry-run` as it behaves; answers #1438 L1, L2, #1445 L1 (doc), L2, L5 <!-- builds: nothing nameable; text only -->

## Done when

Each test below fails on `origin/main` (`c9d63311d`) today:

- `supervisorState` answers `unknown` for a run with `summarised: true`, `install: 'running'`, `exitCode: 1` and `timedOut: true`.
- A `--status` run whose process block cannot finish still lets the board read `up` or `unknown`, never `down`, for a running supervisor.
- `--status` reports a desk with a live loop and `.plot-worker.freewait` as running, and `--start` and `--status` count the same agents on one fixture.
- `plot-fleetd.mjs --once` prints its tick line on stdout.
- `endingAction` answers `start-fresh` for a first `quiet` ending with a commit beyond the claim, and for a killed worker with no ending file and a clean pushed branch.
- The queue holds no slice of a Released plan on `waits`.
- `node skills/plot/scripts/board/plot-local-checks.mjs` and the commands it prints pass on each branch.

## Notes

**Created unattended, 2026-10-10**, from issues #1436 #1438 #1439 #1440 #1441 #1443 #1445 #1450 #1453 #1454 #1487 and the `--status` measurement of the same day. Type `bug`, `Review: pr`, `Impl: own branches` came from the prompt.

- Findings dropped as fixed: #1438 L3 (`5181c3b2b`, #1442). Findings dropped as obsolete: #1445 L6 and #1453 M3 (changeset restart notes; both changesets are released and consumed).
- The `--status` trace is `/Users/jwloka/.claude/jobs/ca0ab00d/tmp/status.trace` (794 lines, 2026-10-10 20:20 CEST); it ends inside `process_cwd`'s `lsof` call after the `summary:` line.
- Deliverable search, 2026-10-10: `deskLoopAlive` and `FREE_WAIT_FILENAME` exist (`packages/domain/src/rules/desk-loop-alive.ts`); slice 2 reuses them. `endingAction` exists (`packages/domain/src/rules/ending-action.ts:248`); slice 4 extends it. `pruneDelivering` exists (`packages/fleet/src/shared/auto-deliver.ts:321`). `process_cwd` exists (`plot-fleetctl.sh:361`). No other candidate matched.
- Overlapping plans: `no-controller-resumes-a-claimed-slice` (Released, v2.25.0) added the `bound` rows slice 4 extends; `the-fleet-runs-without-the-board` (Delivered) produced the findings in #1441, #1445 and #1453.
