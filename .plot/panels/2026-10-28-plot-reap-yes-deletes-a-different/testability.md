# Juror verdict: testability

Position: amend

Evidence: read the plan, issue #2825 (`gh -R plot-pm/plot issue view 2825`), `packages/board/src/server/entry/reap.ts` (:776-800, :886-912, :970-1060, :1128-1180, :1240-1280), `packages/domain/src/rules/sweepable.ts:60-100`, `packages/domain/src/ports/host.ts:33,243`, `packages/domain/src/adapters/host/host-shell.ts:307-324,387-392`, `skills/plot/scripts/plot-host.sh:4222-4262`, `test/reconcile/sweep.test.mjs:147-260`, `test/reconcile/reap-failed-readings.test.mjs:1-130`, `packages/board/test/unit/reap-given-up-desk.test.ts:1-60`, `packages/domain/test/sweepable.test.ts`. Ran `git diff v2.29.0 HEAD -- reap.ts sweepable.ts` (empty: the code the operator ran is the code at HEAD). RAN a reproduction against the shipped bundle `skills/plot/scripts/plot-reap.sh` in a sandbox repo with a `gh` stub whose answers change between runs (script: `/private/tmp/claude-501/-Users-jwloka-Quatico-Agentic-Tools-plot/ca0ab00d-98d3-4ca8-8a1b-8a43a4eda657/scratchpad/juror-2825-testability/repro.mjs`). Did not run vitest (no node_modules in the worktree; the bundle run covers the behaviour).

## Reproduction output (executed)

Three branches; between the runs the stub flips two answers and one branch is pushed to `origin/main`:

```
=== dry-run (phase 1) ===
keep     f/flip-to-merged     unlanded work — no merged PR          <- gh answered 429
would    f/flip-to-unknown    PR merged (squash), no worktree holds it
keep     f/lands-between      unlanded work — no merged PR
summary: ... branches=1 branches_deleted=0 branches_kept=3 ... dry_run=1
=== --yes (phase 2) ===
deleted  f/flip-to-merged     PR merged (squash), local ref deleted
keep     f/flip-to-unknown    unlanded work — no merged PR          <- gh answered 429
deleted  f/lands-between      merged into main, local ref deleted
summary: ... branches=2 branches_deleted=2 branches_kept=2 ... dry_run=0
```

All three rows of the issue's table reproduce with this one fixture. That fixture is the failing test slice 1 needs.

## (a) Problem statement

- Correct: `runBranchKind` (reap.ts:980-1059) re-decides every branch on each run, and `--dry-run` and `--yes` diverge only at :1043. reap.ts has not changed since v2.29.0, so the line citations hold for the operator's version and for HEAD.
- **A cause is missing.** `runReap` calls `ctx.fetch(defaultBranch)` at reap.ts:1244 on every run. When `origin/<default>` moves between the two runs, `refs.contains` (reap.ts:1000) answers `yes` for a newly landed branch. That is the `feature/EWZREL-9391` / `-9832` row ("not listed" → "merged into develop"). The reproduction's `f/lands-between` row shows it. The host plays no part, so slice 3 cannot cover it. Only slice 1 can.
- **The rate-limit cause runs in the other direction from the one the plan states.** `pr-merged` prints `merged` only when the host returned a MERGED row (plot-host.sh:4238, :4257). A 429 goes through `miss_or_unknown` and arrives as `unknown` or a failed result (host-shell.ts:309-316). reap.ts:1006 treats both as not merged. So a 429 cannot produce a false `PR merged (squash)`. It produces a false **keep**, labelled `unlanded work — no merged PR` (reap.ts:1022-1023), because `LocalBranchReadings.hasMergedPr` is a boolean (sweepable.ts:72-74) and folds `unknown` into `not-merged`. The issue's `migration-abw-rechnungsempfaenger` row is that case: the dry run's "unlanded work" was a 429 mislabelled, and the `--yes` run's "PR merged" was the true answer. The six "would → kept" rows are the same mechanism in reverse. The reproduction shows both.
- **The counter claim does not hold.** `counters.deleted` increments only beside a `deleted` row (reap.ts:1049-1051). The issue's own numbers add up: 38 swept + 18 kept = 56 in the dry run, and 37 + 19 = 56 in the real run. The reproduction prints 2 deleted rows and `branches_deleted=2`. The one real drift is that a `FAILED` row increments both `swept` and `kept` (reap.ts:1042, :1054), so `branches=` counts failed attempts, and `branches + branches_kept` double-counts a failure. The issue's run had `branches=37=branches_deleted`, so no delete failed there.

