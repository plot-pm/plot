## Implementation brief — fleetd-tick-stop-and-escalation-defects (wave Implementation)

- **Plan (canonical):** docs/plans/2026-10-17-fleetd-tick-stop-and-escalation-defects.md on main
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1965 merged
- **Branch:** `bug/fleetd-stop-starts-no-agent` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — plot-review gate on main

This branch is one of six in the Implementation wave, all against the same files. No wave ordering between them — any may land in any order — but see Scope guard below for what each holds.

### What to build

Closes #1577, #1586, and the stop-race bullet of #1526.

**#1577 — a stop arriving mid-scan still starts a new agent.** `registryd-main.ts:2216-2225`'s own comment already states the current behaviour as deliberate: *"A scan already started still runs its automatic writes"* (line 2219). That sentence is correct for everything automatic writes used to do, but `fleetAutoWrites` (`packages/fleet/src/shared/auto-writes.ts:29-71`) calls `maybeAutoDispatch` first (line 48), which can start a brand-new agent — not just finish bookkeeping on one already running. A stop signal that arrives during the scan's `await scanOnce(...)` (`fleet-clock.ts:145`) is not consulted anywhere between the scan landing and `after(landed)` running (`fleet-clock.ts:151`). Fix: gate the dispatch-starting part of the after-step on the stop signal, so a stop in flight lets the scan's bridge write and bookkeeping (deliver, verify, design) finish, but suppresses `maybeAutoDispatch` specifically.

**#1586 — `resolve_wt_root` compares an unresolved path to a resolved one.** `skills/plot/scripts/plot-fleetctl.sh:713-722`: `wt_root=$(plot_desk_root "$main")` (line 716) is never passed through `pwd -P`, while `top` is (line 719: `cd -- "$(git rev-parse --show-toplevel...)" && pwd -P`). The refusal at line 720 (`[ "${top#"$wt_root"/}" != "$top" ]`) compares a resolved path's prefix against an unresolved one, so a desk reached through a symlink mismatches and the estate check refuses a legitimate desk. Fix: resolve `wt_root` the same way — through `pwd -P` — before the comparison.

**#1526 (stop-race bullet only)** — covered by the same `fleet-clock.ts` guard as #1577; the other #1526 bullets (newline, channel bound line, `over()` tests) belong to `bug/fleetd-once-and-channel-output`, not this branch.

### The decisions this brief settles — do not re-derive them

**The stop check belongs in `fleet-clock.ts`/`auto-writes.ts`, not in a new domain rule, despite the layering rule's general preference.** `packages/domain/src/rules/` has no existing "should the after-step run" rule (`fleet-run.ts` and `fleet-size.ts` are the only two files there, and neither answers this). A pure domain verdict here would need the stop flag passed in as a value, same as every other domain rule in this repo takes readings rather than ports (CLAUDE.md, "A note on shape"). That is doable — `isStopped: boolean` is a value, not a port — so prefer a small domain verdict (`shouldAutoDispatch(pulse, isStopped): boolean` or similar) over an inline `if` in the adapter, if the shape is clean. Do not invent a port for this; the stop flag is read once per tick and handed in.

**The existing `stopped`/`requested` flag is already exactly the right shape — reuse it, do not build a second one.** `stopOnSignals` (`registryd-main.ts:1850-1864`) already exposes a zero-arg `() => stopped` boolean callable plus a `requested` promise. `fleetAutoWrites` is constructed once at `registryd-main.ts:2197` with a `warn` and a `queueHeld` thunk already threaded through as closures — the same pattern (a `() => boolean` thunk passed at construction) is the natural fourth argument, not a new global or a second signal class.

**`maybeAutoDispatch` is the only call to suppress — not the whole `fleetAutoWrites` pass.** Delivery (`runAutoDeliverPass`) and verification (`runAutoVerifyPass`) act on agents already running, not new ones; suppressing the whole pass on a stop would leave a landed delivery unrecorded for one tick, which is a strictly worse failure than skipping dispatch alone. Only line 48 (`own = maybeAutoDispatch(...)`) needs the guard.

**Why this cannot be "just check `stop()` inside `maybeAutoDispatch` itself" instead:** `auto-dispatch.ts`'s `maybeAutoDispatch` has no existing dependency on the daemon's signal handling — it is called from both the daemon (`registryd-main.ts`) and from `plot-dispatch-command.mjs` with no board, which has no SIGTERM to read. Pushing the stop check down into `maybeAutoDispatch` would require every caller to supply a stop flag, including callers that have none. The guard belongs at the call site that already knows about `stop`, which is `registryd-main.ts`'s own construction of `fleetAutoWrites` — or, if threaded as a parameter, `fleetAutoWrites`'s own closure, which already receives exactly this kind of thunk (`queueHeld`).

