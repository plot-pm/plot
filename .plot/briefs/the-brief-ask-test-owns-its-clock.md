## Implementation brief — a-refused-start-is-retried-and-named (wave 1: Test clock)

- **Plan (canonical):** `docs/plans/2026-11-21-a-refused-start-is-retried-and-named.md` on `main`
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3614 merged
- **Branch:** `bug/the-brief-ask-test-owns-its-clock` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

Waves 2 to 5 of this plan wait on this branch. Wave 2 (`bug/a-refused-brief-is-asked-again`) edits the same test file, so merge this one first and keep the diff to the usage-limit `describe` block.

### What to build

Pin the clock of the usage-limit cases in `packages/board/test/unit/auto-dispatch-brief-ask.test.ts` so they no longer depend on the wall-clock hour. This is a test-only change: no source file under `packages/*/src` changes.

The failure it fixes (#3125): the stub prints `resets 11pm (Europe/Berlin)` (`:111`), and `resolveReset` resolves a reset up to `PAST_RESET_GRACE_SECONDS` (120 s) in the past to now (`packages/domain/src/rules/prompt-exit.ts:124`, `:258-261`). Between 23:00:00 and 23:02:00 Berlin time the recorded epoch equals now and the strict `toBeGreaterThan(nowEpoch())` at `:513` and `:552` fails. CI run 42117422301 failed on main at `87d93b8ae` with `expected 1793916015 to be greater than 1793916015`; 1793916015 is 2026-11-05 23:00:15 CET. The flake turns main red, which is why this slice runs first.

The plan's `### Approach › Test clock` section is canonical; this is orientation.

### Settled decisions — do not re-derive them

**Fake `Date` only, pinned at 2026-11-05T22:00:15Z.** In the `describe` block at `:501`, call `vi.useFakeTimers({ toFake: ['Date'] })` and `vi.setSystemTime(new Date('2026-11-05T22:00:15Z'))` before the fixture writes its stub, and `vi.useRealTimers()` after each case. `board-request-starts.test.ts:203` already uses the same `toFake: ['Date']` shape. Faking timers as well would stop the fixture's `sleep` and the child process's `settle` waits. `agentRunCommand` receives `now: Date.now` (`packages/fleet/src/shared/agent-run-for.ts:97`), so the fixture, `nowEpoch` and `resolveReset` read one clock.

**The stub moves two hours past the pin, and the expected epoch is a constant.** At the pinned instant `11pm (Europe/Berlin)` lies 15 s in the past, inside the 120 s grace. The stub therefore prints `1am (Europe/Berlin)`, and the expected epoch is 2026-11-06T00:00:00Z (`Date.UTC(2026, 10, 6, 0, 0, 0) / 1000`, which is 1793923200; derive it in the test rather than pasting the number). `RECORDS THE RESET EPOCH` (`:505-515`) and `A SECOND WAIT REPLACES THE EPOCH` (`:543-553`) assert the recorded epoch `toBe` that constant, not `toBeGreaterThan(nowEpoch())`.

**A third case keeps the old stub text at the pinned instant** (`11pm`, 15 s past) and asserts the recorded epoch equals the pinned now. That is the instant that failed in run 42117422301 and the grace rule working as designed. Without this case the fix passes by never visiting the failing instant again.

**`settle` reads `Date.now()` for its deadline, and a frozen `Date` makes that deadline inert.** `settle` (`:174-186`) computes `deadline = Date.now() + ceilingMs` and loops `while (Date.now() < deadline …)`. With `Date` frozen, a stub that never lands waits for the vitest test timeout instead of the 5 s ceiling, and the zero-case floor still works because it uses `sleep`. Do not unfreeze the clock with `shouldAdvanceTime`: the grace case asserts the epoch equals the pinned now, and an advancing clock fails that at a second boundary. Read the deadline from `performance.now()` inside `settle`. That is a helper-only change that leaves the other `describe` blocks' behaviour as it is. Say in the PR which of the two you chose if you choose another.

**Absent is not false.** A `settle` that times out is a failure to land, not proof that nothing ran. Keep the `want: 0` floor.

### Done when

The plan's `## Slices` line for this branch is the specification: fake `Date` pinned at 2026-11-05T22:00:15Z for the usage-limit cases, a stub reset two hours later, exact epoch assertions, and a grace case at the failing instant.

Assertions that exist because a naive implementation would pass without them:

- **Exact epoch equality in both limit cases.** A `toBeGreaterThan(nowEpoch())` against a frozen clock passes at any pin and catches nothing.
- **The grace case.** It fails if the stub text is moved off 11pm without a case that keeps it, and it proves the grace rule still resolves to now.
- **The pin, not the hour, carries the proof.** With the pin line removed in a scratch copy, the file must fail inside 23:00–23:02 Berlin time and pass outside it. If you cannot reach that hour, the grace case at the pin is the evidence; say so in the PR.

Plus: a changeset for `@plot-pm/board` (description first, `bumps:` block last; the changeset gate refuses a bare comment-open first line and a description under 20 characters). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally, and do not run board tests while the operator's board is open. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to charge.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while moving), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

You own the usage-limit `describe` block (`:501-565`) and, if you take the `performance.now()` route, the `settle` helper (`:174-186`) of `packages/board/test/unit/auto-dispatch-brief-ask.test.ts`, plus the stub text in the fixture (`:107-113`) and one changeset. In flight on the same file: `bug/a-refused-brief-is-asked-again` (wave 2, not started; it adds a `@reads-plan-at` stub, an `@ends-briefless` stub and new cases). Leave those areas alone. If you find something the plan did not anticipate, report it rather than improvising outside scope.
