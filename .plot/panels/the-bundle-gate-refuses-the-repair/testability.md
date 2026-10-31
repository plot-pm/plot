# Juror: testability

Position: amend

## Executed evidence

I replayed the #2965 sequence in a temp git repo with the real gate (`skills/plot/scripts/plot-bundle-commit-gate.sh` → `board/plot-gate.mjs` at `a51fc5dac`) and the real CI check (`scripts/check-no-bundle-diff.sh <root> HEAD origin/main`). The script is kept at `/private/tmp/claude-501/-Users-jwloka-Quatico-Agentic-Tools-plot/ca0ab00d-98d3-4ca8-8a1b-8a43a4eda657/scratchpad/juror-testability-replay.sh`. Sequence: base holds bundle `v1`; `main` moves to `v2`; the branch holds a stale build, merges `origin/main` with a conflict, and restores from the OLD merge base (the desk's move on `e57b2aa2a`), so `HEAD` holds `v1` against merge base `v2`; `main` moves to `v3`.

| Case | Staged copy | Gate today | Plan's rule (staged == `origin/main`) | CI `check-no-bundle-diff.sh` after the commit |
|---|---|---|---|---|
| A: merge `origin/main` in progress, take theirs | `v3` | exit 2 | allow | exit 0, clean |
| A': run the repair today's refusal prints | `v2` | exit 2 again (the loop in #2970) | refuse | — |
| B: no merge; restore from `origin/main` (the plan's printed repair) | `v3` | exit 2 | **allow** | **exit 1, refused** |
| C: no merge; restore from the merge base | `v2` | exit 2 | **refuse** | exit 0, clean |

The replay reproduces today's refusal loop exactly, so #2965 can be a contract test. It also shows two defects in the plan's rule.

## Findings

1. **The merge-in-progress case is fixed (rubric 1, conflict case).** Case A: the staged blob `29ef827e` equals `origin/main:b.mjs` `29ef827e`, `HEAD` holds `626799f0`; the plan allows it, and CI reads the result clean.

2. **The non-conflicting-but-stale case is not fixed, and the plan's repair produces a commit CI refuses (rubric 1 and 2).** Case B: with no merge in progress, the plan prints `git restore --source=origin/<default>`, the gate then allows the commit, and `check-no-bundle-diff.sh` exits 1, because CI diffs against the merge base (`check-no-bundle-diff.sh:33-38, 77-83`), and the merge base still holds `v2`. Case C, the commit CI accepts, stays refused under the plan. So Open Question 4's invariant, "a commit the CI check accepts is never refused locally", fails on case C, and its converse fails on case B. The same holds for the master-agent repair in #2970 when `origin/main` moves (a fetch) between the `-X theirs` merge and the restore commit.

3. **One reading makes the local gate agree with CI in all four cases.** The allow condition is "the staged blob equals the blob at the merge base the commit WILL have against `origin/<default>`". With a merge in progress that base is `git merge-base origin/main HEAD MERGE_HEAD`; without one it is `git merge-base HEAD origin/main`. Measured during the conflicted merge: `merge-base(HEAD, origin/main)` holds `v2` and `merge-base(origin/main, HEAD, MERGE_HEAD)` holds `v3`. That reading allows A and C, refuses A' and B, and the repair prints that base's resolved sha. Both are local reads and need no fetch.

4. **The default-branch reading fails silently in the existing test fixture (rubric 3 and 6).** `refsGit.defaultBranch` (`refs-git.ts:360-366`) runs `git symbolic-ref … | sed … || git rev-parse …`. With no `refs/remotes/origin/HEAD`, I ran it: exit 0, output empty, so `asText` (`run-script.ts:383`) answers `ok("")` and the ref becomes `origin/`. The contract fixture sets only `refs/remotes/origin/main` (`test/reconcile/bundle-commit-gate.test.mjs:63`), so approach step 4 turns every repair in that fixture into "no merge base" and fails the test at line 99. Any clone made with `git remote add` + fetch has the same shape. The plan says "from config" in step 4's heading and "the host's default branch" in its body; neither names the reading or its failure answer.

5. **Tests that pin today's behaviour and must change, which the slice does not name.** `packages/domain/test/bundle-commit.test.ts:38` (restore from merge base) and `:83` (null merge base, no repair). `test/reconcile/bundle-commit-gate.test.mjs:99` parses `--source="([a-f0-9]+)"`, a hex sha; a repair that prints `origin/main` as a ref name breaks that regex. That fixture also has `origin/main == HEAD == merge base`, so "the printed restore clears the gate" passes today without ever covering merge base ≠ `HEAD`, which is the whole defect. I ran the file: 8 of 8 pass on the plan branch, which proves the current tests cannot see #2970.

6. **A ref name in the repair text is not reproducible.** `--source=origin/<default>` resolves when the agent runs it, not when the gate refused; a fetch in between changes the answer (case B shows the cost). Print the resolved sha, as today's text does, so a test can assert the exact command and the gate's own reading.

7. **Unresolved paths are invisible to the rule.** During the conflict `git diff --cached --name-status` emits `U  b.mjs`, and `stagedPathsOf` (`refs-git.ts:293-300`) drops `U`. Git refuses that commit itself, so this is safe, but a test of the merge-in-progress case must resolve the path first, or it tests nothing. The plan should state this.

8. **The port reading is unnamed (rubric 4 and 6).** The plan says blob ids go "through the `Refs` port" but names no operation. `StagedPath` carries no blob id (`ports/refs.ts:41-48`). `git diff --cached --raw --no-abbrev` already carries the index blob id, and `stagedEntriesOf` discards it (`refs-git.ts:336` matches `\S+ \S+`). `listBlobs(ref, dir)` (`ports/refs.ts:384`) already returns the sha at a ref. An implementer must choose between a new op, extending `StagedEntry`, or these two; the fixture adapter (`refs-fixture.ts`) must answer the same op. The rule stays pure with readings as values, which is testable in vitest with no browser and no host.

9. **The docs keep prescribing the source that caused #2965 (rubric 5).** `docs/definition-of-done.md:47` prescribes `git checkout "$(git merge-base HEAD origin/main)" -- …`; during a merge that is the OLD base (case A'). Lines 52-53 say the refusal prints "this exact restore command". CLAUDE.md's Testing paragraph says the same. The plan's board-impact note declares no docs change, so the docs and the gate would disagree after the slice merges.

10. **No Done-when exists.** The template has none either, but the slice line names four unit cases and none at the gate entry with a merge in progress. Every motivation claim except "17 files conflicted" is checkable by the replay above.

## Amendments

1. Replace approach step 1's allow condition with: a staged generated path is allowed when its index blob equals the blob at the post-commit merge base against `origin/<default>` — `merge-base(origin/<default>, HEAD, MERGE_HEAD)` with a merge in progress, `merge-base(HEAD, origin/<default>)` without one. A path that base does not hold stays refused.
2. Print the repair as `git restore --staged --worktree --source=<resolved sha of that base> -- <path>`, and `git rm --cached <path>` where that base lacks the path. Keep the sha, not a ref name.
3. Name the readings: the index blob id (extend `StagedEntry`/`stagedEntriesOf` with the index sha, or add one op), the base blob ids (`listBlobs` or a new op), and `MERGE_HEAD` presence. Name the answer for each failure: any reading that fails refuses with no repair, as `mergeBase === null` does today (`bundle-commit.ts:117`); a throw keeps `onError: 'allow'`.
4. For step 4, either keep the literal `origin/main` in this plan, or make `defaultBranch` fail on empty output and add `refs/remotes/origin/HEAD` to the contract fixture. State which.
5. Add to the slice's tests: (a) the #2965 replay as a contract test in `test/reconcile/bundle-commit-gate.test.mjs` — stale `HEAD`, conflicted merge of `origin/main`, take theirs, gate exits 0, then `check-no-bundle-diff.sh <fixture> HEAD origin/main` exits 0; (b) case B refused; (c) case C allowed; (d) the printed repair, run, clears the gate when merge base ≠ `HEAD`. Answer Open Question 4 with (a)–(c): a contract test that runs both gates over the same fixture, not a corpus pair, because the CI side is a script over a real repo.
6. Add the DoD conflict procedure and CLAUDE.md's Testing paragraph to the slice, so the prescribed command matches the gate's repair.
7. Add a Done-when with one command per claim: `node --test test/reconcile/bundle-commit-gate.test.mjs` and `pnpm --filter @plot-pm/domain exec vitest run test/bundle-commit.test.ts`.
