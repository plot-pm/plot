# Safety juror: plot-reap keeps merged desks that hold only the worker's own files

Lens: what can this change stop, delete, merge, overwrite or misreport — on this checkout, another checkout or the host — and does every uncertain case end in a named refusal rather than a guess?

Position: amend

## Summary

The core change is safe in the direction the plan chooses: `desk_dirt` is the only reader in front of a `git worktree remove --force`, and named, whole-line, untracked-only exclusions keep that reader narrow. Two claims in the plan are false, and one of them invites a slice to "align" the readers in a direction that either deletes work or misreports desks. The "always print a reason" bullet has no bound on what the fix may change, and the plan's premise for that defect is unproven.

## Findings

1. **The reaper deletes with `--force`, so `desk_dirt` is the last guard on untracked work.** `packages/domain/src/adapters/trees/trees-git.ts:545` runs `git worktree remove --force <path>`. `reap.ts:897-903` reads `dirtyPathsWithStatus` (which sources `desk_dirt`, `trees-git.ts:339-345`), and `firstReapRefusal` refuses on `dirtyPath`. Every name added to `desk_dirt` is a file the reaper now destroys without a refusal. The plan's whole-line `?? <name>` form (as `plot-desk-dirt.sh:114-115` does for `PLOT-CORRECTION.md`) excuses only the root, untracked copy. A tracked, staged or nested copy still refuses as `uncommitted-changes`. This is the correct shape for a destructive reader.

2. **False claim: "no existing exclusion for them in `plot-worker-state.sh`" (plan Notes, line 70).** `plot-worker-state.sh:89` sets `PLOT_WORKER_RECORD='\.plot-worker\.'`, and `plot_worker_dirty_filter` drops `(^|/)$PLOT_WORKER_RECORD` at `:590`. That is a glob over every `.plot-worker.*` path, root or nested, tracked or not. `bashCleanliness` (`packages/fleet/src/shared/registry.ts:1333,1361`, not `packages/board/src/server/registry.ts` as the plan says) carries the same glob. So two of the four readers already excuse all four files, and `desk_dirt` is the one outlier.

3. **The reader mismatch has two "fixes", and both are unsafe.** The plan says "four readers must read one desk the same way" and also "no glob". An agent that makes them agree can (a) widen `desk_dirt` to the glob, which lets the reaper force-delete a tracked or nested `.plot-worker.*` file, or (b) narrow `plot_worker_dirty_filter` and `bashCleanliness` to the named list, which makes `.plot-worker.pid`, `.plot-worker.log`, `.plot-worker.wrapper.pid` and every other record dirt again. Option (b) brings back the `stalled` false positive the `plot-worker-state.sh:505-511` comment measured, changes the `--restart`/`--release` refusals and `desk_is_resettable`, and keeps board rows forever. The plan must forbid both and declare the remaining difference.

4. **False claim: "extends the existing corpus comparison" (plan line 54).** No corpus test compares `desk_dirt` with `bashCleanliness`: `git grep` finds no reference to `plot-desk-dirt` or `desk_dirt` under `packages/domain/corpus/`. The tests that exist are `test/reconcile/desk-dirt.test.mjs` and `packages/board/test/unit/reap-dirty-kind.test.ts`. An unattended agent told to extend a missing test either invents a new corpus pair (scope growth) or skips it.

