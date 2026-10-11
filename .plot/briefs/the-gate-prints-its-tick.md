## Implementation brief — the-fleet-closes-its-review-findings (wave: The gate prints its tick)

- **Plan (canonical):** [docs/plans/2026-10-10-the-fleet-closes-its-review-findings.md](../../docs/plans/2026-10-10-the-fleet-closes-its-review-findings.md) on `main`
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1499 merged
- **Branch:** `bug/the-gate-prints-its-tick` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR (per `## Plot Config` — `Review: pr`)

This is the first of three branches that touch `registryd-main.ts` (the other two are `bug/a-failed-delivery-retries` and `bug/the-docs-name-fleetd`) and the plan runs them one after another rather than in parallel, so no sibling is in flight yet — checked 2026-10-11, no local or remote ref for this branch, and both earlier waves (`bug/an-unknown-supervisor-keeps-the-scan` → #1514, `bug/a-free-agent-reads-running` → #1527) are already merged and their branches deleted. This brief and its `Started:` record claim no branch, per `--brief-only`.

### What to build

**`--once` writes its tick to the daemon's log file, not to the terminal — confirmed by reading the code, not by running it.** `reportTick` (`registryd-main.ts:2328-2411`) already has the behavior the plan describes in its own docblock: `warn(...)` for an incomplete tick, `write(...)` for a completed one. The docblock even says *"AN INCOMPLETE TICK GOES TO STDERR, A COMPLETED ONE TO STDOUT"* as if this were already true for `--once`. It is not. `write` and `warn` are not stdout/stderr — they are whatever the caller passed, and the one caller that matters (the bottom of the file, lines 2456–2464) passes the same pair for every mode:

```ts
const out = processLog(join(logs, 'fleetd.log'));
const err = processLog(join(logs, 'fleetd.err'));
void startDaemon(process, dirname(fileURLToPath(import.meta.url)), (text) => out.write(text), (text) => err.write(text))
```

`startDaemon` forwards these straight into `run()`'s `out`/`err` parameters with no branch on `args.once`. So `plot-fleetd.mjs --once` writes its tick line, its hold detail, its supervision-report write, its escalation notices, its relay beat, and its sweep output all into `fleetd.log`/`fleetd.err` — an operator watching the terminal sees nothing, which is exactly #1441 ("`--once` prints nothing"). The fix is to choose the writer pair by mode at the point `args.once` is known, not to touch `reportTick` itself — its stdout/stderr-by-completeness logic inside a single tick is already correct and already tested (see "decisions" below).

### The decisions the plan settles — do not re-derive them

- **The split inside one tick (complete → stdout line, incomplete → stderr line) is `reportTick`'s own `write`/`warn` choice and is correct today.** Do not change `reportTick`'s signature or its internal logic. The defect is one level up: which concrete stream `write` and `warn` resolve to, chosen once per process rather than once per tick.
- **The choice belongs where `args.once` is first parsed, not inside `run()`'s loop body.** `run()` receives `write`/`warn` as parameters with defaults of `process.stdout`/`process.stderr` (`registryd-main.ts:1911-1912`) — those defaults are already right for `--once` and are what every test calls `run()` with implicitly. The defect is that the production entry point (the `if (process.argv[1] && ...)` block at the bottom of the file) never uses those defaults: it always constructs `processLog` writers and always passes them, overriding the per-mode default that already exists. The fix reads `args.once` (or re-parses `--once` from `process.argv` the same way `argsFrom` does) **before** constructing the writers, and picks `process.stdout`/`process.stderr` for `--once`, `processLog(fleetd.log)`/`processLog(fleetd.err)` otherwise. Re-use `argsFrom(process.argv.slice(2))` for this rather than a second ad hoc `--once` string search — it is already exported and already the single parser for this flag.
- **The log stays the looping daemon's, unconditionally.** This is a requirement, not a side effect to verify after the fact: `truncateInherited(1)` / `truncateInherited(2)` (`:2454-2455`) exist because launchd opens `fleetd.log` through the unit's `StandardOutPath`, and a rotated file needs the opener to be the one writer — introducing a second code path that sometimes opens `fleetd.log` and sometimes doesn't must not disturb that truncation call, which runs regardless of mode and is unrelated to which writer the tick itself gets.
- **`writeSupervisionReport`, `startAgents`, `notifyEscalations`, `relayBeat`, and `sweepTempIfDue` all take the same `write`/`warn` pair `reportTick` got** (`registryd-main.ts:2183-2232`). Once the top-level choice is fixed, all of these follow it automatically — there is no second site to patch. Verify this by grep, not by assumption: `grep -n '\bwrite\b\|\bwarn\b' packages/fleet/src/server/entry/registryd-main.ts` inside `run()`'s body should show no other writer construction between the top of `run()` and this list.
- **The channel and the scan clock are unaffected.** `--once` already opens no channel (`:2033`, `:2046`) and starts no scan clock (`:2052`) — this slice does not touch that gating, only which stream the tick's own text reaches.

### Done when

The plan's `## Done when` list states: *"`plot-fleetd.mjs --once` prints its tick line on stdout."* That is the whole behavioral spec for this slice. The assertions that exist because a naive implementation would pass without them:

- **A test must run `--once` through `run()` with no explicit `write`/`warn` override and assert the tick line reaches the DEFAULT stdout path, not merely that `reportTick` was called with some writer.** The existing unit tests for `reportTick` (if any) call it directly with injected functions and prove nothing about what the production entry point wires up — that wiring lives in the `if (process.argv[1] && ...)` block, which is excluded from import-time execution by its own guard comment at `:2443` ("Only when RUN, never when imported") and therefore cannot be unit-tested by importing the module. Either extract the writer-selection logic into a small, exported, directly-testable function (e.g. `writersFor(once: boolean, logs: string): { out: ..., err: ... }`) and test that in isolation, or add an integration-style test that spawns the built artifact with `--once` and asserts stdout is non-empty while `fleetd.log` is not newly appended to. Prefer the exported-function approach — it is cheaper and matches how the rest of this file is structured (`reportTick`, `startDaemon` etc. are already extracted and tested directly; the raw process-argv block at the bottom is deliberately the one untestable sliver).
- **`log-rotation.test.mjs:272`'s assertion must change, not merely continue to pass.** It currently asserts `registryd` (the source) unconditionally contains `processLog(join(logs, 'fleetd.log'))` and `processLog(join(logs, 'fleetd.err'))` — a source-text grep, not a behavioral test. After this slice, the source still contains those calls (they're still used for the looping-daemon mode), so the existing `assert.match` lines will likely keep passing even if the mode branch is missing or wrong — **this is the trap**: a test that merely re-asserts the strings still exist proves nothing about `--once` using a different pair. Add a new assertion (in this test or the writer-selection unit test above) that the source also constructs or references the stdout/stderr case — e.g. assert the extracted `writersFor`-style function exists and is called before `startDaemon`, or assert `process.stdout`/`process.stderr` (or their default-parameter equivalents) appear in the production wiring block, not only in `run()`'s signature defaults. A test that only re-checks today's four `processLog` lines is the plan's own `log-rotation.test.mjs:272` reference — read it as "this test's claim must now be narrower," not "this test is already sufficient."
- **`skills/plot-fleet/SKILL.md` must stop implying `--once` already prints to the terminal where it currently doesn't, and must not overstate what this slice fixes.** Lines 40, 76, 88, 247 and 265 already describe `--once` as a terminal-facing gate ("One supervisor tick against the live estate, then exit. **The gate.**"; "`--once` also names the branches under each hold"). These lines are *aspirational* against current `main` — they describe the behavior this slice delivers, not a doc defect introduced by this slice. Re-read each cited line after the code change lands and confirm it is now literally true (e.g. line 88's claim that `--once` "also names the branches under each hold" is true of `reportTick`'s internal logic already, independent of this slice — only the "does it reach the terminal" half is new). Do not add a changelog-style note to SKILL.md about the fix; state current behavior only, per this repo's writing convention.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. This slice touches `packages/fleet/src/server/entry/registryd-main.ts`, so expect `pnpm --filter @plot-pm/fleet exec vitest related --run {changed}` and `pnpm --filter @plot-pm/fleet exec tsc --noEmit -p .` in its output, plus the repo-wide `check-*.sh` gates (including `./scripts/check-host-cli-callers.sh`, `./scripts/check-bundle-resolution.sh` and friends — this slice adds no host call and no new shell script, so none of these should newly fire). The suites in the `CI suites` config key run in CI on every PR; a failure there comes back as a correction. Do not run `test:e2e` locally — it dispatches real workers into sandbox repos and is CI's gate, not a local one.