**The symlink fix is one line, not a rewrite of `resolve_wt_root`.** `plot_desk_root` (`board/plot-desk-root.mjs`, called via `plot-desk-root.sh:38-46`) already resolves `plot_repo_root()` physically via `pwd -P` internally — the bug is only that the *returned* `wt_root` string is handed back as-is and never re-resolved at the comparison site in `plot-fleetctl.sh`. Fix is local to `resolve_wt_root`: resolve `wt_root` through `cd -- "$wt_root" && pwd -P` (guarding the case where the directory does not yet exist, same as `top`'s existing guard pattern at line 719) before it is used in the comparison.

**No existing test names a symlink or "estate" by that word.** `test/reconcile/fleetctl.test.mjs` has a `--stop` suite from line 401–533 titled things like `'--stop with nothing running still reports...'`; none currently tests a symlinked desk path. The "fix a test title and assert" part of #1586 has no pre-existing wrongly-named test to find — if the issue thread names a specific test, follow it; otherwise this is net-new coverage, not a rename.

**Stop-race test coverage is a confirmed gap.** `packages/fleet/test/unit/fleet-scan-clock.test.ts` has four existing tests (lines 139, 153, 189, 206) covering in-flight scan guarding and `idle()` settling, but none covering "a stop arrives while a scan is in flight, and the after-step's dispatch does not start a new agent" or "a PR refresh in flight when stop arrives." Both need new tests in this file.

### Done when

The plan's `## Done when` list is the specification (see plan file — this plan has no explicit `## Done when` section; use the Changelog entries as the acceptance bar: *"a stop that arrives during a scan starts no new agent"*). Add, because a naive fix would pass without them:

- A test that starts a scan, signals stop mid-scan (before `after` runs), and asserts `maybeAutoDispatch` is never called for that tick — catches a fix that only checks stop *before* the scan starts, which still races.
- A test that a PR refresh in flight when stop arrives still completes its write (the existing `idle()` contract must not regress) — catches an overbroad fix that cancels everything on stop rather than just dispatch.
- A mutation case in `test/reconcile/fleetctl.test.mjs` where `wt_root` is reached through a symlinked path and the desk is still recognized as part of the estate — catches a fix that resolves `top` differently rather than fixing `wt_root`'s own resolution.
- A second mutation case confirming the existing non-symlink refusal (a worktree genuinely outside the estate) still refuses — catches a fix that resolves too permissively and stops refusing anything.

Plus: run `node /Users/jwloka/Quatico/Agentic-Tools/plot/skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it finds the tests that name your changed files, the related tests and typecheck for `packages/fleet` and `packages/domain` if touched, and the gate tests and `scripts/check-*.sh`. The suites in the `CI suites` config key (`pnpm run test:e2e`, `test:contracts`, `test:board`, domain coverage, `test/reconcile/*.test.mjs`) run in CI on every PR; do not run them locally as a matter of course — a failure there comes back as a correction. `test:e2e` especially is CI's gate, not a local one (CLAUDE.md, Testing).

Name the shell gate: `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. This branch touches `plot-fleetctl.sh` (a one-line fix to `resolve_wt_root`), which is shell under `skills/` — if the fix needs more than roughly one line net, remove an equal number of lines elsewhere in the same change, or push the guard logic into the domain and reach it through a bundle instead of growing the shell.

### Bookkeeping

Open the PR through the controller once a commit exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch, ready
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Do not run `gh pr create` — the controller reads the plan, names the PR after the wave heading, and carries the plan + this brief in the body. Push the first real commit as soon as it exists; append `→ #<number>` to this branch's line in the plan's `## Slices` section once the PR opens.

### Scope guard

**This branch owns:**
- `packages/fleet/src/shared/fleet-clock.ts` and/or `packages/fleet/src/shared/auto-writes.ts` (the stop-gate on `maybeAutoDispatch`)
- `packages/domain/src/rules/` — only if a small new verdict file is added for the stop-gate decision
- `skills/plot/scripts/plot-fleetctl.sh` (`resolve_wt_root`, the `pwd -P` fix)
- `packages/fleet/test/unit/fleet-scan-clock.test.ts` (new stop-race tests)
- `test/reconcile/fleetctl.test.mjs` (new symlink mutation tests)

**Sibling branches in the same wave, verified against the plan's `## Slices` section (none merged yet, so verify current state at dispatch time rather than trusting this list):**
- `bug/fleetd-tick-guard-and-escalations` — `notifyEscalations`, `EscalationMemory`, the empty-log tick reading. Different files in the fleet-clock area (the tick guard itself, not the after-step) — close read of `fleet-clock.ts` diffs against this branch's diff is worth doing before merge if both land near the same time, since both touch that file.
- `bug/fleetd-once-and-channel-output` — `--once` pipe output, channel retry/newline/bound line, the other #1526 bullets. Touches channel code, not the scan/dispatch path — low collision risk.
- `bug/fleetd-unit-harness-findings`, `bug/fleetd-retries-usage-limit-brief`, `bug/refused-hold-names-its-reason` — different subsystems (test harness, usage-limit retry, board/domain refusal display); no expected file overlap.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
