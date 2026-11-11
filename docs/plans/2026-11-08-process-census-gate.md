# A CI gate counts the processes the board and fleetd start

> A Linux CI job runs the board, fleetd and N desks under `strace -f` in recorded fixtures, counts `execve` per named scenario, and compares each count against the merge base. Every zero target is an expected failure that a later plan turns into a required pass.

## Status

- **State:** Delivered
- **Type:** infra
- **Sprint:** nothing-runs
- **Issue:** #3170
- **Story:** nothing-changed-nothing-runs
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3238 merged
- **Delivered:** 2026-11-08

## Changelog

- CI counts the new processes that the board, fleetd and the desk monitors start in fixed scenarios (an idle board with no tab, an idle fleetd pass, one desk commit, one PR whose CI turns green), on GitHub and Bitbucket fixtures, and refuses a pull request whose count grows past the merge base.

Board impact: none on the plan format, the template or `docs/plans`. The gate starts the built board server and the `plot-fleetd.mjs` bundle as they ship; it changes neither.

## Motivation

On 2026-11-05 the operator's 16-core machine ran at load 13–17 for hours. `syspolicyd` used about 80 % CPU and `trustd` about 20 %, because macOS checks every new process image. Three boards and three fleetds started about 225 processes per second. Exemptions under Developer Tools and a `syspolicyd` restart changed nothing that lasted (story, Key Findings). Only fewer processes lower the cost.

With only the plot repository's board and fleetd running, a 20-second sample counted about 1,800 new processes: about 900 `bash`, 315 `sleep`, about 200 `git`, about 200 text tools and about 46 `node`. A 30-second sample of direct children counted about 75 under an idle board and about 160 under fleetd. The sample names no instrument and records no desk or PR count, so nobody can reproduce it, and nothing in CI notices when a change adds a process to a loop.

Two earlier plans counted processes with `PATH` shims: `packages/board/test/plan-read-shape.test.mjs` (a `git` and a `bash` shim) and `the-agent-reporter-starts-a-sleep` (a shim per external name). A shim sees only the names it shadows and misses an absolute path. The story's Phases 2 to 8 each claim a lower count, and each needs one instrument that sees every new image and one reproducible fixture to show its number.

## Design

### Approach

**The counted unit is `execve`.** `syspolicyd` checks each new program image, so the gate counts `execve` and `execveat` events. A fork without `exec` is recorded as a secondary figure and never gated. Each record holds the pid, the parent pid, the image path and the argv, so an assertion can filter by command (`sleep`, `git rev-parse --show-toplevel`, `bash -c kill -0 …`) and by parent (a direct child of the node process).

**The instrument is `strace -f` on Linux CI.** `strace -f -qq -e trace=execve,execveat,clone,clone3,fork,vfork -o <file>` follows every descendant, the detached `nohup sh -c` worker wrapper (`plot-dispatch.sh:1507`) included. Linux `execve` is the accepted proxy for the macOS `syspolicyd` cost (jwloka, 2026-11-05, reconfirmed 2026-11-08). The operator's macOS figure comes from a documented manual measurement in `docs/process-census.md`; exact counting on macOS needs root. A step checks that `strace` is present before any scenario runs and fails the job by name when it is absent. On macOS the census suite skips with one line that names the missing `strace`.

**The parser is a pure function.** `parseStraceExecs(text)` turns an `strace -f` log into records and attributes each `execve` to its parent through the `clone`/`fork` lines. It is an arrow function with unit tests over recorded `strace` output, including an `execve` that fails with `ENOENT` (a `PATH` search), which the census does not count because no image starts.

**Scenarios.** Each scenario states its fixture size beside its number: desks, open PRs, host. All scenarios run on a GitHub fixture; the idle-fleetd and idle-board scenarios also run on a Bitbucket fixture.

| Id | Scenario | Window | Target | Turned green by |
|---|---|---|---|---|
| S1 | Idle board, no SSE client, no fleetd | `execve` per minute, after a warm first read | 0 | `no-tab-no-pulse`, slice *Server pulse* |
| S2 | Idle board, one page that turns hidden, no fleetd | `execve` per minute after the hide | 0 | `no-tab-no-pulse`, slice *Hidden page* |
| S3 | Idle board, one visible SSE client, fleetd running | `execve` per minute | 0 | Phase 4 (`board-reads-the-channel`); stays expected-failing here |
| S4 | Idle fleetd, N desks, M open PRs | `execve` per completed pass of all four loops | 0 | Phase 8 (`triggers-replace-the-tick`); stays expected-failing here |
| S5 | One desk commit | `execve` per change | measured, then held with a tolerance | — |
| S6 | One PR whose CI turns green | `execve` per change | measured, then held with a tolerance | — |