## (b) Approach

- Slice 1's recorded plan fits *A Decision Reads The Index* only if the record holds **answers** (contained-at-SHA, host `merged`, tip SHA) and `--yes` re-derives the verdict. A host `merged` answer is terminal (a MERGED row cannot revert), so reading it back from the record is licensed. `checkedOut` is not terminal: a worktree can check the branch out between the runs. `--yes` must re-read it live and must never take it from the record. The plan should say so, and a test should hold it.
- The domain should own "is this recorded row still actionable": `(recorded tip, current tip, checkedOut now)` → refusal. That function belongs in `rules/sweepable.ts` beside `firstBranchRefusal`, per the layering rule.
- Approach item 3 as written ("downgrade a merged verdict made under a rate limit to keep") fixes nothing, because no merged verdict comes from a rate-limited answer (see (a)). The defect that exists is the reason text and the reading type. Replace `hasMergedPr: boolean` with the `MergedAnswer` tri-state and add a refusal `host-unknown` ("the host could not answer — keeping"). `test/reconcile/reap-failed-readings.test.mjs:128` and `sweep.test.mjs` "an unreachable host deletes nothing" assert `keep`, and they keep passing. Only the reason text changes, and only for the unknown case.
- Approach item 4 is a characterization, not a fix. The test passes today.
- Reversibility (item 2) must cover **every** `git branch -D` site, not only reap.ts:1048. The worktree kind deletes a local branch at reap.ts:911, and the claim kind deletes at reap.ts:1171. A tip log covering one site of three leaves the plan's own changelog line ("records each deleted branch's tip SHA") false.

## (c) Slices

- **Order.** Slice 2 (`records-the-tip-it-deletes`) does not depend on slice 1 and is the smallest. It also removes the harm the issue reports, because a bundle the operator made from the dry run becomes unnecessary when every deleted tip is recorded. Ship it first. Its only overlap with slice 1 is textual, at the delete call.
- **The `<!-- waits: bug/plot-reap-yes-acts-on-the-approved-set -->` on slice 3 has no reason** once slice 3 is reframed as the tri-state reading. It is a domain-rule change plus a reason string, and it does not depend on the record format. Drop the wait.
- Slice 1 bundles three things: the record format, `--yes --plan`, and the counter. Move the counter to slice 3 or drop it (see (a)). If the `branches=` FAILED double-count is worth fixing, it is a one-line change with its own test.
- Open question 4 has an answer now (see (d)). The worktree kind shares the divergence, so slice 1 either covers it or names a follow-up slice.

## (d) Open questions

- *Recorded plan or confirm in place?* Recorded plan. Only the recorded plan has a test that can fail today: dry-run → change the host → `--yes --plan` → assert the deleted set equals the `would` set. An interactive confirmation has no unattended test and cannot detect a moved tip.
- *Log or `refs/plot/reaped/*`?* The ref, for testability as well as for gc: `git rev-parse refs/plot/reaped/<branch>` gives a one-line contract assertion, and `git gc --prune=now` in the fixture proves the object survives. A log needs a parser and proves nothing about gc. Ask in the plan: who prunes `refs/plot/reaped/*`, and does `plot-reconcile` list them?
- *Does the host port report rate-limited or partial answers to `prMerged`?* Yes, as `unknown` (exit 3, host-shell.ts:309-316) or a failed result. Both reach reap.ts:1006 and are read as not merged. No new port field is needed. The domain reading needs the tri-state.
- *Do the worktree and claim kinds share the divergence?* The worktree kind does: the same `contains` → `prMerged` pattern runs at reap.ts:783-791, the dry-run split is at :886, and the branch delete is at :911. The claim kind asks no host, but it re-reads `origin/<default>..br` after a fresh fetch (reap.ts:1140) and re-reads plan annotations (:1143), so it too can change between the runs. No test exercises this yet.
- *`--yes` with no `--plan`?* For the fleet: grep the callers of `plot-reap.sh --yes` in skills and fleetd before the slice decides to refuse. A refusal breaks every unattended caller at once.
- New question: what does `--yes --plan` do with a branch that is in the record and is now checked out? It should refuse, by re-reading `checkedOut` live.
- New question: is the record per repository (`.plot/state/` under the common git dir), and what happens when two records exist at once?

