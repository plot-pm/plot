## Implementation brief — a-usage-limit-is-not-a-broken-prompt (wave 2: The loop waits out a usage limit)

- **Plan (canonical):** `docs/plans/2026-10-01-a-usage-limit-is-not-a-broken-prompt.md` on `main`
- **Issue:** #1141
- **Approved:** 2026-10-01, jwloka, in-session
- **Branch:** `bug/the-loop-waits-out-a-usage-limit` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)

**This slice waits on wave 1, `bug/the-rule-names-a-usage-limit`.** It needs that slice's bundle `skills/plot/scripts/board/plot-prompt-exit.mjs`. Start only after wave 1 has merged to `main`, and rebase onto `main` before you open the PR.

### What to build

The plan's section **Design › Approach** is the specification; read it whole. This slice wires the bundle into the shell.

1. **Capture without losing the prompt's pid.** `run_bounded` starts the prompt as `bash -c '. "$1"' _ "$prompt_file" > >(tee -a "$out") 2>&1 &`, with `$out` from `plot_tmpfile`. **Never a pipeline** (`… | tee … &`): it moves `$!` to `tee`, so the bound, the idle watcher and `--stop` miss the prompt. All three round-2 jurors measured that.
2. **Ask the bundle on every exit** with all seven arguments: status, `${PLOT_HARNESS:-claude}` (never the raw variable — the default launch exports it empty), now in epoch seconds through one clock function, `Worker bound` seconds, the prompt's run time, the wait flag, and the commits since the wait. The last 200 lines of `$out` go on stdin. An unaskable bundle (no `node`, no bundle, no answer) takes today's path: `unstarted` for non-zero, normal for status 0.
3. **Act on the answer.** `wait`: do not raise `attempts`; write `.plot-worker.limited` (reset epoch, tab, reset ISO, tab, limit line); record the desk `HEAD`; log *"usage limit on <branch> until <time>; waiting"*; sleep to the reset epoch plus `PLOT_LIMIT_MARGIN_SECONDS` (default 60) in steps of at most 60 s, each step as `_wait_sleep_pid`, comparing the clock after each step; then `continue` on the same slice. `end-limited`: end the worker with reason `limited`, actor `agent`, and a `PLOT-BLOCKED` marker naming the limit, the reset or *with no reset time*, the limit line, the commit and dirt counts, and `/plot-dispatch --restart <branch>`; no prompt fix; exit 1. `unstarted` and `ran`: today's paths.
4. **Commits since the wait** are `git rev-list --count <HEAD recorded at the start of the wait>..HEAD` in the desk.
5. **The sentences read the desk.** Before printing *"without the agent doing any work"*, *"the desk is untouched"* or *"no slice was ever worked"*, read commits (`git rev-list --count "origin/$main_branch..HEAD" -- .`) and dirt (`plot_worker_dirty`), and name the counts where either is above zero, on both the `end-limited` and `unstarted` paths.
6. **The monitor.** `sample_verdict` in `plot-worker-monitor.sh` measures silence from the later of the newest transcript line and the reset epoch in `.plot-worker.limited`, and clamps a negative silence to 0.
7. **`plot-fleetctl.sh --status`** prints *"waiting on a usage limit until <time>"* only while the reset epoch is later than now.
8. The loop overwrites `.plot-worker.limited` at each limit and removes it when the slice ends, the agent hops, or the worker ends.

### The sites, verified on `origin/main` 2026-10-01

| Site | Line | What is there |
|---|---|---|
| `plot-worker-loop.sh` | 73 | sources `plot-tmp.sh` |
| `plot-worker-loop.sh` | 366 | `START_ATTEMPT_BUDGET="${PLOT_START_ATTEMPT_BUDGET:-3}"` |
| `plot-worker-loop.sh` | 712 | sources `plot-worker-state.sh` |
| `plot-worker-loop.sh` | 1398 | `_wait_sleep_pid=""` |
| `plot-worker-loop.sh` | 1595 | `_kill_tree "$_prompt_child"` in the trap |
| `plot-worker-loop.sh` | 1675-1676 | the prompt start and `_prompt_child=$!` |
| `plot-worker-loop.sh` | 1719 | `_prompt_status=$?` |
| `plot-worker-loop.sh` | 2008-2021 | the non-zero exit path and its constant sentences (`:2012`, `:2015`, `:2019`) |
| `plot-worker-state.sh` | 89 | `PLOT_WORKER_RECORD='\.plot-worker\.'` |
| `plot-worker-state.sh` | 389 | `plot_worker_dirty` |
| `plot-worker-monitor.sh` | 533 | the `*[!0-9]*` arm answering `unknown` |
| `plot-worker-monitor.sh` | 419-420 | the fingerprint drops `.plot-worker.` files |
| `plot-dispatch.sh` | 892, 1491 | `launch_harness=""` and its export as `PLOT_HARNESS` (read with the Read tool) |

### Tests (from the plan; extend the start-failure fixture in `test/reconcile/second-slice.test.mjs:370-440`, each with a fake harness, `PLOT_LIMIT_MARGIN_SECONDS=0` and a clock offset)

- a limit with a reset 2 s ahead waits and resumes the same slice without raising `attempts`;
- the same case with `PLOT_HARNESS` set and empty still waits;
- the monitor runs beside the loop with a 1 s window and interval on a desk with commits; no finding is published during the wait, and the resumed prompt runs to exit 0;
- a limit within 600 s of a wait with no commit since the recorded `HEAD` ends with `limited`; a limit after a resumed prompt that committed waits again;
- a limit with no reset ends at once with the limit marker, which names the commit and dirt counts;
- a status-0 run whose last line is the limit line waits; a status-0 run that quotes the line earlier finishes the slice;
- the bound ends a prompt whose output is captured, and no prompt process remains afterwards;
- a missing bundle keeps today's three retries;
- `--stop` during a wait ends the loop within one step;
- `plot-fleetctl.sh --status` prints the waiting line for a future reset and not for a past one;
- a plain failure keeps today's three retries; a desk with commits and dirty paths names both counts, and the loop's own `.plot-worker.*` files are not counted.

### Panel caveats a worker trips on

- **`$!` must stay on the prompt.** Test it: after the bound fires, no prompt process may remain.
- **`busy` comes from the clamp.** Without it the subtraction gives a negative number, which `:533` answers `unknown`. Assert that no finding is published, not that the verdict is `busy`.
- **Never spend real usage.** Every test uses a fake harness printing the limit line. The limit-and-exit-0 case is not established; do not claim it.
- **A `tee` flush race** leaves the last line missing; the answer then falls back to today's path. Do not add a sleep to hide it.

### Done when

Every test above passes; a waiting desk holds `.plot-worker.limited`; no `PLOT-BLOCKED` on a limit names a prompt fix.

### Gates

`nvm use` (Node 24), then `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck`. **Do not run `pnpm run test:e2e`.** Run `test/reconcile/second-slice.test.mjs` alone first; contract suites fail falsely under load.

### Rules that bite this slice

- No new `plot-*.sh` script; the decision stays in the bundle.
- Temp paths only through `plot-tmp.sh` (`scripts/check-temp-paths.sh` is the gate); no raw `trap … EXIT`.
- A changeset, description first and the `bumps:` block last.
- The controller-gate hook blocks any Bash command that names `plot-dispatch.sh`; read it with the Read tool.
- Use `trash`, never `rm`. Never `git stash`.