**Per-source assertions.** S1 to S4 reach zero only after several plans, so each Phase 2 item gets an assertion of its own that its slice can turn green alone:

| Id | Assertion | Target | Turned green by |
|---|---|---|---|
| P1 | An AgentMonitor over one live, idle desk starts no `sleep` | 0 per minute | `monitors-nap-without-sleep`, slice *Builtin nap* |
| P2 | An idle fleetd pass over a desk with a live pid file starts no `bash` whose argv is `-c kill -0 …` | 0 per pass | `monitors-nap-without-sleep`, slice *Liveness syscall* |
| P3 | After its first pass, neither fleetd nor the board starts, as a direct child of its node process, `git rev-parse` with `--show-toplevel` or `--git-common-dir`, or `bash …/plot-host.sh backend` | 0 per pass | `fixed-answers-once`, slice *Answers in process* |
| P4 | After the first pass, no process in the tree starts `git rev-parse` with `--show-toplevel` or `--git-common-dir` | 0 per pass | `fixed-answers-once`, slice *Answers in scripts* |

**Zero targets start as expected failures.** Every zero row above is written as `it.fails` in vitest. A zero that a slice reaches makes its `it.fails` row fail, so that slice must change the row to `it`, and from then on the row is a required pass. The row names its plan and slice in its title, so the failure says which plan to read.

**The gate compares against the merge base and stores no number.** As `scripts/check-shell-lines.sh` does, the CI job reads the "before" from git: it adds a worktree at `git merge-base HEAD origin/main`, builds its bundles there, and runs HEAD's scenarios against both trees. The harness and the scenarios always come from HEAD; only the product under test (the shipped scripts and built bundles) differs. A non-zero count may carry a tolerance stated in the scenario file as a ratio (for example 10 % of the merge-base count, plus 2), because retries and back-off jitter on a loaded runner. A structural zero has no tolerance. A failed comparison prints the scenario, the fixture size, both counts, the tolerance and the five commands whose count grew most.

**fleetd is measured per completed pass, not with `--once`.** `--once` builds no idle reader (`registryd-main.ts:2841-2849`), so it is not the measured mode. fleetd runs four loops: the tick, the scan, the PR reader and the issue reader (`registryd-main.ts:3251-3254`). The scan, PR and issue loops run on `startFleetClock(seams.clock ?? clockSystem(), …)` (`registryd-main.ts:3062`); a census entry under `packages/fleet/test/census/` starts `run` with `clockManual` and advances the clock on a line from stdin. The tick waits on `sleep(args.intervalMs)` (`registryd-main.ts:3131`), not on the clock, so a pass is delimited by the tick's log line from `reportTick` (`registryd-main.ts:3274`). The board's pulse takes no injected clock (`startPulse(clockSystem(), REFRESH_MS)`, `fleet.ts:3232`), so the board scenarios count over a wall-clock window and report per minute.

**Fixtures.** A sandbox repository with a `## Plot Config`, N desks, and stubs on `PATH`:

- GitHub: a stub `gh` that answers `pr list`, `api graphql`, `run list` and `issue list` from fixture files and logs nothing to the network. `plot-host.sh` reaches it through `command gh` (`plot-host.sh:3863`).
- Bitbucket: a stub `bb` (`plot-host.sh:3872`) and a stub tracker.
- Desks: a stub worker that starts nothing while it runs, for example a `read` on a FIFO the test holds. The stub never starts a process, so the count holds only Plot's own processes.
- After Phase 7 the stubs become an injectable base URL and a local HTTPS server, because a `PATH` stub does not see an in-process call. This plan builds only the `PATH` stubs.

**Placement.** The census is test infrastructure, not shipped code: `packages/fleet/test/census/` with its own `vitest.census.config.ts`, outside the default `include`, so `vitest related` in a local check does not run it. It is CI's gate, like `test:e2e`, and stays out of `plot-local-checks.mjs`: it starts a real board and a real fleetd. Every test removes its sandbox by the exact name `mkdtempSync` returned and waits for each process it started, by pid.

**CI.** A new job `process-census` on `ubuntu-latest`, `needs: select`, with its own `timeout-minutes`. The `select` job maps changes under `packages/board/**`, `packages/fleet/**`, `packages/domain/**`, `skills/plot/scripts/**` and `test/census/**` to it; a push to `main` runs it always.