5. **Unnamed callers change behaviour.** `desk_dirt` also feeds `plot-dispatch.sh:2119` (the arm that detaches a desk and runs `git branch -D`, `:2131`) and `plot-reconcile-scan.sh:2736,2768` (§21's `d_clean` and its marker reading). With the change, a desk holding only these files detaches and loses its local branch on that path. That is safe because the arm already requires zero file-changing commits beyond `origin/$MAIN` (`:2111-2116`), but the plan must name these callers so the slice runs their tests (`test/reconcile/dispatch.test.mjs`, the reconcile §21 tests).

6. **"Always print a reason" has no bound, and its premise is unproven.** Kind 1 prints a `keep` row for every dispatch tree on every refusal arm (`reap.ts:968-1000`). The only silent arm is `if (!isDispatchTree && !unclassified) continue;` (`reap.ts:880`): a tree with no `.plot-worker.pid`, no `/plot-wt-` in its path, and outside the worktree root. Desk 3894 more probably printed `keep … uncommitted: ?? .plot-worker.ending.json` in kind 1 and was absent from the LEFTOVER list because `dirtyTreeOwner` (`packages/domain/src/rules/sweepable.ts:314-322`) found its manifest, so its owner was not `nobody`. The issue quotes only the LEFTOVER lines. If the slice "fixes" the silent arm by classifying more trees as dispatch trees, the reaper starts force-removing worktrees a person made by hand. The plan must say the fix may only add an output row, never a reap.

7. **Manifest removal is already there.** `reap.ts:1130-1138` unlinks the manifest after a successful `removeOnly`, and `:1150-1180` clears orphaned manifests. Defect 3 follows from defect 1 and needs no new code. The plan's "Take the manifest with the desk" bullet risks a second removal path. The slice must prove it with a test and not add code.

8. **Live-worker guard holds.** `deskWorkerPid` (`reap.ts:510-516`) reads the process state and then the manifest's `pid` and `wrapperPid` with start-time checks, and a failed reading answers alive (`manifestPidIsRecorded`, `:469-480`). The dirt change does not touch it. A loop sleeping between two agents keeps its desk.

9. **Evidence loss is acceptable but must be stated.** `.plot-worker.ending.json` (written by `plot-dispatch.sh:1818` on `--stop`) and the monitor logs are the record of how the worker ended. The reaper deletes them only on a merged branch with no live pid and no unpushed commits, where nothing reads them again. The changelog line must say the reaper removes these records with the desk.

10. **Gates.** The shell-lines ratchet counts commands and not comments (`scripts/check-shell-lines.sh:9-15`), so names added inside the one `printf` at `plot-desk-dirt.sh:115` add zero. bash 3.2: the `<(...)` form already exists on that line. No host write and no Bitbucket arm are involved.

## Required amendments

1. Correct the Notes line: `plot-worker-state.sh:89/590` and `bashCleanliness` (`packages/fleet/src/shared/registry.ts:1319`) already excuse every `.plot-worker.*` path by glob. State that the slice changes `plot-desk-dirt.sh` only and does not change `plot-worker-state.sh` or `registry.ts`.
2. Declare the remaining difference in the `plot-desk-dirt.sh` header: `desk_dirt` is narrower than the other readers by design, because it is the only reader in front of `git worktree remove --force`. Forbid widening `desk_dirt` to a glob and forbid narrowing the other two readers.
3. Replace "extends the existing corpus comparison" with the real test homes: `test/reconcile/desk-dirt.test.mjs` and `packages/board/test/unit/reap-dirty-kind.test.ts`.
4. Name the tests that must fail before and pass after: (a) a merged desk whose only dirt is the six root files reads clean in `desk_dirt` and reaps with its manifest; (b) `docs/.plot-worker.exit`, a tracked `.plot-worker.exit` and a staged `A  .plot-worker.ending.json` each still count as dirt and refuse; (c) a desk with only these files and a live recorded `pid` keeps with `worker alive`.
5. Bound the reason-printing bullet: the fix may add a row and a counter for a tree the reaper skips, and must not change which trees are dispatch trees or reapable. If the reproduction shows desk 3894 already printed a kind-1 reason, the slice records that finding in the PR and changes nothing in that arm.
6. Name the other `desk_dirt` callers (`plot-dispatch.sh:2119`, `plot-reconcile-scan.sh:2736,2768`) and require their existing tests to pass.
7. Drop the manifest bullet as new work; require only the test in 4(a).

## Decisions for a person

- None blocks the slice. Open Question 2 (`info/exclude` as the home) is a person's call only if the slice wants to change what `plot_desk_exclude` writes into an adopter's common git dir. The named exclusions do not need it.

## Ran versus read

Ran (read-only): `gh issue view 2807`; `git show origin/main:` and `git grep` over `plot-desk-dirt.sh`, `plot-worker-state.sh`, `plot-reap.sh`, `packages/board/src/server/entry/reap.ts`, `packages/domain/src/adapters/trees/trees-git.ts`, `packages/fleet/src/shared/registry.ts`, `packages/domain/src/rules/sweepable.ts`, `plot-dispatch.sh`, `plot-reconcile-scan.sh`, `scripts/check-shell-lines.sh`, `.gitignore`, `packages/domain/corpus/`. Ran no test, no reap, no fleet or board command. The account of desk 3894 in finding 6 is an inference from the code, not a reproduction.
