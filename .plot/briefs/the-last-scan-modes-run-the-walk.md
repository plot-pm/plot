## Implementation brief — the-plan-walk-moves-into-the (wave: Last modes)

- **Plan (canonical):** docs/plans/2026-10-31-the-plan-walk-moves-into-the.md on main
- **Approved:** 2026-10-31, Jan Wloka, plan-PR #2981 merged
- **Branch:** `feature/the-last-scan-modes-run-the-walk` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

This branch waits on `feature/the-pulse-log-runs-the-walk` (merged as PR #3004). `feature/the-scan-script-is-a-launcher` (Removal) waits on this one and has not started.

### What to build

After #3001 and #3004, three caller modes still reach the shell walk in `skills/plot/scripts/plot-fleet-scan.sh`, and Removal cannot delete that walk while they do. Read the dispatch condition at `:424` (`"${PLOT_SCAN_WALK:-domain}$loose$stream$log_pulse" != domain00[0${PLOT_LOG_PULSE_WALK:+1}]`) first: `--loose` and `--stream` always fail it, and `--log-pulse` passes it only when `PLOT_LOG_PULSE_WALK` is set. This slice moves the three:

1. **`--stream`** emits one `{"kind":"plan",...}` line per plan as the walk resolves it, then the terminal `{"kind":"reading","reading":<doc>}` line, the shape the board's fleetless fallback reads (`packages/board/src/server/fleet.ts:2855`). The terminal line proves the scan finished; a consumer that saw plan lines and no `reading` line holds a partial answer. Keep that distinction: do not print `reading` before every plan line, and do not emit it when the walk failed. The first plan line must print before the walk has read every plan, so the stage that resolves a plan has to hand it out as it finishes (a callback or async iterator on the assembly), not after `fleetReading` returns. `fleet.ts` has the consumer-side parsing; read it before choosing the line shape, and compare against the shell's per-plan lines at the bridge write (`:5237` onward) rather than from memory.
2. **`--loose`** reaches the branch-readings stage as an input (the `loose`/`loose_backend`/`loose_verifiable` values the shell computes near `:410`), not as a mode. It does not get its own walk.
3. **Plain `--log-pulse`** runs the walk by default. Remove the `PLOT_LOG_PULSE_WALK` opt-in at `:417` and `:424` and make `domain` the default, like the other modes. The domain output must carry the per-plan wave report, the `summary: plans=… waves=… … main=…` footer (`:5420`) and the `Pulse complete. This report is derived — nothing was changed.` line (`:5414`) that `/plot-pulse` reads. #3004 moved the pulse-line write and the bridge write only; the prose report is what is left.

### Decisions the plan settles — do not re-derive them

- **No new verdict arithmetic.** The stages compose rules that exist (`sliceVerdicts`, `waitVerdict`, `agentState`, `deskState`). A stream line or the loose input that needs a new rule is a finding to report, not a rule to invent here.
- **The shell walk stays as the declared duplicate until Removal.** `PLOT_SCAN_WALK=shell` still works after this slice, and every comparison below runs the shell as the oracle. Adjusting either side to make a comparison pass is forbidden; on a disagreement the branch stops and reports both answers.
- **A scan whose `origin/<main>` does not resolve stays on the shell** (`READ_REF = unknown`, `:424`). The estate stage has no working-tree fallback. Do not change that here.
- **Absent is not false; read the exit code, not the emptiness.** A failed or partial walk exits non-zero and prints no terminal `reading` line.
- **`unknown` and failed reads are never cached** (plan Approach 4) and the board fallback runs cold.
- **The bridge is written before the document is printed** (`:5237` comment): a consumer that reads the terminal line and then kills the scan must still find the file. Keep that order in the node entry.

### Done when

The plan's "Last modes" bullets are the specification:

- `--stream` prints its first plan line before the walk has read every plan, and its lines equal the shell walk's per-plan lines on the pinned clone. A naive implementation buffers every line and passes the equality test; the first-line test must observe ordering against the walk's progress (for example a fixture whose later plan blocks on a gate), so it fails if output waits for the end.
- `--loose` output equals the shell walk's on the pinned clone, with the same normalisation as the plan's Done-when preamble (`--offline`, no host token, no `PLOT_PR_LISTING`, no `PLOT_TERMINAL_CACHE`, `changed_ago_seconds` removed).
- Plain `--log-pulse` runs the walk, and its wave report, `summary:` footer and `Pulse complete.` line equal the shell's.
- `test/reconcile/scan-walk-domain.test.mjs` no longer asserts that `--loose` stays on the shell walk (`:128`, "scan-walk: --loose stays on the shell walk"); replace it with the domain-versus-shell comparison.

Plus: `pnpm build:board` before any test that spawns `plot-scan-walk.mjs`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI and a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should shrink the shell: dropping the `PLOT_LOG_PULSE_WALK` opt-in and the `$loose$stream$log_pulse` exclusion simplifies `:417` and `:424`. Joining statements with `;` or `&&` is not a payment. The gate stores no number and has no override.

### Bookkeeping

Open the PR through the controller once there is a real commit: `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Never `gh pr create`. Push the first real commit as soon as it exists. When the PR is created, append `→ #<number>` to this branch's line under "Last modes" in the plan's `## Slices` section.

### Scope guard

This branch owns:
- `skills/plot/scripts/plot-fleet-scan.sh` (the `:417`/`:424` dispatch and the three modes' branches only; not the per-plan loop other callers use, and not a removal of the shell walk)
- `packages/board/src/server/entry/scan-walk.ts` (the `stream` and `loose` handling, and the prose `log-pulse` report)
- `packages/domain/src/workflows/plan-walk-assembly.ts` (only to hand out plans as they resolve)
- `test/reconcile/scan-walk-domain.test.mjs` and the tests proving the above

No other branch of this plan is in flight; its waves run strictly in sequence. Do not delete the shell walk or retire any corpus pair here: that is Removal's job, named in the plan.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
