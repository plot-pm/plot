# The worker loop runs in JS

> An agent's loop is one long-running JS process over a domain state machine; `plot-worker-loop.sh` keeps only its name, as a launcher.

## Status

- **State:** Draft
- **Type:** infra
- **Issue:** #1246, #1255, #1199
- **Review:** in-session
- **Impl:** own branches

## Changelog

- An agent's loop runs as one JS process for the agent's whole life, from `board/plot-worker-loop.mjs`. `plot-worker-loop.sh` stays as the launcher that adopting repositories name in `Worker command`.
- A domain workflow, `agentLoop`, names every state an agent's loop can be in and the step out of each. Every state has an exit.
- A prompt that ends with uncommitted or unpushed work leaves the agent holding that work. It never reads as free (#1246).
- The CI wait asks the host for the checks on the pull request's current head. It no longer depends on a BuildMonitor findings file that a continued or corrected desk never gets (#1255, #1199).
- A running loop that finds its own bundle replaced on disk restarts itself at the next point where it holds no work, so it never keeps running yesterday's code.

<!-- Board impact: none to the plan format, template or docs/plans layout. Slice 2 adds the bundle board/plot-worker-loop.mjs, declared in packages/board/build.mjs and built on main. The board reads the same manifests, logs and findings it reads today. -->

## Motivation

Measured on `main` on 2026-10-04: `skills/plot/scripts/plot-worker-loop.sh` holds 891 non-comment lines (3,137 with comments) in 52 functions. It sources four helpers: `plot-agent-manifest.sh` (94), `plot-worker-state.sh` (530), `plot-transcript-quiet.sh` (39) and `plot-tmp.sh` (87). It starts seven bundles: `plot-checkout-yield`, `plot-checks-verdict`, `plot-claim-answer`, `plot-empty-claim`, `plot-prompt-exit`, `plot-prompt` and `plot-slice-spend`. Its CI wait reads findings from `plot-build-monitor.sh` (162), a separate process that `plot-dispatch.sh` starts. 30 test files drive the loop.

`the-shell-shrinks-into-the-domain` names this script as the first follow-on plan, because the shell ratchet bites here first: the loop grew 287 lines in the three days to 2026-10-03, and every open PR that grew the shell that day edited it. The cost rule in `docs/shell-and-domain.md` is the reason it stayed shell: it runs once per agent per pass, so each decision it asks costs a `node` start, and the declared duplicates exist to avoid that.

**On 2026-10-03 and 2026-10-04, five failures came from the loop and the processes around it:**

1. An agent ended its `claude -p` turn while it waited on a background job. The loop went free with 14 uncommitted files on the desk (#1246). It happened twice: `the-queue-reads-the-scans-order` and `the-parser-reads-every-wait`.
2. A continued agent had no BuildMonitor, so its CI wait expired after 1,800 s with "no CI answer" while CI had failed (#1255, PR #1249).
3. A dispatched agent's BuildMonitor reported the first failure and missed the run after the correction. The loop let go after 3,600 s and correction 2 never ran (#1255, PR #1269).
4. An agent stopped on a `PLOT-BLOCKED` marker, its loop ended on the wait bound, and the board read exit 124 as a crash (#1250).
5. The board process ran for a day and a half on the code it loaded at start, with no reload, and kept a repair that #1263 had retired. A long-running loop has the same exposure, and this plan names the fix before it adds the process.

Each one is a decision taken in shell, or across two processes that share a file, that no unit test reaches.

## Design

### Approach

**One process per agent, over a domain state machine.** The loop becomes a JS entry, `packages/board/src/server/entry/worker-loop.ts`, bundled to `skills/plot/scripts/board/plot-worker-loop.mjs`. It runs for the agent's whole life, as the shell loop does today. Each pass reads the world through the adapters that already exist and asks one domain function what to do next. Git goes through `refs-git`, processes through the process adapter, PR checks through the host port, and manifests through the plan-store and registry adapters. The seven bundle starts per pass become imports. The cost rule's reason for the loop's declared duplicates is gone, and slice 4 removes them with their corpus tests.

**Slice 1: the state machine, in the domain.** `packages/domain/src/workflows/agent-loop.ts` holds `agentLoop(state, readings)`, which returns the next state and one action. The action is a value: take up, reset, run prompt, wait for checks, hand back a correction, write a marker, release, end. It is never a side effect. The first cut of states:

| State | Reading that enters it | Exit |
|---|---|---|
| `free` | no assignment in the manifest | an assignment: `taking-up`; the wait bound: `ending` |
| `taking-up` | an assignment | the claim push lands: `working`; refused: `free`, with the claim answer (`claimAnswer`) |
| `working` | a prompt runs | the prompt exits: by its result |
| `awaiting-checks` | the prompt exited, work is pushed, a PR is open | checks pass: `free`; checks fail: `correcting` if budget remains, else `blocked` |
| `correcting` | a failed check and budget left | the prompt exits: `awaiting-checks` on a new head; no new head: `blocked` |
| `holding-work` | the prompt exited with uncommitted or unpushed work, no marker | a person, named on the board; never `free` (#1246) |
| `blocked` | a `PLOT-BLOCKED` marker, or the correction budget spent | the marker is answered (`/api/continue`): `working` |
| `ending` | the wait bound, a stop signal | the process exits, with the reason recorded |

The unit test asserts the property the desk lifecycle asserts: every state has an exit, and an exit to a person names the reason. Table cases cover each of the five failures above.

**The CI wait reads the pull request's current head, through the host port** (#1255, #1199). It no longer reads a BuildMonitor findings file keyed to the desk's `HEAD`. `checks_verdict`'s rule (`board/plot-checks-verdict.mjs`) moves whole. Its reading becomes the PR's head SHA and that head's check runs, so a push on top of the agent's branch, a corrected head and a continued desk all read the same way. A check the host cannot answer reads `unknown`, never "no CI answer".

**Slice 2: the process, behind a key.** The entry runs the machine. `plot-worker-loop.sh` reads a `## Plot Config` key, `Worker loop: shell | js`, defaulting to `shell`, and `exec`s the JS entry when it is `js`. Both loops live for one slice, so the fleet in this repository runs the JS loop first while adopting repositories keep the shell one. The 30 test files run against both values: the launcher's arguments, the manifest it writes, its log lines and its exit codes are the contract. A test that cannot pass against the JS loop names a behaviour the plan did not list, and it is reported, never rewritten to pass.

**The process restarts itself on new code.** At each point where it holds no work (`free`, after a pass), the entry compares its bundle's content hash with the one it loaded. On a difference it writes one log line and `exec`s itself with the same arguments. No state is lost, because the manifest on disk is the state. A loop that holds work never restarts mid-slice.

**Slice 3: JS becomes the default.** After this repository's fleet has run at least ten slices on `Worker loop: js` with no loop-caused failure, the default flips to `js`. The slice names the count and the slices it read.

**Slice 4: the shell loop goes.** `plot-worker-loop.sh` becomes a launcher of a few lines. The `Worker loop` key is removed, with a note in `skills/plot-dispatch/SKILL.md` for adopting repositories. Helpers that only the loop uses are removed after their callers are checked: `plot-build-monitor.sh`, `plot-transcript-quiet.sh`, and the loop-only parts of `plot-agent-manifest.sh` and `plot-worker-state.sh`. So are the loop's declared duplicates and their corpus tests. The shell ratchet falls by what was removed. Expected order of magnitude: the loop's 891 lines plus 200 to 400 lines of helpers.

**What does not change.** `Worker command` keeps naming `plot-worker-loop.sh`, so no adopting repository edits its config. The manifests, logs, findings files the board reads, and the `PLOT-BLOCKED` and `PLOT-CORRECTION` files keep their names and formats. `claude -p` is still the agent; this plan changes what starts and watches it, not what it runs.

### Open Questions

- [ ] Process groups and signals: the shell loop ends a hung prompt with `_kill_tree` and bounds itself with `SIGALRM`. The JS entry needs the same on macOS and Linux, including under `systemd` with `KillMode=process` (#1148). Slice 2 measures both.
- [ ] Where does the agent's turn-ending rule live? #1246 has two halves: the loop must not go free on uncommitted work (this plan), and the worker prompt must say a turn ends only when work is pushed or blocked (the prompt template). This plan takes the first half; the second may be a slice here or its own plan.
- [ ] Does `plot-agent-monitor.sh` (181 lines), which writes the findings the board shows, move into the process too? This plan keeps it, because the board reads its file. Slice 4 measures whether anything but the loop starts it.

## Slices

### The loop has a state machine

- `infra/the-loop-has-a-state-machine` — `agentLoop` in `packages/domain/src/workflows/agent-loop.ts`: every loop state and its exit, the CI wait reading the PR's current head, and table cases for the five failures in Motivation <!-- builds: agentLoop, a domain workflow -->

### The loop runs in one process

- `infra/the-loop-runs-in-one-process` — `board/plot-worker-loop.mjs` runs `agentLoop` for the agent's life behind `Worker loop: js`, restarts itself on a new bundle while it holds no work, and passes the loop's 30 test files <!-- builds: plot-worker-loop.mjs, a long-running loop entry -->

### JS is the default loop

- `infra/js-is-the-default-loop` — after ten fleet slices on `js` with no loop-caused failure, `Worker loop` defaults to `js` <!-- builds: the js default for Worker loop -->

### The shell loop goes

- `infra/the-shell-loop-goes` — `plot-worker-loop.sh` is a launcher; the `Worker loop` key, the loop-only helpers and the loop's declared duplicates are removed <!-- builds: plot-worker-loop.sh as a launcher -->

## Notes

- 2026-10-04, direction from jwloka: the loop runs as one long-running process; Type infra; reviewed in-session; own branches. Follows `the-shell-shrinks-into-the-domain`, which names this script as its first follow-on plan.
- 2026-10-04, measurement: code lines with `grep -vcE '^[[:space:]]*(#|$)'`; functions with `^[a-z_]+\(\) *\{`; bundles and sourced helpers read from the script's text.
- Related open issues this plan does not claim: #1250 (the board labels a blocked loop's exit 124 as a crash), #1186 (a hand-over restarts the idle reading), #1169 (a free agent runs a handed slice without its charter). Slice 1's states give each a named place, and each may close with it.
