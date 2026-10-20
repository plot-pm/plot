## Implementation brief — continue-route-increments-relaunches-across-two (wave 1: Wait for the first worker)

- **Plan (canonical):** `docs/plans/2026-10-20-continue-route-increments-relaunches-across-two.md` on main
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2174 merged
- **Branch:** `bug/continue-route-increments-relaunches-across-two` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention (`Review: pr`)

Single-wave plan, single branch: nothing waits on it and it waits on nothing.

### What to build

A test-only fix. `increments relaunches across TWO relaunches` (`packages/board/test/unit/continue-route.test.ts`, around `:465-495`) fails intermittently with `409 !== 202` at the second `postTo`: PR #2141's `board-integration` job (run 39359910777, head 7d91b6c1d) failed there, and a re-run of the same head passed. The second continue reaches `loop-alive` while the first relaunch's `true` worker is still running, so the handler refuses it.

`settle(wt)` (`:200`) returns at once unless `wt` is in the `spawned` set (`:201`), and the test's `await settle(wt)` at `:476` is meant to be the wait. Step one is to confirm why it no-ops: `postTo` (`:436`) adds `path.dirname(prompt)` only when the 202 body carries a `prompt`. Either the body has none, or the dirname differs from `wt`. Print both in a scratch run and record which one holds in the PR body.

The fix follows #2122 (`fc40f7b17`), which closed the same race for the #2107 block: `spawned.add(wt)` immediately before `settle(wt)`, as at `:1560`, `:1620` and `:1646`. Then rewrite the comment at `:473-475`, which says `settle` already guarantees the wait. It must say what makes the guarantee hold: `wt` is tracked in `spawned`.

### Settled decisions — do not re-derive them

- **Fix the test, not the handler.** `loop-alive` is correct: a live worker must refuse a second continue (that is #2107's rule). A sleep or retry in the test would hide the race instead of closing it.
- **An explicit `spawned.add(wt)` is the default fix.** Change `postTo` only if the first check shows the 202 body carries no `prompt` for every test, not only this one. If `postTo` changes, say why in the PR body.
- **The other `settle(` call sites need an audit, not a rewrite.** Current sites: `:243`, `:257` (inside `settle`'s own tests), `:476`, `:549`, `:1561`, `:1621`, `:1647`. Of these `:549` has no `spawned.add` on its path in a grep of the file and is the first suspect. Fix a site only when its path really lacks the add, and list each site with its verdict in the PR body.
- **Unchanged rule:** an absent pid file after `settle` is a failure (`assert.fail` at `:208`), never a silent pass.

### Done when

The plan's slice line is the specification: `wt` is added to `spawned` before `settle(wt)`, the comment is corrected, and every other `settle(` site is audited. Plus:

- **Fail-before, pass-after proof.** Run the test 50 times in a loop on the unfixed file and on the fixed file, for example with `node --test --test-name-pattern 'increments relaunches across TWO' ` or the vitest equivalent the board uses. The unfixed file must fail at least once; if it never fails, the race is not reproduced and the fix is unproven. Add load (`yes > /dev/null &` x2) if 50 runs pass on the unfixed file. Record both counts in the PR body.
- Changeset: none required beyond the plan's `None` changelog line; run `./scripts/check-changeset-packages.sh` if a file is added.
- Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI; a failure there comes back as a correction. Do not run `test:e2e` locally.
- `scripts/check-shell-lines.sh` refuses growth in shipped shell. This slice touches no `.sh` file.
- New helper code in the test file is an arrow function, not a declaration.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). Append `→ #<number>` to the branch's line under `## Slices` in the plan. Push the first real commit as soon as it exists. The PR body closes #2148.

### Scope guard

This branch owns `packages/board/test/unit/continue-route.test.ts` only. The related #2122 and #2107 work is merged. No other branch of this plan is in flight. If the audit finds a gap outside this file, report it rather than improvising.
