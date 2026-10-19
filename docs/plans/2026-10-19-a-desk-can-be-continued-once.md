# A desk can be continued once: the continued run leaves no manifest

> A desk whose continued run ends with a question gets a manifest or a fallback that names it, so a second `plot-continue-command.mjs` on the same desk is accepted.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #2107
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2114 merged
- **Started:** 2026-10-19, Jan Wloka, `bug/a-desk-can-be-continued-once-test`

## Changelog

- Fix: a desk can be continued again after a continued run ends with a new question. The second `plot-continue-command.mjs` call no longer refuses `no-manifest`.

<!-- Board impact: none for the plan format, template or docs/plans layout. The change is in the continuation path and the continue-target rule. -->

## Motivation

On 2026-10-19 the desk `.worktrees/free-fcd71bc3` (`bug/a-click-on-a-plan-story`) was continued with `plot-continue-command.mjs` at about 14:00 UTC (`continued bug/a-click-on-a-plan-story: pid 68167 (replaces 77358)`). That run opened PR #2104 and wrote a new `PLOT-BLOCKED` marker at 15:07 UTC. A second continue at 15:10 UTC refused: `no-manifest: no manifest names .../free-fcd71bc3`. `.worktrees/free-7edb8d31` hit the same refusal earlier that day. A desk can be continued once and then only reaped.

How the refusal arises, from the code on `main`:

- `continueTarget` (`packages/domain/src/rules/continue-target.ts`) continues by stamping a manifest that names the desk (`named`). When none names it (`unnamed`), it falls back to writing one, but only when the desk's ending record reads `blocked`, `holding-work` or `unstarted` for the asked branch. Any other ending answers `no-manifest`.
- A loop removes its own manifest when it ends (`onStop` in `worker-loop.ts`, and `continuation.ts` documents that a stopped loop removes it). After a continued run ends, no manifest names the desk, so the ending record alone decides.
- `NEEDS_PERSON_ENDINGS` (`packages/domain/src/rules/ending-action.ts:213`) lists five endings that ask a person: `blocked`, `spend-limit`, `unstarted`, `run-limit` and `checks-unanswered`. The fallback accepts three of them.

**Leading hypothesis, not yet verified:** the continued run on `bug/a-click-on-a-plan-story` ended `checks-unanswered`. PR #2104 had `mergeable: CONFLICTING` and no build could start, which is the case plan `a-desk-waits-for-ci-on` (#2106) addresses. The loop wrote a `PLOT-BLOCKED` marker for that ending, and `continueTarget` refused it because `checks-unanswered` is not in the fallback's list. `spend-limit` and `run-limit` endings would refuse the same way. The ending record of both affected desks was not captured, so the first slice reads it before the fix is chosen.

## Design

### Approach

1. **Reproduce before fixing.** A test continues one desk twice: the first continue writes or stamps a manifest, the fake loop ends with each of the five `NEEDS_PERSON_ENDINGS` reasons and a `PLOT-BLOCKED` marker, and the second continue is asked. The test fails for every reason the fallback does not accept, and that list is the measured scope of the bug. The issue asks for this test by name.
2. **Choose one of two fixes from the result.**
   - **A. Widen the fallback.** `continueTarget` accepts every ending whose marker asks a person and whose branch matches. The set is derived from `NEEDS_PERSON_ENDINGS` and not copied, so a sixth ending cannot make the same hole.
   - **B. Leave a manifest.** The continued run's end keeps or restores the desk manifest when a `PLOT-BLOCKED` marker is in the tree, so `named` answers and the fallback is not needed. This changes `worker-loop.ts` and the stop path from #2052 (manifest written last, restored on a stop timeout).

   A is the smaller change and stays in the domain rule. B matches the issue's wording (*leaves the desk with a manifest that names it*) and keeps `named` the normal case. The first slice's result decides: if every refused ending is in `NEEDS_PERSON_ENDINGS`, A is enough; if the desk also lost its ending record or the branch differs, B is needed.
3. The rule keeps its guard: an absent or unreadable ending record still answers `no-manifest`, and a different branch still refuses. Widening the accepted reasons does not widen what counts as evidence.

### Open Points

- [ ] Which ending did the two affected desks (`free-fcd71bc3`, `free-7edb8d31`) record? Read `.plot-worker.ending.json` in each worktree before the fix is chosen.
- [ ] A or B, per Approach step 2.
- [ ] Whether `spend-limit` and `run-limit` should continue at all: a continue on a spent budget may refuse for the budget (`runs` check in `continuation.ts`) and not for the manifest. The test asserts the refusal name.

## Slices

### Reproduction

- `bug/a-desk-can-be-continued-once-test` — a test continues one desk twice for each ending reason in `NEEDS_PERSON_ENDINGS` and records which second continues refuse <!-- builds: a two-continue test over NEEDS_PERSON_ENDINGS --> → #2122

### Fix

- `bug/a-desk-can-be-continued-once-fix` — the chosen fix (A or B) with the test from the first slice passing <!-- waits: bug/a-desk-can-be-continued-once-test -->

## Notes

- Created from tracker issue #2107. Related: #1373, #2052, #2106 (`a-desk-waits-for-ci-on`). Definition of Done: `docs/definition-of-done.md`.
