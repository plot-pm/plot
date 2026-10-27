# Juror: gates

Position: amend

The defect is real and the gate is worth having. The gate as the plan defines it cannot be built precisely, and it does not need to be: a blanket refusal of `process.exit` under `entry/`, with one drain-then-exit helper outside `entry/`, is exact, costs zero shipped shell lines, and is the only acceptance check that fails on Linux CI. It must land in the same slice as the conversion.

## 1. The problem (gate-relevant facts)

- **Ran** `grep -rn "process.exit(" packages/*/src/server/entry/` in the main worktree: 66 lines in 59 files (60 board, 6 fleet). This matches the plan's count.
- **Read**: 63 of the 66 are the tail call `process.exit(run(...))` or `process.exit(await run(...))` inside the `if (process.argv[1] && import.meta.url === ...)` block. `main.ts:249` is `.then((code) => process.exit(code))`. The other three are early usage exits: `plan-for-branch.ts:47`, `transition.ts:364`, `review-bypass.ts:148`.
- **Read**: `review-bypass.ts:147-148` writes a usage line to stderr and then calls `process.exit(2)`. An "early exit with nothing written" is therefore not a clean category either.
- **Read**: outside `entry/`, `process.exit(` appears at `board/src/server/index.ts:1020`, `lifetime.ts:104,201`, `fleet/src/shared/board-run.ts:72`, and two domain signal handlers (`agent-run-sdk.ts:318`, `bounded-run-process.ts:82`). All are server lifetime or signal paths. They do not belong in the gate's scope (answers open question 4: no).
- **Read**: entries also exit through an injected process object: `registryd-main.ts:2060` (`proc.exit(SIGNAL_EXIT[signal])`), `:2917` (`proc.exit(1)` on start failure), `worker-loop.ts:2003` (`target.exit(...)` in a signal handler). A text gate on `process.exit` does not see these. They are signal and start-failure paths, so this is acceptable, but the plan must state it as a named limit.

## 2. The approach against the code

- **Ran** on this Mac: `process.stdout.write('x'.repeat(1e6)); process.exit(10)` piped to `wc -c` prints `65536`. `process.stdout.write(big); process.stdout.write('', () => process.exit(10))` prints `1000000` and exits 10. The same drain-then-exit with a live `setInterval` also prints `1000000`.
- So a drain-then-exit helper delivers the whole answer and still ends a process whose loop is kept alive. Plain `process.exitCode = code` can hang an entry that holds a handle. `worker-loop.ts:2598`, `desk-loop.ts:86` and `dispatch-command.ts:225` (it spawns a child, `:190`) are the candidates; I did not trace their handles.
- **Recommendation**: replace the plan's "shared ending if three or more need it" with one shared ending for every entry. The condition "three or more need the close-then-set shape" is not decidable without tracing every entry, and the helper costs nothing for an entry with no handles. It also keeps today's force-exit semantics, so no entry can start to hang. Precedent exists: `registryd-main.ts:2908` `settleOnce` already encodes this choice for one entry.
- Put the helper outside `entry/` (for example a shared server module per package, or one module both packages import). Then the gate needs no exception list at all.

## 3. Safety (gate side)

- A gate at zero over `entry/` cannot change an exit code or a signal handler: it reads source text only.
- The hang risk sits in the conversion, not the gate. The shared drain-then-exit helper removes it (ran, above). An `exitCode`-only conversion would need a per-entry handle trace that the plan does not budget.

## 4. The gate

