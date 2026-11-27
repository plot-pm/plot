## Implementation brief — a-desk-reads-quiet-from-its-live-signals (wave 1: Quiet Reading)

- **Plan (canonical):** `docs/plans/2026-11-27-a-desk-reads-quiet-from-its-live-signals.md` on main
- **Approved:** 2026-11-27, jwloka, plan-PR #3747 merged
- **Branch:** `bug/a-desk-reads-quiet-from-its-live-signals` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Issue #3745, sprint `fleet-runs-safely-alone`. The next slice, `bug/fleetctl-status-asks-the-desk-quiet-reading`, waits on this one: it needs the rule this slice adds. This slice waits on nothing.

### What to build

On 2026-11-27 at 09:43 UTC `plot-fleetctl.sh --status` printed `quiet 7178s` to `quiet 7180s` for three working agents. One had opened PR #3741 a minute earlier. Each desk's `.plot-worker.log` was 166 bytes, written once when the loop started, while `.plot-worker.pass` and the monitor file were minutes old. A fix is correct only if a desk with an old log and a fresh `.plot-worker.pass` reads quiet near the pass file's age.

Add the rule and route the adapter through it:

- **`deskQuietSeconds(readings, now)`** in `packages/domain/src/rules/`. `readings` holds the mtimes of four signals, each one possibly absent: `.plot-worker.pass`, `.plot-worker.monitor.agent.jsonl`, the desk's HEAD commit, `.plot-worker.log`. It returns the age of the newest in seconds, or `null` where none can be read. It awaits nothing and imports only `zod`.
- **`logQuietSeconds`** in `packages/domain/src/adapters/trees/trees-git.ts` (about `:460`) reads the four mtimes and asks the rule. The port `logQuietSeconds?(path)` in `ports/trees.ts:185` keeps its name and its contract (`PortResult<number | null>`). The adapter is the only place that reads files.
- The consumer is `workflows/plan-walk-desks.ts:98`. It already takes the quieter of `trees.quietSeconds` and the log reading, so it needs no change; check that and leave it.

Use the constants that exist: `PASS_FILE` (`rules/worker-liveness.ts:127`) and `AGENT_FINDINGS_FILE` (`.plot-worker.monitor.agent.jsonl`, declared separately in `adapters/desk/desk-fs.ts:51` and `adapters/processes/processes-files.ts:385`). Do not add a third copy of the file name; import or lift one.

The plan is canonical. This brief is orientation.

### The decisions the plan settles — do not re-derive them

**The newest signal wins, not the log.** The loop's idle watch (`worker-loop.ts:1367`) reads the log and falls back to CPU time. The two quiet readers have no such fallback, and on the three measured desks the log's age was the loop's age. A log-only reader cannot answer *is it working*, and the measurement above is the proof.

**Four signals, and the session transcript is not a fifth.** `[question-session-file]` is answered no: the transcript path depends on the harness, and the monitor file already follows the session. Do not add it.

**The loop does not write the prompt's output to the log again in this plan.** `[question-log-output]` is answered no: the four signals answer the question without it, and the log's size feeds the idle watch's `logActivity` reading. Do not change `worker-loop.ts`.

**A rule takes readings as values.** `deskQuietSeconds` receives mtimes, not paths and not a port. This is the domain's shape (`reap(readings, input)`), and it keeps the rule testable with no filesystem.

**Carried rules.** Absent is not false: a missing signal file is `undefined`/`null` in the readings and never reads as age zero or as infinitely old. Nothing readable answers `null`, not `0`, so the caller's existing fallbacks still run. A future mtime clamps to age 0, as the adapter's current code does with `Math.max(0, …)`. New functions are arrow functions.

### Done when

The plan's `## Done when` list is the specification; this slice's tests, from its `tests:` comment:

- The newest signal wins. Assert with four distinct ages that the smallest is returned, not the first or the log.
- An old log with a new pass file reads from the pass file. This is the measured failure; it must fail on the old `logQuietSeconds`.
- No readable signal answers `null`.
- The adapter reads all four files. Use a temp desk with the files set to distinct mtimes (`utimesSync`) and assert each one alone moves the answer. A test that sets only the log would pass on the old code.
- A desk with only some of the four files still answers from those.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. Add a changeset (`'plot': patch`, description first, `bumps:` block last, with the `plan:` line inside the block). Commit no generated bundle.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### Quiet Reading` in the plan's `## Slices` section.

### Scope guard

This branch owns `packages/domain/src/rules/` (the new rule file and its test), `packages/domain/src/adapters/trees/trees-git.ts` and its test, and one changeset. It does not touch `skills/plot/scripts/plot-fleetctl.sh`: that is the next slice, which adds the bundle call over this rule. It does not touch `worker-loop.ts`. If you find something the plan did not anticipate, report it rather than improvising outside scope.
