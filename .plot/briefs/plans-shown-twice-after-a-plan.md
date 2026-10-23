## Implementation brief — plans-shown-twice-after-a-plan (wave 1: Fix)

- **Plan (canonical):** `docs/plans/2026-10-23-plans-shown-twice-after-a-plan.md` on `main`
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2434 merged
- **Branch:** `bug/plans-shown-twice-after-a-plan` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the plan's only slice. Nothing waits on it and it waits on nothing.

### What to build

The Planning tab lists a plan twice after a plan PR merges and the idea branch stays on origin (issue #2410: ewz-kus-portal PR #3719, three plans, six cards, same path and slug; deleting the branch cleared them). The fix is in `packages/board/src/server/board.ts`: `collectBranchPlans` (`:950`) caches `readBranchPlans` (`:903`) under a key built from `branch@sha` pairs only. `readBranchPlans` skips any path `origin/<default>` already holds (`onDefault.has(relPath)`, `:917`), but `onDefault` is read inside the cached call. A merge commit adds the plan file to the default branch and leaves the idea branch's tip where it was, so the key is unchanged and the cache serves the list computed while the file was absent from the default branch. The default-branch reader supplies the same path a second time. Deleting the branch changes the key, which matches the report.

Write the failing test first, as the plan says: a fixture with an idea branch carrying a plan, a warm cache (one `buildBoard` or `collectBranchPlans` call), then a merge commit into the default branch that adds the same file, then a second call with the branch still present. Assert one card for the path. Existing tests that touch this code: `packages/board/test/discovery.test.mjs`, `packages/board/test/plan-read-shape.test.mjs`, `test/reconcile/fleetrefplans.test.mjs`.

### Decisions the plan settles — do not re-derive them

**Cause 1 (stale cache key) is the primary fix.** Add the default branch's tip SHA to the key. The tip is not free the way the branch tips are (`prefixedBranches` gets those from the one `for-each-ref`), so resolve `origin/<default>` with `refs.resolve` once per call and put it in the key. If it does not resolve, do not reuse the cache: read fresh and do not store. The plan lists cause 2 (the two readers resolving the default branch differently, or `planPathsInTree` returning an empty set on an unreadable ref) as less likely, since both readers take the same `defaultBranch`. The test above tells them apart; if it passes before the fix, cause 2 holds and the plan needs an amendment, not a guess.

**Ancestry is a prefilter here, and `Refs.contains` already exists.** This answers the plan's open question 2: `Refs.contains(ancestor, descendant)` (`packages/domain/src/ports/refs.ts:670`) returns `yes`, `no` or `unknown`. Do not add an operation to the port or to `refs-git.ts`. Drop a branch whose tip `contains` answers `yes` for against `origin/<default>` before its tree is read; `no` and `unknown` keep the branch. The call needs the declaration `scripts/check-ancestry-decisions.sh` demands within five lines above it: `# plot-ancestry: prefilter — …`, saying that a wrong answer shows or hides one card until the next request and cannot hide finished work. Do not use `isMergedByAncestry` or read the answer as "did this land" — `CLAUDE.md` § One Answer To "Did This Land" measured ancestry disagreeing with the host on ten of ten squash-merged branches. A squash-merged branch stays ahead of the default branch forever, and the path rule (`onDefault`) is what covers it.

**De-duplicate by canonical path as the last step before staging, default-branch reading wins.** `seen` in `readBranchPlans` covers branch against branch. Add the final guard where staged plans are assembled in `buildBoard` (the staging loop near `:2061`), so no later source reintroduces a second card for one path. There is already a `localOnlyPaths` join in that loop and its comment explains why working-tree knowledge must stay out of the ref-keyed cache — keep the new guard outside the cache for the same reason.

**Open question 3 (key on slug as well as path) is for you to measure, not to assume.** A rename between the branch and the default branch gives two paths with one slug. Check whether the board can produce that case; if it can, add the slug key and say so in the PR, if it cannot, leave it out and record the answer in the plan's Open Questions.

Invariants this repo keeps re-learning: an unreadable ref reads as *no information*, never as *empty*, so a failed listing must not turn into a skip decision; and the cache must never hold an answer that depends on something the key omits.

### Done when

The plan's slice line is the specification: the branch-plan cache keys on the default branch tip, a branch contained in the default branch is skipped, staged plans are de-duplicated by path, and a regression test covers a merged branch that remains. Assertions that exist because a naive implementation would pass without them:

- **Warm cache, then merge.** A test that builds the fixture already merged never exercises the cache and passes on the unfixed code. The first call must precede the merge. It catches the bug that was reported.
- **Branch with commits ahead of the default branch.** A plan on a still-open idea branch must still show one card. It catches a prefilter that drops every branch.
- **Squash-merged branch.** Tip not contained, path on the default branch: one card. It catches an implementation that relies on ancestry alone.
- **`unknown` containment keeps the branch.** It catches ancestry failure read as "merged".

Plus: a changeset for package `@plot-pm/board`, with the description first and the `bumps:` block last. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base; this slice should touch no `.sh` file. The PR must carry no generated bundle (`scripts/check-no-bundle-diff.sh`); run `pnpm build:board` only to test locally, then restore generated paths. Functions you write are arrows. Run `nvm use` first (Node 24).

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/board.ts`, the board tests that cover it, and one changeset. No other plan names a branch in flight over those files at dispatch; this is the only slice of the plan and the sprint `bugfix-2-28-2` holds other bug fixes — check `git log origin/main -- packages/board/src/server/board.ts` before the first push. No plan format, template, helper script or `docs/plans` layout changes (the plan's board-impact note).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