- **The plan's definition does not hold.** "A `process.exit(` that follows a `process.stdout.write` or an `out`/`write` callback bound to stdout in the same file" is not decidable by grep. Read: most entries pass a write callback into `run`, and the actual writes happen inside `run` or in domain code. Textually, every tail `process.exit(run(...))` follows a call that writes. The early exits also write (stderr at `review-bypass.ts:147`). The "follows a write" test therefore separates nothing, and the allow-list it implies (`transition.ts:364` as a named exception) has no stable criterion.
- **A precise gate exists and is simpler**: refuse every `process.exit` token in a non-comment line of `packages/*/src/server/entry/*.ts`. Zero, no ratchet, no allow-list. Convert the three usage exits with the rest. This answers open question 1 without a call graph: the helper is the only sanctioned exit, and it lives outside the scanned path.
- **Comments must be skipped.** Read: `listing-walk.ts:77` and `registryd-main.ts:2894` mention `process.exit` in comments that explain this very rule. A gate that fires on them fails on its first run.
- **Form: `scripts/check-entry-exit.sh`, not a lint or a vitest test.**
  - Read: the repo has no ESLint config (ran `ls` for `eslint.config.*`, `.eslintrc*`: none). Adding ESLint for one rule is out of proportion.
  - A vitest source-scan test does not import the entries, so `vitest related --run {changed}` in the `Local checks` key never selects it for a new entry file. It would run in CI only, and only in one package's suite while the rule spans `board` and `fleet`.
  - An inline `ci.yml` grep (the precedent is "Domain function-style gate", `ci.yml:1726`) is CI-only.
  - A `scripts/check-*.sh` runs locally through the `**` line of `Local checks` and in CI. Its contract test `test/reconcile/entry-exit-gate.test.mjs` matches the existing glob `node --test test/reconcile/*gate*.test.mjs`, so the test runs locally with no config change.
- **Shipped shell cost: zero.** Read: `check-shell-lines.sh` counts `git ls-tree -r --name-only "$rev" -- skills` only, and its `--per-file` output names `scripts/*.sh` as "not counted above". `check-decision-count.sh` counts README rows under `skills/plot/scripts/`, so it is not touched either.
- **bash 3.2**: read: `check-bash32-syntax.sh` scans `ROOTS='skills scripts'`, so the new script is held to 3.2. A `grep -rnaE` plus a comment filter needs nothing newer. Use `-a`, per the NUL-byte precedent (`ci.yml:1710`).
- **Wiring cost**: one more `&& ./scripts/check-entry-exit.sh` in the `Local checks` `**` line of `CLAUDE.md` (which forces `./scripts/check-agents-md.sh --write`), one `ci.yml` step, and the contract test. The test must cover: refuses a tail `process.exit(run(...))`, refuses `.then((c) => process.exit(c))`, ignores a comment line, ignores a file outside `entry/`, passes on the repo tree. Mutation-test it (drop the comment filter, widen the path) before believing it.
- **Should slice 2 exist separately? No: fold it into slice 1.** The gate at zero fails on today's tree (66 sites), so it cannot land first, and a separate later slice leaves slice 1's claim "every `process.exit(` ... sets `process.exitCode` instead" with no check. The gate IS slice 1's completeness proof. A ratchet is not needed, because one branch converts every site.

## 5. Slices against Changelog and acceptance

- The Changelog line (whole stdout reaches a pipe reader on macOS) is observable only on macOS. The plan's own Open Question 3 is correct: a pipe test passes on Linux with the old code.
- The static gate is the only acceptance that fails on today's code on both macOS and Linux CI. That is a further reason to ship it with the conversion.
- Keep one behavioural test as well: drive one large-output entry (`reconcile.ts` or `merge-subject.ts`) through a real pipe with more than 64 KB, as `da194bcaf` did, and one unit test of the shared helper with a stubbed asynchronous stdout. The stub test fails on Linux too; the pipe test proves the macOS symptom.

## Named amendments

1. Redefine the gate: no `process.exit` token in non-comment lines under `packages/*/src/server/entry/`, at zero, no allow-list, no ratchet. Drop "follows a stdout write".
2. Replace "a shared ending if three or more need it" with one drain-then-exit helper outside `entry/`, used by every entry (`process.stdout.write('', () => process.exit(code))`, also flushing stderr). Convert the three usage exits too.
3. Merge the Gate slice into the Entries slice; the gate is that slice's acceptance.
4. Implement it as `scripts/check-entry-exit.sh` plus `test/reconcile/entry-exit-gate.test.mjs`, wired into the `Local checks` `**` line and `ci.yml`. State in the plan that it adds 0 shipped shell lines.
5. Name the limit: an injected `proc.exit(` / `target.exit(` (`registryd-main.ts:2060,2917`, `worker-loop.ts:2003`) is invisible to the gate, and these are signal or start-failure paths. Close open question 4: `index.ts`, `lifetime.ts`, `board-run.ts` and the domain adapters stay out of scope.
