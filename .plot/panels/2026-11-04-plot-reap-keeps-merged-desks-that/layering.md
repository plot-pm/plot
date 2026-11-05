# Layering juror: plot-reap keeps merged desks that hold only the worker's own files

Position: amend

Lens: controller → domain → port ← adapter, rules in the domain, index over bought answers, lifecycle actions through controllers, shell growth.

## Findings

1. **The reaper is TypeScript, and the plan names only shell.** `skills/plot/scripts/plot-reap.sh` on origin/main is a 13-line launcher that `exec`s `board/plot-reap.mjs`. The worktree loop, the keep reasons, the manifest removal and the summary line live in `packages/board/src/server/entry/reap.ts` (1727 lines), and the refusal order lives in the domain rule `packages/domain/src/rules/reapable.ts` (`firstReapRefusal`, `:180`). The plan's Approach says "the change is made in `plot-desk-dirt.sh` and `plot-worker-state.sh`". Two of its three bullets ("always print a reason", "take the manifest with the desk") cannot be made there. An unattended agent that follows the Approach literally puts reason printing or manifest removal in shell, which grows the shell and puts a decision outside the domain.

2. **Candidate silent-keep sites are in the entry, not the shell.** `reap.ts:877` `if (!isDispatchTree && !unclassified) continue;` skips a tree with no row (a desk with no `.plot-worker.pid` file outside the configured worktree root). `runDirtyKind`, `reap.ts:~1536`, `if (owner !== 'nobody') continue;` skips a dirty tree whose manifest names an owner, also with no row. Either can produce the silent keep of desk 3894. The fix for "every kept desk prints a reason" is a change to these `continue` arms (or a domain rule that names the reason), not to a shell reader.

3. **`plot-worker-state.sh` needs no change, and the plan's "no glob" contradicts two of the four readers.** `plot-worker-state.sh:89` defines `PLOT_WORKER_RECORD='\.plot-worker\.'`, and `plot_worker_dirty_filter` (`:569`ff.) drops every path matching `(^|/)\.plot-worker\.`. `bashCleanliness` (`packages/fleet/src/shared/registry.ts:1319`, not `packages/board/src/server/registry.ts` as the plan and the `plot-desk-dirt.sh` header say) carries the same prefix regex. So three readers already excuse all `.plot-worker.*` files by prefix, nested ones included, and `desk_dirt` (`plot-desk-dirt.sh:~127`, the `grep -vxFf` over three names) is the outlier. The plan's design "name each file, no glob" makes `desk_dirt` agree with the others on five names and still disagree on every other `.plot-worker.*` file and every nested one. That is the "two answers about one tree" the `plot-desk-dirt.sh` header forbids.

4. **The "existing corpus comparison" does not exist.** No file in `packages/domain/corpus/` names `desk_dirt`, `bashCleanliness` or `plot-desk-dirt`. `tree-reading.corpus.test.ts` compares `treesGit().quietSeconds`/`hasCommits` against `plot-worker-state.sh`, not the dirt readers. The plan says the slice "extends the existing corpus comparison rather than adding a second copy". The slice must create one, and the plan must say which pair it holds.

5. **The adapter boundary itself is right.** `packages/domain/src/adapters/trees/trees-git.ts:342` sources `desk_dirt` (`dirtyPathsWithStatus`), and `:381` sources `plot_worker_dirty_filter`. A script reached from an adapter is the sanctioned shape, and the exclusion list is a reading, not a rule (`plot-desk-dirt.sh` header: "THIS IS A READING, NOT A RULE"). The refusal `uncommitted-changes` stays in `reapable.ts:140`. No layering defect in that part.

6. **No new bought answer.** The plan adds no host call. The reaper's merge reading (`ctx.refs.contains`, then `ctx.host.prMerged`) is unchanged and is the destructive-decision reading CLAUDE.md requires. The index rule is not touched.

7. **No lifecycle action bypasses a controller.** Removing a desk and its manifest is the reaper's own action, run through its entry. The manifest removal already exists in `reap.ts` ("ORDER: worktree FIRST, manifest second, log LAST", `:263`). Defect 3 in the plan is a consequence of defect 1, not a missing code path, so the slice should prove it rather than add a second removal.

8. **Shell growth.** `scripts/check-shell-lines.sh` (CI `ci.yml:1509`) ratchets shipped shell lines. Five names on the existing `printf` line plus the header comment block in the style of the existing entries (6 to 8 lines each) adds about 20 to 35 shell lines, which the slice must pay for by removing as many elsewhere. Reusing `PLOT_WORKER_RECORD` from `plot-worker-state.sh` in `desk_dirt` costs about one line and removes the outlier.

## Required amendments

1. Name `packages/board/src/server/entry/reap.ts` as the home of "print a reason for every kept desk" and of the manifest proof, and name `reap.ts:877` and the `owner !== 'nobody'` arm of `runDirtyKind` as the arms to reproduce first. State that no reason text and no manifest removal goes into shell.
2. Decide one exclusion shape for all four readers and state it. Either `desk_dirt` adopts the `PLOT_WORKER_RECORD` prefix (root-anchored, untracked only, to keep the "a tracked copy is somebody's decision" property), or `plot_worker_dirty_filter` and `bashCleanliness` narrow to the named list. The plan's current wording leaves the readers in disagreement. This is a decision for a person (finding 3), because it trades the "no glob" safety of `desk_dirt` against reader agreement.
3. Replace "extends the existing corpus comparison" with "adds a corpus comparison" and name the pair: `treesGit().dirtyPathsWithStatus` (`desk_dirt`) against `bashCleanliness` and `plot_worker_dirty_filter`, over a desk holding each of the five issue files at the root, one nested copy, and one tracked copy.
4. Correct the `bashCleanliness` path to `packages/fleet/src/shared/registry.ts`, and say whether the slice also corrects the stale path in the `plot-desk-dirt.sh` header.
5. State the shell-lines budget: either the shape that costs about zero lines (finding 8) or the lines the slice removes to pay for the comment block.

## Decisions that need a person

- Prefix versus named list for the `.plot-worker.*` exclusion (amendment 2). The existing readers already chose the prefix, and `desk_dirt` deliberately chose names, so one of the two decisions gets reversed.

## What I ran versus read

- Ran (read-only): `gh issue view 2807`; `git show origin/main:` of `plot-desk-dirt.sh`, `plot-worker-state.sh` (`:89`, `:505`–`:600`), `plot-reap.sh`, `packages/fleet/src/shared/registry.ts` (`:1300`–`:1360`), `packages/domain/src/adapters/trees/trees-git.ts` (`:320`–`:395`), `packages/board/src/server/entry/reap.ts` (copied to scratch, `:860`–`:1000`, `:1510`–`:1560`), `packages/domain/src/rules/reapable.ts` (grep); `git grep` for every reader name and for `check-shell-lines`; `git ls-tree` of `packages/domain/corpus/`.
- Did not run: any test, the reaper, or a reproduction of desk 3894. The silent-keep arm in finding 2 is a candidate from reading, not a reproduction.