**This slice should touch no `.sh` file.** `skills/plot-fleet/SKILL.md` is documentation, not shell, so editing it does not interact with `scripts/check-shell-lines.sh`. If the fix ends up requiring a shell-side change (it should not — the gap is entirely inside `registryd-main.ts`), that gate refuses a pull request whose shell under `skills/` is longer than at its merge base; pay for growth in the same change by removing shell elsewhere. The gate stores no number and has no override.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line under `## Slices` in the plan.

### Scope guard

This branch owns:

- `packages/fleet/src/server/entry/registryd-main.ts` — the writer-selection logic at the production entry point (around the `if (process.argv[1] && ...)` block, `:2444` onward), and any small exported helper extracted from it for testability
- `packages/fleet/test/**` (or wherever `registryd-main`'s own tests live) — the new writer-selection test
- `test/reconcile/log-rotation.test.mjs` — the assertion at `:272` and its narrowing
- `skills/plot-fleet/SKILL.md` — re-verifying, not rewriting, the lines that describe `--once`'s terminal output (40, 76, 88, 247, 265)

It does not touch `packages/domain/src/rules/ending-action.ts`, `packages/board/src/server/fleet.ts`'s queue-reading paths, `plot-fleetctl.sh`, or anything in the other eleven slices' scope — the plan's own design note says slices 3, 8 and 13 share `registryd-main.ts` and none run in parallel, so no collision is possible today, but re-grep this file's line numbers before trusting them if `bug/a-failed-delivery-retries` or `bug/the-docs-name-fleetd` lands first.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
