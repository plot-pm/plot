# Testability juror: restart-refuses-unknown-branch-when-it

Position: amend

## Lens

Testability: is every behaviour asserted on a domain property or a script contract without a browser, does each named test fail before the change and pass after, and can the test run without touching the operator's real fleet, launchd or port 7777?

## Findings

1. **An existing test asserts the old behaviour and the plan does not name it.** `packages/fleet/test/unit/restart-command.test.ts:54-57` is `it('refuses unknown-branch where there is no pulse at all')` and calls `restartBranch({ opts, pulse: null, branch: 'feature/nope', caller: 'person' })`, expecting `reason: 'unknown-branch'`. After the change this test fails. The plan says "A unit test injects `pulse: () => null`" as if the case is new. An agent that adds a second test leaves the old one red, or "fixes" it by weakening it. The plan must say: rewrite `:54-57` to expect `no-pulse` and its detail. That rewrite is also the fail-before/pass-after proof: the rewritten test fails on origin/main and passes after.
2. **The seam the plan names is the entry's, not the rule's.** `pulse: () => null` is the `RestartCommandDeps.pulse` seam of `run` (`packages/fleet/src/server/entry/restart-command.ts:30`, `:86`). `restartBranch` takes `pulse: FleetReading | null` (`packages/fleet/src/shared/restart-command.ts:36`). Both are fine without a browser, fleet, launchd or port: the existing refusal tests at `:49-61` use `opts` pointing at no real repository and refuse before any reader or monitor runs. The plan should name which layer each test asserts at. Recommended: assert the reason on `restartBranch` (rule), and one `run([...], ..., { pulse: () => null })` test asserting exit 1 and the stderr line `plot-restart-command: no-pulse: the fleet has written no current reading` (script contract). The entry test needs a git repository for `refsGit().repoRoot()` (`:78-82`), so it needs an `mkdtemp` repo like `:87-102`, removed by its exact name.
3. **The third branch of the ordering has no test.** The plan defines three outcomes: no pulse and no worktree gives `no-pulse`; a pulse without the branch gives `unknown-branch`; else `no-worktree`. It also says a named worktree with no pulse does not refuse `no-pulse` (`PLOT_RESTART_WORKTREE`, `restart-command.ts:116`). No test in `restart-command.test.ts` covers `pulse: null` plus `worktree: '<path>'` today (grep for `worktree:` finds only `:202`, a `continueOnDesk` call). Without it, an implementation that checks `input.pulse === null` first and ignores `input.worktree` passes both named tests and breaks `plot-dispatch.sh --restart` (`skills/plot/scripts/plot-dispatch.sh:1839`). Required test: `pulse: null`, `worktree` set, readers that refuse (for example `pr` answering `reachedReview: true`), assert the reason is NOT `no-pulse` (it reaches `reached-review` 409). That runs with injected readers and a stub `monitors`, so it touches no fleet or launchd.
4. **"Board impact: none" is false, and the board typecheck is the test that shows it.** `ContinueRefusal` (`packages/fleet/src/shared/continuation.ts:99`) is the union a new reason joins. `refusalWord` (`packages/board/src/app/components/ContinueWithAnAnswer.tsx:34-76`) is a `switch` with no `default` and return type `string`, under `"strict": true`. Adding `'no-pulse'` without a case fails `pnpm run typecheck` (TS2366). The board route `POST /api/restart` (`packages/board/src/server/restart.ts:65-80`) calls the same `restartBranch` with `pulseFor` (`packages/board/src/server/fleet.ts:3301`), which returns `FleetReading | null`, so the board also emits `no-pulse`. The slice must add a `refusalWord` case and extend the reason list in `packages/board/test/unit/continue-control.test.ts:57-64` so the "distinct sentence" test covers it. `restart-route.test.ts` should gain one case: `pulse: () => null` gives 404 (or the chosen status) and `reason: 'no-pulse'`. All three are unit tests with injected seams and no browser; `restart-route.test.ts` uses port 4399 in `opts` and opens no socket.
5. **The status code is an open question that a test must pin.** Open Question 2 (404 or 503) changes the assertion in every new test. A person decides it before approval, or the plan states the default is 404 and the tests assert 404.
6. **Doc text names the old refusal set.** `skills/plot/scripts/README.md:86` and the TSDoc at `packages/fleet/src/server/entry/restart-command.ts:17-18` and `packages/fleet/src/shared/restart-command.ts:105-106` list `unknown-branch` and `no-worktree` only. No test catches them; the slice should update them.
7. **Bundle:** `skills/plot/scripts/board/plot-restart-command.mjs` is generated; the slice must not commit it (`scripts/check-no-bundle-diff.sh`). No test change needed.

## Amendments required

- A1. Name `packages/fleet/test/unit/restart-command.test.ts:54-57` as the test to rewrite to `no-pulse`, and state it fails on origin/main.
- A2. Add a test for `pulse: null` with a named worktree that does not refuse `no-pulse`.
- A3. Add one entry-level test through `run(..., { pulse: () => null })` asserting exit 1 and the stderr line, in an `mkdtemp` repository.
- A4. Replace "Board impact: none" with the board changes: `refusalWord` case, `continue-control.test.ts` reason list, `restart-route.test.ts` no-pulse case.
- A5. Settle the status code, or state 404 as the default the tests assert.
- A6. Update the three doc sites in finding 6.

## Decisions for a person

- 404 or 503 for `no-pulse` (Open Question 2).
- Whether `continue` (`continue-command.ts:74-90`, same `branchFromPulse(null)` path) gets its own slice now (Open Question 1). Its test file would carry the mirror of finding 1.

## Ran versus read

Ran: `git show origin/main:` on the files above, `git grep` for `unknown-branch`, `ContinueRefusal`, `PLOT_RESTART_WORKTREE` and `pulseFor`, `gh issue view 3100`. Read only: the test files' bodies. No test suite, typecheck, board or fleet command ran; the TS2366 claim in finding 4 is inferred from the switch shape and `strict: true`, not observed.
