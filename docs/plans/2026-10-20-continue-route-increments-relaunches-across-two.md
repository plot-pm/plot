# continue-route: "increments relaunches across TWO relaunches" races the first worker and answers 409

> The test sends its second continue before the first relaunch's worker has exited, so `loop-alive` refuses it with 409.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #2148
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2174 merged
- **Started:** 2026-10-20, Jan Wloka, `bug/continue-route-increments-relaunches-across-two`

## Changelog

- None. The change is test-only and ships no user-facing behaviour.

Board impact: none. The plan format, template, helper scripts and `docs/plans` layout are untouched.

## Motivation

On 2026-10-20 the `board-integration` job of PR #2141 (run 39359910777, head 7d91b6c1d) failed at `packages/board/test/unit/continue-route.test.ts:489` with `409 !== 202`. #2141 changes only `.github/workflows/ci.yml`, and a re-run of the same head passed. A flaky test fails unrelated PRs and teaches contributors to re-run instead of read.

## Design

### Approach

The test `increments relaunches across TWO relaunches` calls `await settle(wt)` before its second continue, and still races. `settle` (`continue-route.test.ts:200`) returns at once unless the directory is in the `spawned` set (`:201`). This test starts its first worker through `postTo`, which adds a directory to `spawned` only when the 202 body carries a `prompt` (`:440-443`). The test's first call goes through `postTo` and the code reads `first.body` for `pid`, so the first step of the work is to confirm which of the two holds: `wt` is never added, or `path.dirname(prompt)` differs from `wt`. Either way `settle` no-ops, the second request reads the first worker's pid as alive, and `loop-alive` answers 409.

The fix follows #2122 (`fc40f7b17`), which closed the same race for the #2107 block: add `wt` to `spawned` explicitly before `settle(wt)` (`spawned.add(wt)`, as at `:1560`). The test then waits for the first worker to exit, and it measures the relaunch count instead of the race.

The stale comment at `:473` says `settle` already guarantees this. It should state what makes the guarantee hold.

Other tests that call `postTo` and then `settle` may share the gap. The slice greps for every `settle(` call and confirms each one has a `spawned.add` on its path.

### Open Questions

- [ ] Does `postTo` add `wt` to `spawned` for this test, or does the 202 body carry no `prompt`? The answer decides between an explicit `spawned.add(wt)` and a change to `postTo`.
- [ ] Do other `settle(` call sites rely on `postTo` and share the gap?

## Slices

### Wait for the first worker

- `bug/continue-route-increments-relaunches-across-two` — add `wt` to `spawned` before `settle(wt)` in the TWO-relaunches test, correct the comment at `:473`, and audit the other `settle(` call sites. Verify by running the test 50 times in a loop on the fixed and the unfixed file: the unfixed file must fail at least once.

## Notes

Source: https://github.com/plot-pm/plot/issues/2148. Related: #2122, #2107.
