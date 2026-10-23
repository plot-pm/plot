## Implementation brief — bounded-run-group-stop-test-times (wave: Group-stop test timeout)

- **Plan (canonical):** `docs/plans/2026-10-23-bounded-run-group-stop-test-times.md` on `main`
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2381 merged
- **Branch:** `bug/bounded-run-group-stop-test-times` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

The plan has one wave with one branch. Nothing waits on it and it waits on nothing.

### What to build

`packages/domain/test/bounded-run-group-stop.test.ts` fails with `Test timed out in 5000ms` on a loaded runner. Observed twice in two days: 2026-10-21 (run 39652704158, plan PR #2292, passed on rerun) and 2026-10-23 (run 39920891443, `main` at 4052903ee). Each time it turned `validate` red with no code change, and 6539+ other domain tests passed.

The cause is read from the file, not reproduced. The group-stop test (`:96`) and the three signal tests (`:208`) set no timeout, so vitest's default 5000 ms applies. Inside it each test waits up to 10 000 ms for `READY` (`:69`, `:108`) and then up to 5000 ms per pid in `waitForExit` (`:46`). The inner bounds sum to more than the outer one, so the outer bound fires first whenever Node start-up, the strip-types loader or the kill is slow. The sibling test at `:176` already carries `20_000` (`:206`) and a comment on why its own bound is 4 s; the others carry neither. The caller-exits-normally test at `:142` has the same shape and the same default.

Start by reproducing under load (parallel `vitest` or `node --test` processes) and record which of the three steps overruns: readiness, kill, or exit poll. That answers the plan's first open question and decides which bound moves.

### Settled decisions — do not re-derive them

- **Raise the per-test timeout; do not shorten the inner waits.** The inner bounds (10 s readiness, 5 s exit) are what produce a message naming the surviving pid. The outer bound must exceed their sum, so it moves, and they stay.
- **One named constant, shared by every test that has this shape** (group stop, caller exits, the three signal tests; the bound-fires test already has `20_000` and takes the constant too). The plan's second open question is answered by the smaller diff: one shared constant. Write a comment stating the sum it covers (readiness 10 s + exit wait), factually and with no history.
- **Wait on events where an event exists.** The wrapper has an `exit` event (the signal tests already use it at `:211`); the grandchildren are not our children and have only `waitForExit`. `waitForExit` keeps its limit as a bound that fails with the pid in the message, not as what ends the test.
- **Do not add a retry.** A retried test hides a real group-stop regression half the time; the timeout fix is the whole fix.
- **Do not touch `bounded-run-process.ts`.** It is correct and this plan names a test file only. Its comment *"NO `detached`"* (`:109`) is the contract the test proves.
- **Arrow functions and factual TSDoc** in anything written (`CLAUDE.md`, The Domain Package). The repo's earlier fix for process-timing flakes, `flaky-process-timing-tests` (#1850), did not cover this file; do not widen into the five tests it did cover.

### Done when

The plan carries no `## Done when` list; its `### Approach` steps are the specification. Lift these as the assertions:

1. **Reproduction recorded.** The PR body states which step overran under load and how the load was produced. Without it the constant is a guess.
2. **The detached-prompt mutation still fails the test.** In `bounded-run-process.ts:111`, add `detached: true` to the `spawn` options, run the file, and confirm the group-stop test fails on `prompt … survived the group stop`. Restore the adapter from git (`git checkout -- <file>` reverts to HEAD, so commit the test change first). A timeout raised too far, or an exit wait loosened, could pass without the adapter ever being stopped; this catches it.
3. **The file passes under the same load that failed before.** Run it repeatedly (for example 10 times in a row, with the load running), not once.
4. **The mutation run happens on a clean tree.** Commit before mutating, then confirm the baseline is green between mutations.

Plus: this is a test-only change, but a changeset is still the repo's convention for a PR. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints (it names the domain `vitest related` and `tsc --noEmit` for `packages/domain`); the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Order a changeset as description first, `bumps:` block last, and run `./scripts/check-changeset-packages.sh`. No `.sh` file under `skills/` is touched, so `scripts/check-shell-lines.sh` has nothing to charge.

Run the domain test with Node 24 (`nvm use`); pnpm crashes on Node 26.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while it moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/test/bounded-run-group-stop.test.ts` and its changeset. It may read `packages/domain/test/fixtures/bounded-run-group-standin.mjs` and `packages/domain/src/adapters/bounded-run/bounded-run-process.ts`, and mutates the latter only temporarily. No other branch of this plan is in flight. Sibling work in the sprint `bugfix-2-28-1` is not known to touch these files.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
