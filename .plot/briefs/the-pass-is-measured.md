## Implementation brief — one-agent-pass-costs-what-its (wave 1: The pass is measured)

- **Plan (canonical):** docs/plans/2026-10-08-one-agent-pass-costs-what-its.md on main
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/the-pass-is-measured` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session, per the plan's Review answer

This is the only wave. Nothing waits on it except the story's Phase 3 route choice (`the-fleet-runs-without-the-board`), which reads the decision this branch records.

### What to build

`docs/shell-and-domain.md` §1 keeps a per-agent-per-pass script in shell because a Node start costs 34 ms and a bundle answers in 39 ms (one start, idle machine, 2026-09-07). That figure does not measure a pass. This branch adds `scripts/measure-pass.mjs`, runs it, and records which of two routes the numbers choose: route 1 converts per-pass scripts to launchers, route 2 answers per-pass questions in the agent's own long-lived process.

Deliverables, in order:

1. **Inventory.** The scripts and bundles one agent pass reaches, with a call count per pass taken from a trace of real passes. Start from `packages/board/src/server/entry/worker-loop.ts`, `registryd.ts`, `registryd-main.ts` and auto-dispatch, then follow the adapters. A grep gives the starting list (`plot-plan-meta.sh`, `plot-dispatch.sh`, `plot-config.sh`, `plot-agent-manifest.sh`, `plot-agent-settings.sh`, `plot-host.sh`, `plot-reap.sh`); the issue also names `plot-fleet-scan.sh`, `plot-worker-state.sh` and `plot-budget.sh`, which the entry files do not name. A call site inside a branch or loop does not give its count, so trace.
2. **`scripts/measure-pass.mjs`**, shaped like `scripts/measure-tick.mjs`: it reads and decides and performs nothing, so it is safe on a live estate. For each variant and for 1, 4 and 8 concurrent agents it reports user+system CPU and wall time per pass, as a median over several runs, with the load average at the start.
3. **The record.** The chosen route and the table of numbers in `docs/shell-and-domain.md` §1 and in the story's *Decisions* table (`docs/stories/the-shell-holds-no-behavior/STORY-the-shell-holds-no-behavior.md`). Correct §1's statement that `plot-worker-loop.sh` is the per-pass case: it is an 18-line launcher that `exec`s `board/plot-worker-loop.mjs` since `the-worker-loop-runs-in-js` (v2.24.0).

### Settled decisions — do not re-derive them

- **Three variants, not shell against Node.** *today* = `bash` + the script spawned from the JS loop; *launcher* = `bash` + launcher + `node` + bundle; *in-process* = a function call inside one long-lived process. The JS loop already pays a `bash` start per script call, so the launcher adds a `node` start behind it and in-process removes both.
- **The launcher variant converts no script.** It times the bundle start a launcher adds (`node` on an existing bundle that answers the same question or a stand-in of the same size) on top of today's call. The plan changes no script under `skills/plot/scripts/`; a converted script here is out of scope and trips `scripts/check-shell-lines.sh` for nothing.
- **The threshold was set before the measurement (jwloka, 2026-10-09): route 1 if the launcher variant adds less than 5 % CPU per pass at 8 agents, else route 2.** Apply it as stated. Do not adjust the threshold or the agent counts after seeing the numbers.
- **Agent counts are 1, 4 and 8.**
- **Route 2 does not wait for Phase 3.** The JS worker loop is one long-lived process per agent and answers its own per-pass questions in process, so the in-process variant measures that. The board is not the process that answers: the story separates the fleet from the board.
- **Measure CPU, not wall clock alone.** The scan is CPU-bound under load (memory: *measure the Plot scan by CPU, not wall clock*), and wall time hides the cost the fleet pays. Report both; decide on CPU.
- **Carried-over rules:** an absent reading is not a zero (report a script that failed or was skipped as such, never as 0 ms); read the exit code, not the emptiness of stdout; a timing that varies with load is a measurement of load, so record the load average beside every figure and take medians.
- **Do not run the e2e suite** to generate load. It dispatches real workers into sandbox repos; use synthetic concurrent processes.

### Done when

The plan's `## Slices` entry is the specification: the inventory, the measurement at 1, 4 and 8 agents in the three variants by CPU and wall time, and the route recorded in `docs/shell-and-domain.md` and the story. Plus these, which a naive implementation would pass without:

- **The inventory carries call counts from a trace**, not from grep matches. Without this, a script inside a rarely-taken branch counts as one call per pass.
- **The recorded route names the threshold and the figure it was compared with** (the launcher variant's CPU overhead at 8 agents, as a percentage). A route with no number behind it re-opens the question.
- **`scripts/measure-pass.mjs` performs nothing.** A grep for writes and spawns of mutating commands in it returns none.

Gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. The script is plain `.mjs` under `scripts/`; `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` grows over its merge base, and this change adds no shell. Add a changeset with the description first and the `bumps:` block last, and check it with `./scripts/check-changeset-packages.sh`. A new top-level script may need a row where the repo lists its scripts; the local checks print any gate it trips.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `scripts/measure-pass.mjs`, `docs/shell-and-domain.md` §1, the story file's *Decisions* table, and a changeset. It touches no `.sh` under `skills/plot/scripts/` and no board code. `docs/plans/2026-10-09-the-shell-sheds-its-decisions.md` (slices 2 and 3 convert `plot-reap.sh` and `plot-approve.sh`) is in flight on the same story; it edits those scripts and the story's Phase 1 text, so keep your story edit to the *Decisions* table and Phase 2 lines to avoid a merge conflict.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
