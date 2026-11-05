## Implementation brief — a-second-mode-flag-in-plot

- **Plan (canonical):** `docs/plans/2026-11-04-a-second-mode-flag-in-plot.md` on `main`
- **Approved:** 2026-11-05, Jan Wloka, plan-PR #3128 merged
- **Branch:** `feature/a-second-mode-flag-in-plot` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** the plan's `Review: pr` — normal PR review

This slice waits on `feature/plot-fleetctl-stop-ignores-dry-run` (PR #3147, open at the time of writing). The fleet does not offer it until that PR merges. Start from a `main` that holds the sibling's change.

### What to build

`plot-fleetctl.sh --start --stop` runs the `--stop` arm: it calls `plot-dispatch.sh --stop` per desk, writes `.plot/state/fleet-stopped.json` and unloads the supervisor. The cause is that each of the `--status`, `--once`, `--start` and `--stop` arms of the argument loop assigns `mode=` again, so the last flag wins. Merge the four arms into one arm that exits 1 before any side effect when a second, different mode flag appears. The plan holds the exact arm text; the plan is canonical, this is orientation.

### Decisions the plan settles — do not re-derive them

- **One merged arm, not a post-loop check.** The check runs while the loop reads arguments, so it exits before `plot_repo_root`, any `launchctl`/`systemctl` call, any bundle call and any `plot-dispatch.sh` call. The merged arm also pays for itself in the shell-lines gate: −3 commands in the loop, measured with the gate's own awk on `fbf670eaf` (loop 46 → 43, file 1089 → 1086).
- **`--stop --stop` passes** as one mode. Only two *different* flags refuse.
- **`--start N` keeps working.** Only a bare number after `--start` is consumed. `--start --dry-run` still reads `--dry-run` as a flag; `--stop 3` still refuses as `unknown argument '3'`.
- **Exit 1 is shared with `--status` "not loaded".** This is safe: the one package caller, `supervisor-reading.ts:152`, passes `['--status']` alone. The `plot-fleetctl:` stderr prefix tells a refusal from a status answer.
- **The usage header does not change.** A header line moves the `-h` print range the sibling slice fixes. The rule goes in one comment line above the arm.
- **Find every site by content, not by line number.** The sibling edits this file first, so the plan's line numbers (`:771-793` and the rest) are for orientation only.
- **If the net is above 0 on the real base,** inline `tick_age_seconds()` into its one caller in the `--status` arm. Do not touch `running_major`, `home_short`, `desk_running`, `process_cwd`, `plot_process_candidates` or any line of the `--stop` arm.
- **Out of scope:** the same last-flag-wins defect in `plot-boardctl.sh` and `plot-dispatch.sh` (#3138).

### Done when

The plan's `## Done when` content is the specification; here it is the six cases in `test/reconcile/fleetctl.test.mjs` under *Tests*, plus the changeset.

- Every conflict case asserts the stderr message, not only exit 1. Before the change, `--stop --start` reaches `--start` arm refusals that also exit 1, so an exit-code-only assertion passes without the fix.
- Cases 1 and 2 assert no side effect: no `calls.log`, no `unload-ticks`, the start marker intact, no `fleet-stopped.json`, no unit file. A naive implementation that refuses after the first mode ran passes the exit code and fails these.
- Cases 5 (`--stop --stop`) and 6 (`--start 3 --dry-run`) are green before and after. They hold the "same flag passes" and "count consumption" behaviour that the merged arm rewrites.
- **Red first:** run cases 1–4 on the base before the fix, confirm each fails, and name the failing assertion of each in the PR body.
- **Mutation check:** after the fix passes, delete the conflict line, run case 1, confirm it fails on the `calls.log` or `unload-ticks` assertion, then restore the line from git. State the result in the PR body.
- State the `./scripts/check-shell-lines.sh --per-file` counts before and after in the PR body.

Plus one changeset, `'plot': patch`, description first, `bumps:` block last: "`plot-fleetctl.sh` refuses two different mode flags in one call, and names both, before it acts."

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Also run `./scripts/check-shell-lines.sh pr` (net ≤ 0), `./scripts/check-bash32-syntax.sh`, and `node --test --test-name-pattern 'mode|--wait|unknown argument|no verb|--dry-run' test/reconcile/fleetctl.test.mjs` — the names this slice touches; a whole-file run can stall.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches a `.sh` file, so growth is paid for in the same change. The gate counts commands, not lines: joining statements with `;` or `&&`, or folding `fi` or `done` onto the line before, is not a payment. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves); never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section when the PR exists. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-fleetctl.sh`, `test/reconcile/fleetctl.test.mjs` and one changeset under `.changeset/`. In flight: `feature/plot-fleetctl-stop-ignores-dry-run` (#3147) edits the `-h` arm of the same loop, adds a `--dry-run` refusal after the mode-required line, and inlines `running_major()` and `home_short()`. After both land, `--start --dry-run --stop` refuses on the mode conflict first. No board source changes.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
