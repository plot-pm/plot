## Implementation brief — a-desk-continuation-skips-its-run (wave: Tests and comments)

- **Plan (canonical):** docs/plans/2026-10-24-a-desk-continuation-skips-its-run.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2491 merged
- **Branch:** `bug/continuation-tests-assert-their-names` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` required check, per `docs/review-status-rollout.md`

This is the last wave of the plan. It waits on both `bug/a-failed-continuation-leaves-the-desk-as-found` (merged as PR #2590, commit present on `main`) and `bug/mergeability-uses-the-prs-own-base` (merged as PR #2618) — both are confirmed merged, so this branch is eligible to start from current `main`. Nothing else in the plan depends on this wave finishing.

### What to build

A cleanup-and-coverage slice over the test and comment surfaces the other four waves touched, per the plan's slice 5. Five things, each independently checkable on current `main`:

1. **Each continue-route and worker-loop test must assert what its name states, and print the refusal body on failure.** Read `packages/board/test/unit/continue-route.test.ts` and `packages/fleet/test/unit/worker-loop-run.test.ts` for assertions that pass regardless of *which* refusal came back (a bare `assert.ok(!result.ok)` where the test name names a specific reason) — add the reason check, and on failure print `result` (or its `why`/`reason` field) so a future failure shows the actual refusal instead of a bare `false !== true`.
2. **The fixture pid cannot be alive on a Linux runner.** `continue-route.test.ts:235` already has one Linux-aware pid-liveness assertion (`"the fixture pid … did not exit within 15s of SIGKILL"`); check the rest of the suite's pid fixtures (search `process.pid`, `alive(`, and the comment at line 467 about pid 424242) for the same risk — a hardcoded low pid or a same-process pid can collide with a real process on CI, where this repo's own memory already flags Linux-only reproduction issues as a recurring class.
3. **Guard rows for an unreadable ending record, checked against the worker log.** This is new coverage, not a rewrite: add a test (or tests) that write an unparseable `.plot-worker.ending.json` and assert the loop logs the `unreadable` path's diagnosis rather than crashing or silently treating it as absent — the `ending.ts` doc (`packages/domain/src/entities/ending.ts`) already states `unreadable` means "the bound ended it and no transcript could be read," which the test must drive, not just read.
4. **A hook replaces the copied `continueTwice` setup.** `continue-route.test.ts:1607` defines `continueTwice` as a local `async function` inside its describe block, and five tests (lines 1633, 1638, 1649, 1654, 1659) call it with a different `reason` each time. Check for a second, near-identical copy of this helper elsewhere in the file (the plan says "copied setup," singular helper duplicated) — fold the setup into a `beforeEach`/shared fixture so the five tests differ only in the reason string and assertion, not in the scaffolding.
5. **Comments state current behaviour only, no history.** Read `continuation.ts`, `agent-loop.ts` and the continue-route tests for comments that narrate *why* a past bug existed ("this used to fail because…", "fixed in PR #…") rather than what the code does now — rewrite or remove per `CLAUDE.md`'s "Factual API documentation" rule (states what, not the decision history; that belongs in the plan and commit message, not the comment).

Plus the three items the plan names as missing tests that land with this wave (not rewrites — new coverage):

- **Row 7's `resumeId`** — `continue-route.test.ts:1793-1864` already has a `writeUnstartedEnding` fixture and an assertion at line 1864 (`'resumes the ending's own handle, not the newer stranger'`). Confirm this row actually exists and is wired into the suite's run (not just present as dead code) — if it already passes, this item is done and the brief's "Done when" below should note it as already covered rather than re-added.
- **`continue-target` for spend-limit, run-limit and checks-unanswered** — check `continue-target.ts`'s existing test coverage for these three endings; the plan calls them out as currently untested after slice 1's run/spend-limit parser work landed.
- **`correctionHasContinuation` on an identical second answer** — `worker-loop.ts:762` defines it, referenced in a comment at `worker-loop-run.test.ts:2063` ("reads the real file, so this writes it too"), but check whether a test actually drives the *identical second answer* case (the same correction answered twice with the same text) rather than just the file-read mechanics.

### Decisions this plan settles — do not re-derive them

**`mergeConflictAtEntry` is already removed and `claim: unknown` is already gone — slice 4's removal landed with PR #2618.** A grep against current `main` for both strings returns nothing in `packages/domain/src/workflows/agent-loop.ts`, `packages/domain/src/rules/merge-conflict.ts`, or `packages/fleet/src/server/entry/worker-loop.ts`. If the plan's Changelog or this slice's own notes still reference them as pending, that's documentation drift to close, not code to touch.

**The two test-gap findings this plan cites by old line number (`continue-route.test.ts:1621`, `:496`, `workflows-agent-loop.test.ts:553`) no longer resolve to the same content** — four merged slices have reshaped both files since the issue was filed against `84b1638e4`. Locate the actual gaps by the *behavior* the plan's Motivation section names (run-limit/spend-limit refusal ordering, the `claim: unknown` refusal reason — now resolved per above), not by re-reading stale line numbers.

**Do not re-litigate slices 1-4's design choices.** The pid-ownership comparison (process start time vs. working directory), the shared-vs-duplicate limit parser, and the conflict-correction wording are all settled in the merged PRs (#2511, #2590, #2612, #2618) — read their diffs if you need to know which choice was made, but this slice only tests and documents the result.

**This slice touches test files and comments only — no production behavior changes.** If a gap you find while auditing the above actually requires a production fix (not a test or comment), that is outside this slice's scope per the plan's own slice boundary; report it rather than expanding the diff.

### Done when

The plan's slice-5 sentence: *"Each continue-route and worker-loop test asserts what its name states and prints the refusal body on failure. The fixture pid cannot be alive on a Linux runner. The guard rows cover an unreadable ending record and check the worker log. A hook replaces the copied `continueTwice` setup. The `ending.ts` doc and the comments in `continuation.ts`, `agent-loop.ts` and the continue-route tests state current behaviour only. The missing tests land with the behaviour: row 7's `resumeId`, `continue-target` for spend-limit, run-limit and checks-unanswered, and `correctionHasContinuation` on an identical second answer."* Concretely:

- Every test named by a specific refusal reason in its title or `it()` description asserts that reason, not just truthiness — and a failing assertion prints the actual refusal body.
- At least one test exercises a pid fixture whose liveness check cannot pass by accident on a Linux CI runner (same pattern as the existing line-235 assertion, extended to any sibling fixture that lacks it).
- A new test (or tests) writes an unparseable `.plot-worker.ending.json` and asserts the loop's logged diagnosis names it `unreadable`, not merely "no ending found."
- `continueTwice`'s scaffolding exists once, shared by the five reason-specific tests via a fixture or `beforeEach` — not copy-pasted a second time anywhere in the file.
- A grep for narrative/historical language ("used to", "previously", "before this fix", a bare PR/issue number with no behavioral statement) in `continuation.ts`, `agent-loop.ts`, `continue-route.test.ts`, and `ending.ts` returns nothing that isn't describing current behavior.
- Row 7's `resumeId` test is confirmed present and running (or added if it turns out missing); `continue-target` gains tests for spend-limit, run-limit, and checks-unanswered endings if not already covered; `correctionHasContinuation` gains a test for an identical second answer if not already covered.

Plus: the repo's standing gates — no `State:` line hand-edited (this slice should not touch any), and `scripts/check-shell-lines.sh` if any shell under `skills/` changes (it should not for a test-only slice).

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the tests, related-package vitest, and typecheck for the files this branch actually touches (`packages/board/test/unit/continue-route.test.ts`, `packages/fleet/test/unit/worker-loop-run.test.ts`, `packages/domain/src/entities/ending.ts`, `packages/fleet/src/shared/continuation.ts`, `packages/domain/src/workflows/agent-loop.ts`, and whatever `continue-target` test file holds its coverage). The suites in the `CI suites` config key run in CI on every PR — don't run them locally as a matter of course; a failure there comes back as a correction.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

It reads which plan names this branch and opens the PR with the wave heading as title, the plan and this brief in the body. Push the first real commit as soon as it exists.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (the `bug/continuation-tests-assert-their-names` line under `### Tests and comments`).

### Scope guard

**This branch owns:** the test files `packages/board/test/unit/continue-route.test.ts` and `packages/fleet/test/unit/worker-loop-run.test.ts`, the `continue-target` test file, and comments inside `packages/fleet/src/shared/continuation.ts`, `packages/domain/src/workflows/agent-loop.ts`, and `packages/domain/src/entities/ending.ts`. No production logic changes.

**Siblings in flight, verified at brief-writing time (2026-10-24):** `bug/continuation-reads-the-loops-run-limits` (PR #2511), `bug/a-failed-continuation-leaves-the-desk-as-found` (PR #2590), `bug/drop-reads-the-boards-branch` (PR #2612), and `bug/mergeability-uses-the-prs-own-base` (PR #2618) are all merged — every other slice of this plan is done. This is the only branch left with no remote ref; nothing else is in flight to collide with.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
