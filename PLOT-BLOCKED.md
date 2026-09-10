PLOT-BLOCKED: A second worker is committing to this branch in this worktree. Which agent owns `feature/a-finished-desk-is-a-finding`, and should the foreign commit `ac4792ae7` be kept, amended, or reset?

## What was measured, 2026-09-10

Two Claude worker processes were live in this worktree at once. I stopped rather than race a process that commits under me.

| | me | the foreign worker |
|---|---|---|
| pid | 4760 | 66836 |
| session | `800ee795-0ade-462c-a5d1-3c04dbb3dde5` | `bbf4e999-c1e9-4ea0-ac49-69a76fba3daa` |
| dispatched as | `plot-dispatch.sh --restart feature/a-finished-desk-is-a-finding` | `plot-dispatch.sh --restart feature/reconcile-is-a-controller-action` |
| its worker-prompt | this worktree's `.plot/worker-prompt.sh` | the MAIN checkout's `.plot/worker-prompt.sh` |
| cwd (`lsof -d cwd`) | this worktree | **this worktree** |
| recorded in `.plot-worker.pid` | yes (via loop pid 4534) | no |

**The foreign worker was dispatched for a different branch and is working in my desk.** `feature/reconcile-is-a-controller-action` is checked out in the main checkout (`/Users/jwloka/Quatico/Agentic-Tools/plot`), not in a desk of its own. Its worker's cwd is nevertheless this worktree, measured with `lsof -a -p 66836 -d cwd`.

**It has committed to my branch.** `ac4792ae7 plot: report a worktree no recognition test could place` — my slice's subject, implemented partially:

- `packages/domain/src/workflows/reap.ts` — adds an optional `unclassified?: boolean` to `ReapEvidence`
- `packages/domain/src/workflows/reconcile.ts` — adds the `'unclassified-tree'` `DriftKind`
- `packages/board/src/server/entry/reconcile.ts` — parses it
- `packages/domain/test/workflows-reconcile.test.ts` — six tests for the new kind

Not done in that commit: `plot-reap.sh` still decides in the `case` statement (the whole point of the slice), `plot-reconcile-scan.sh` takes no desk readings, no rebuilt `plot-reconcile.mjs` artifact, no changeset.

## Why I did not simply continue

Whichever of us runs `git commit` captures the other's half-finished edits. I watched the file set grow from 3 to 4 files across two `git status` calls, and the working tree go from modified to staged to committed inside four minutes. Any test run, rebase or artifact rebuild I performed would be measuring a tree another agent is editing — and `pnpm build:board` writing an artifact while a second agent edits its source produces exactly the untraceable mismatch this repo's `-merge` rule exists to avoid.

I did **not** kill pid 66836. It is another agent's work and its wave-2 branch is unmerged on the host (`plot-pr-state.sh feature/reconcile-is-a-controller-action` answers `{"found": false}`), so what it holds may be the only copy of something. Killing it is a person's call.

## What a person needs to decide

1. **Kill or keep pid 66836?** It is dispatched for a branch it is not working on. If it is still running when this is read, it will keep committing here.
2. **Keep `ac4792ae7`?** Its domain work looks consistent with the brief and its six tests read correctly. If it is kept, the remaining slice work is the shell half — `plot-reap.sh` measuring `isDispatchTree` instead of deciding, `plot-reconcile-scan.sh` taking desk readings, the artifact, the changeset. If it is dropped, `git reset --hard 94bcde182` returns this desk to its claim commit.
3. **Then restart one worker** on this branch with `plot-dispatch.sh --restart feature/a-finished-desk-is-a-finding`.

## The discovery worth filing separately

**This is the slice's own subject, one layer up.** My brief says a tree the recognition test cannot place is *not reaped, not kept, not counted, not named* — safe and silent. The same shape holds for workers: `--restart` refuses on a live pid, but `.plot-worker.pid` records only the desk's own loop pid, so a worker whose cwd is a desk it was not dispatched for is invisible to every liveness check. My desk read as having exactly one worker throughout.

Two things follow, neither in this slice's scope:

- `plot-dispatch.sh --restart <branch>` should verify that the desk it hands over is the desk of the branch it was asked about. Here it was asked about `feature/reconcile-is-a-controller-action` and its worker ended up in `feature/a-finished-desk-is-a-finding`'s desk.
- A liveness check that reads only `.plot-worker.pid` cannot see a foreign worker. Asking the process table which pids hold a cwd under a desk would have seen this one.

## The measurement subject is untouched

`.worktrees/feature-one-monitor-watches-the-slice` still holds its 5 unpushed commits, a clean tree and its `PLOT-BLOCKED.md`. I did not touch it. Re-measured on this estate today: **9 worktrees, 4 recognised, 5 skipped silently**, and the reaper reports `reapable=0 kept=2` — the brief's numbers were 12/6/`reapable=4 kept=1`, so the baseline the "verdicts are unchanged" assertion must pin has moved since the brief was written.

Delete this file once the question is answered.