## (e) Tests per slice, at the lowest tier that fails today

- **Slice 2 (tip recorded):**
  - *Board unit, fails today:* export `runBranchKind` the way `runWorktreeKind` already is (reap.ts:670), drive it with a fake `Context` (pattern: `packages/board/test/unit/reap-given-up-desk.test.ts`), and assert that the tip write happens before `trees.deleteBranch` and carries the pre-delete SHA.
  - *Contract, fails today:* in `test/reconcile/sweep.test.mjs` kind 2, after `--yes`, `git rev-parse refs/plot/reaped/feature/squash-landed` equals the old tip, and it still resolves after `git gc --prune=now`. Repeat the test for the worktree-kind delete (reap.ts:911) and the claim-kind delete (reap.ts:1171).
  - Done when all three delete sites have a passing test.
- **Slice 3 (degraded host, reframed):**
  - *Domain unit, fails today:* in `packages/domain/test/sweepable.test.ts`, `branchSweepProblems({ ..., hostMerged: 'unknown' })` returns `['host-unknown']`, not `['no-merged-pr']`.
  - *Contract, fails today:* a `gh` stub that answers 429 for a branch. The row reads `keep … host could not answer` and does not match `/unlanded work/`. Use the stub from `repro.mjs`.
  - The existing tests `reap-failed-readings.test.mjs:128` and sweep.test.mjs "an unreachable host deletes nothing" must stay green. Check the first: the stub there answers `[]` (`not-merged`), so its text should not change.
- **Slice 1 (approved set):**
  - *Domain unit:* the record-row validity rule returns a refusal for a moved tip and for a branch checked out now.
  - *Contract, fails today:* the reproduction above as a test. Run `--dry-run --record`, flip the stub, push one branch to `origin/main`, run `--yes --plan`, and assert that the set of deleted rows equals the set of dry-run `would` rows. The test must also show that a branch whose tip moved after the record is refused by name.
  - *Characterization (passes today, keep it):* a summary test asserting `branches_deleted` equals the count of `^deleted` rows in the branch section.
  - Board browser tier: none. The plan's board-impact note is correct, because no board view parses reap rows.

## Amendments

1. Add the missing cause: `ctx.fetch` at reap.ts:1244 moves `origin/<default>` between runs, and that alone explains the "not listed → merged into develop" row.
2. Correct the rate-limit cause. A 429 yields `unknown`, which reap.ts reads as not merged and labels "unlanded work — no merged PR". It never yields a false `merged`. Reframe slice 3 as the `MergedAnswer` tri-state in `LocalBranchReadings` with a `host-unknown` refusal, and drop its `waits:` on slice 1.
3. Drop or rescope the counter claim. `branches_deleted` already equals the printed `deleted` rows. Only `branches=` double-counts a `FAILED` delete.
4. Ship slice 2 first, and extend it to all three `git branch -D` sites (reap.ts:911, :1048, :1171).
5. State in slice 1 that the record stores answers plus the tip, that `checkedOut` is re-read live at `--yes`, and that the worktree kind (reap.ts:783-911) is in scope or a named follow-up.
6. Name the failing test for each slice in the plan, as in (e). Slice 1's test is the phase-flipping `gh` stub plus a push between the runs.