**The baseline.** The third slice records the first counts on `main`, GitHub and Bitbucket, with fixture sizes, in the story's Measures table and in its Session Log.

### Open Questions

- [ ] Does `ubuntu-latest` ship `strace`, and does `kernel.yama.ptrace_scope` allow tracing the job's own descendants? The presence step answers the first; if `strace` is absent the job installs it with `apt-get` and says so in the log, or fails by name.
- [ ] S2 needs a page that turns hidden. Either the census job runs a headless browser and hides the page, or the census drives an SSE client that follows the page's protocol and the page behaviour is proven in the board's browser tests. The first is closer to the claim; the second keeps the census job free of a browser.
- [ ] P2 is meaningful only where an idle pass reaches `processes.isAlive` (`registryd-main.ts:584`, `:995`). The fixture must hold a desk with a live `.plot-worker.pid`; a scenario that never reaches the call would let `it.fails` break for the wrong reason.
- [ ] Fixture sizes: the proposal is N = 0 and N = 3 desks, M = 5 open PRs. A larger N lengthens the job.
- [ ] The merge base can lack a seam the HEAD harness needs (for example a census entry that a later change renames). The proposal: the comparison reports "no before" for that scenario and passes it with one printed line; a person reads it.
- [ ] Which stub answers the tracker on the Bitbucket fixture depends on how `issue-refresh.ts` reaches the tracker; the scenarios slice names it.

## Done when

| Claim | Check | Slice |
|---|---|---|
| The parser counts every `execve` and attributes its parent | unit rows over recorded `strace -f` text: a three-level tree, a failed `ENOENT` exec not counted, an `execveat`, a fork with no exec recorded as secondary | Harness |
| A missing `strace` fails the job by name | the presence step with `strace` removed from `PATH` | Harness |
| Each scenario prints its fixture size beside its count | the census report for S1 to S6 | Scenarios |
| Every zero target is an expected failure | S1 to S4 and P1 to P4 are `it.fails` rows, and each title names its plan and slice | Scenarios |
| A stub worker starts nothing | the count under one stub desk with the board and fleetd stopped is 0 | Scenarios |
| The gate refuses a grown count | a test commit that adds one `git` call per fleetd pass fails S4's comparison and names `git` | CI gate |
| A zero has no tolerance | a test commit that adds one `sleep` to the monitor loop fails P1 | CI gate |
| The gate stores no number | `grep` finds no baseline count in the census files or the workflow | CI gate |
| The baseline is recorded | the story's Measures table holds GitHub and Bitbucket figures with fixture sizes | CI gate |

## Slices

### Harness

- `infra/process-census-harness` — `packages/fleet/test/census/`: `parseStraceExecs` and its unit rows, the helper that runs a command tree under `strace -f` and returns records, the presence check, `vitest.census.config.ts`; a changeset for `plot` <!-- builds: parseStraceExecs, an strace execve census helper --> → #3243

### Scenarios

- `infra/process-census-scenarios` — the sandbox fixtures (stub `gh`, stub `bb`, stub tracker, stub worker on a FIFO), the census entry that runs fleetd's `run` on `clockManual`, scenarios S1 to S6 and assertions P1 to P4, every zero as `it.fails`; a changeset for `plot` <!-- builds: the process census scenarios and their stub fixtures --> → #3253

### CI gate

- `infra/process-census-ci-gate` — the `process-census` job in `.github/workflows/ci.yml`, the `select` mapping, the merge-base worktree run and the comparison with tolerances, `docs/process-census.md` with the macOS manual measurement, the baseline in the story; a changeset for `plot` <!-- builds: the process-census CI job and its merge-base comparison -->

## Notes

- Phase 1 of the story [`nothing-changed-nothing-runs`](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md). The three Phase 2 plans (`no-tab-no-pulse`, `monitors-nap-without-sleep`, `fixed-answers-once`) depend on this plan: each turns one or two of its `it.fails` rows into required passes.
- Line numbers checked against `origin/sprint/nothing-runs` on 2026-11-08. The story cites `registryd-main.ts:3221-3224` for the four loops and `:2804-2811` for `--once`; they are now `:3251-3254` and `:2841-2849`. The story names `startPulse(clockSystem(), …)` as fleetd's injected clock; fleetd uses `startFleetClock(seams.clock ?? clockSystem(), …)` at `:3062`, and `startPulse(clockSystem(), …)` is the board's, with no seam (`fleet.ts:3232`).
- Definition of Done: docs/definition-of-done.md.
