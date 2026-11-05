# Seams juror: plot-reap keeps merged desks that hold only the worker's own files

Position: amend

## Findings

1. **Two of the three dirt readers already excuse the whole `.plot-worker.` prefix; `desk_dirt` is the only narrow one.** `plot-worker-state.sh:89` defines `PLOT_WORKER_RECORD='\.plot-worker\.'`, and `plot_worker_dirty_filter` (`:579-600`) drops `(^|/)\.plot-worker\.` for any XY status and any depth. `bashCleanliness` (`packages/fleet/src/shared/registry.ts:1319`, program at `:1334`) carries the same prefix. `desk_dirt` (`plot-desk-dirt.sh`, last function) names three exact untracked root lines. The plan's Notes claim "no existing exclusion for them in `plot-desk-dirt.sh` or `plot-worker-state.sh`" is false for `plot-worker-state.sh`, and the Approach says the change is made in `plot-worker-state.sh`, where nothing needs to change. The comment at `plot-worker-state.sh:83-88` records that a named list and a prefix drifted apart once before. The plan's "no glob" choice keeps that drift between `desk_dirt` and the other two readers, and it still misses `.plot-worker.log`, `.pid`, `.wrapper.pid`, `.reporter.fifo` and `.freewait`, which this repository's `.gitignore:63-75` lists and an adopting repository does not.
2. **The `bashCleanliness` path is stale.** The plan names `packages/board/src/server/registry.ts`; that file does not exist on origin/main. The function lives in `packages/fleet/src/shared/registry.ts:1319` and has two callers: `packages/board/src/server/fleet.ts:2850` and `packages/fleet/src/shared/auto-writes.ts:71`. Because it already excuses the prefix, the board already drops these desks, so "Board impact: none expected" holds, but for a different reason than the plan gives.
3. **No corpus comparison exists to extend.** `git grep` for `desk_dirt`, `desk-dirt` and `bashCleanliness` under `packages/domain/corpus/` returns nothing. `bashCleanliness` is a bash program inside TypeScript, not a domain rule, so the corpus tier (rule against shell, `docs/shell-and-domain.md`) is not its natural home. The plan's "extends the existing corpus comparison rather than adding a second copy of the list" has no target.
4. **The reaper is TypeScript, and the plan names only shell.** `skills/plot/scripts/plot-reap.sh` is a 13-line launcher that execs `board/plot-reap.mjs`. The `LEFTOVER` line comes from `runDirtyKind` in `packages/board/src/server/entry/reap.ts`, which reaches `desk_dirt` through `packages/domain/src/adapters/trees/trees-git.ts:342`. The silent keep for desk 3894 and the manifest removal are arms of `reap.ts` (or the domain rule it calls), not of the shell. `packages/board/test/unit/reap-dirty-kind.test.ts:73` already tests a desk that one filter excuses and the other catches; the new case belongs beside it.
5. **Open PRs and active plans: no file conflict.** I read the file lists of all 15 open PRs. None touches `plot-desk-dirt.sh`, `plot-worker-state.sh`, `registry.ts`, `reap.ts` or `trees-git.ts`. Of the active plans, only `2026-11-03-a-desk-s-design-question-waits.md` (Approved) mentions `plot-reap`; it concerns a `PLOT-BLOCKED` marker the reaper copies and reaps, and this plan does not change that arm. No ordering constraint follows.
6. **Two process seams the plan does not name.** (a) The plan tells the slice to check "the raw porcelain reads in `plot-dispatch.sh`". The plot controller gate refuses a read-only `grep` whose command line names that script; I hit that refusal during this review. PR #3135 is the plan that fixes it. Until #3135 merges, an unattended agent that follows the plan as written gets refused. (b) PR #3130 reports that `check-shell-lines.sh` is missing from `Local checks`, so the plan's "`check-shell-lines.sh` requires the shell line count not to grow" is enforced only in CI. That is low risk here: comments do not count (`check-shell-lines.sh:9`), and extra names in the `printf` argument add no commands.
7. **`info/exclude` already has a writer.** `plot_desk_exclude` (`plot-worker-state.sh`) exists, and dispatch calls it once for `.metadata_never_index`. The plan's second Open Question offers a real second home for these names. If that path is chosen, `info/exclude` becomes a fifth place that states the exclusions, unless it replaces one of the four.

## Required amendments

1. Correct the reader inventory. State that `plot_worker_dirty_filter` and `bashCleanliness` already excuse the `.plot-worker.` prefix, and give `bashCleanliness`'s real path and its two callers.
2. Make the one decision this seam turns on, and record it in the plan (see the decision for a person below). Either widen `desk_dirt` to the prefix the other two readers use, or narrow those two readers to a named list. Do not ship a third variant.
3. Name `packages/board/src/server/entry/reap.ts` (`runDirtyKind`, and the arm that keeps a desk silently) as the place where the reason line and the manifest removal are fixed. Name `packages/board/test/unit/reap-dirty-kind.test.ts` and `test/reconcile/desk-dirt.test.mjs` as the test homes.
4. Replace "extends the existing corpus comparison" with a test that exists or that the slice creates: for example, one fixture desk read by `desk_dirt`, `plot_worker_dirty` and `bashCleanliness` that asserts all three give one answer for each `.plot-worker.*` name.
5. Tell the slice to read the dispatch and fleetctl porcelain sites with the Read tool, not with a shell grep that names the gated script, or list #3135 as a dependency.

## Decision for a person

- Prefix or named list. The prefix matches two shipped readers and covers every `.plot-worker.*` file the fleet writes, including ones not yet named. The named list follows the reasoning in the `plot-desk-dirt.sh` header ("EACH EXCLUSION IS NAMED"), but it contradicts the reasoning in the `plot-worker-state.sh:83-88` comment. These two documented positions disagree, and a Sonnet agent cannot settle that disagreement from the plan.

## Rubric, briefly

1. Fix: yes for desks 3893 and 3895 if `desk_dirt` excuses the names. Desk 3894 depends on the `reap.ts` arm that the plan has not located yet. To verify, build a desk with exactly the issue's six untracked files, run `plot-reap.sh --dry-run`, and expect the desk to be reaped with its manifest.
2. Claims: findings 1 to 4 list the false or stale claims.
3. Breakage: no shell-lines growth and no bash 3.2 risk from adding names to a `printf`. The Bitbucket arm is not involved. Board: no change if `bashCleanliness` is left alone.
4. Failure modes: a desk with a tracked or nested `.plot-worker.*` file still counts under the named form but not under the prefix. The person's decision above sets which answer is right.
5. Buildability: blocked on the prefix-or-list decision and on the gated grep (finding 6a).
6. Tests: the existing `desk-dirt.test.mjs` cases for `.continue.md` and `.pid.startedAt` show the pattern. A new case for each name fails before the change and passes after. No cross-reader test exists today.

## Ran versus read

Ran (read-only): `git show`, `git grep` and `git ls-tree` on origin/main; `gh issue view 2807`; `gh pr list` and `gh pr view --json files` for every open PR. One `grep` was refused by the controller gate because its command line named the dispatch script. Read only: `plot-desk-dirt.sh`, `plot-worker-state.sh` (lines 70-100 and 500-600), `registry.ts:1319-1350`, `reap.ts:400-440`, `reap-dirty-kind.test.ts`, the `desk-dirt.test.mjs` test names, `.gitignore`, `check-shell-lines.sh` header, `docs/shell-and-domain.md`, and the active plans. I ran no test suite.
