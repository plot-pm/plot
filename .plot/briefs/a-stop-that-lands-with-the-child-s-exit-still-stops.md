## Implementation brief — the-bounded-run-group-stop-test (wave 1: Late signal)

- **Plan (canonical):** docs/plans/2026-11-01-the-bounded-run-group-stop-test.md on main
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3019 merged
- **Branch:** `bug/a-stop-that-lands-with-the-child-s-exit-still-stops` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** per repo convention (PR review)

Slice 2 (`bug/the-group-stop-test-tells-a-slow-stop-from-a-survivor`) waits on this slice. Alone, slice 2 renames the failure and leaves `main` red at the same rate.

### What to build

`boundedRunProcess` (`packages/domain/src/adapters/bounded-run/bounded-run-process.ts`) drops a SIGTERM, SIGINT or SIGHUP that reaches its caller in the same event-loop turn as the child's end. `finish()` removes the last signal listener on `close`, Node stops the signal watcher, and libuv drops the queued signal. The caller keeps running. Measured on macOS v26.13.0: `SURVIVED` 10 of 11 with the child ending during a 1 s block and SIGTERM at 0.5 s; Linux `node:26` child-first `SURVIVED` 2 of 2. This failed `main` at `926339afd` (job 124912486260) as `wrapper 66195 survived the group stop`, issue #3010.

Build: one listener per ending signal for the process, added on the first run and never removed. The module counts live runs; `finish()` decrements the count and removes no signal listener. The listener decides:

- one or more live runs: `process.exit(128 + n)` (the `exit` listeners kill each run's tree);
- no live run, and another listener exists for that signal: return, and let that listener act;
- no live run and no other listener: `process.exit(128 + n)`.

State the contract in the doc comment of `packages/domain/src/ports/bounded-run.ts`: a run never swallows an ending signal sent to its caller. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

- **A delayed removal (`setImmediate`) is not the fix.** A signal arriving between the read of the signal pipe and the removal is still dropped; the delay only narrows the window.
- **No listener removal in `finish()` at all.** Removing per run is the defect; the first Done-when row fails if you restore it.
- **No retry, second signal, SIGKILL fallback or longer bound.** Each would turn a red case green and hide the lost signal.
- **Exit code 143 with no run and no other listener** keeps the regression test's discriminator: 143 means the adapter's handler ran.
- **Callers with their own listener** keep their behaviour: during a run the adapter still exits synchronously (`worker-loop.ts` `onStop` comment, `:2005-2007`); between runs the caller's listener alone acts (`onStop`, `pr-reader.ts:256`, fleetd `stopOnSignals` in `registryd-main.ts`).
- **Slice 1 does not touch the group-stop test.** The slow-stop cause (`killTreeSync` calling `pgrep` per node with no timeout) is slice 2's message and a named follow-up, not this slice.
- A zombie wrapper read as alive was refuted; do not chase it.
- Repo rules: absent is not false; a regression test forces the signal order by state (the stand-in waits until `ps -o stat=` reads the prompt as `Z`), never by a sleep or busy loop of a set length. Container reproduction needs `docker run --init`.

### Done when

The plan's `## Done when` rows for slice 1 are the specification, in `packages/domain/test/bounded-run-late-signal.test.ts`:

1. `--late-signal` stand-in mode: after `READY`, in one synchronous block, kill the prompt, wait until `ps -o stat=` reads it `Z`, then send itself SIGTERM. The stand-in exits 143 inside a bound. This row catches a fix that only works when the signals arrive apart; it fails on `origin/main` on macOS and in `node:26` with `--init`.
2. A second live run keeps the stop: two runs, the first child ends, SIGTERM gives exit 143 and both trees die. This catches a count that drops to zero too early.
3. A caller's own `once('SIGTERM')` that exits 7 after an `await`, one finished run, SIGTERM: exit 7, not 143.
4. No listener, no run, SIGTERM: exit 143.

Mutation check: restore the per-run `removeListener` in `finish()` and row 1 must fail.

Plus: a changeset for package `plot` (description first, `bumps:` block last). New and changed functions are arrows; TSDoc states behaviour, not history. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; CI runs the suites in `CI suites`. Run no full suite and no `test:e2e`. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` is not at stake.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line in the plan's `## Slices` section. The PR body lists each `boundedRunProcess` caller (`packages/board/src/server/entry/review.ts:573`, `packages/fleet/src/shared/agent-run-for.ts:83`, `packages/fleet/src/shared/auto-fixer.ts:617`, `packages/fleet/src/shared/repair-start-world.ts:47`, `packages/fleet/src/server/entry/worker-loop.ts`), its host process, and whether the host has its own listener. Push the first real commit as soon as it exists.

### Scope guard

Owned: `packages/domain/src/adapters/bounded-run/bounded-run-process.ts`, `packages/domain/src/ports/bounded-run.ts`, `packages/domain/test/fixtures/bounded-run-group-standin.mjs` (the `--late-signal` and own-listener modes), `packages/domain/test/bounded-run-late-signal.test.ts`, one changeset. Not owned: `packages/domain/test/bounded-run-group-stop.test.ts` (slice 2). The slices share no file with #3008's slices. If you find something the plan did not anticipate, report it rather than improvising outside scope.
