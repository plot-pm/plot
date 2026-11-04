# plot-reap keeps merged desks that hold only the worker's own files

> A merged desk whose only uncommitted paths are the files the worker wrote about itself is reaped with its manifest, and a kept desk always prints a reason.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2807
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-reap` reaps a merged desk whose uncommitted paths are all `.plot-worker.*` files the worker wrote (`.exit`, `.monitor.*.jsonl`, `.ending.json`, `.envelope.json`), and removes the desk's registry manifest with it.
- `plot-reap` names a reason for every desk it keeps.

Board impact: none expected. The board's drop rule (`bashCleanliness` in `packages/board/src/server/registry.ts`) reads the same dirt and must agree with the reaper; the slice checks this and rebuilds the artifact only if the board's reading changes.

## Motivation

`plot-reap.sh --dry-run` (2.29.0) in ewz-kus-portal kept three merged and delivered desks (EWZKUS-3893, 3894, 3895, worktrees `.worktrees/free-*`):

```
LEFTOVER bug/ewzkus-3893-property-cache-verwerfen          4 uncommitted, owner: nobody — clear it by hand
LEFTOVER feature/ewzkus-3895-zevvy-auf-liegenschaftsseiten 5 uncommitted, owner: nobody — clear it by hand
summary: reapable=0 removed=0 kept=6 ... dirty_trees=2 dry_run=1
```

The uncommitted paths were the dead worker's own files. Desk 3893 held `.plot-worker.ending.json`, `.envelope.json`, `.exit` and `.monitor.worker.jsonl`; desk 3895 added `.monitor.agent.jsonl`; desk 3894 also held `.plot-worker.continue.md`. None of the three held a tracked change, an unpushed commit or a live worker pid.

Three defects follow from that report:

1. `desk_dirt` (`skills/plot/scripts/plot-desk-dirt.sh`) excuses `PLOT-CORRECTION.md`, `.plot-worker.continue.md` and `.plot-worker.pid.startedAt` by name, and the generated bundles by path. It excuses none of `.plot-worker.exit`, `.plot-worker.monitor.*.jsonl`, `.plot-worker.ending.json` and `.plot-worker.envelope.json`. This repository's `.gitignore` lists them, so its own desks never show them; an adopting repository's `.gitignore` does not.
2. Desk 3894 was neither reaped nor listed as a leftover, and no reason printed. #1166 already settled `.plot-worker.continue.md` as excusable, so this desk is kept for a reason the output does not name.
3. The kept desks' registry manifests in `.plot/agents/` still named the dead pid, so `plot-fleetctl.sh --status` listed all three as `failed`. #1552's fix did not reach them because the desks were never reaped.

The operator trashed the three directories and the manifests by hand and ran `git worktree prune`.

Related: #1166, #1433, #1552.

## Design

### Approach

Four readers must read one desk the same way (`plot-desk-dirt.sh` header: `plot_worker_dirty_filter`, `desk_dirt`, `bashCleanliness`, and the raw porcelain reads in `plot-dispatch.sh` and `plot-fleetctl.sh`). The change is made in `plot-desk-dirt.sh` and `plot-worker-state.sh`, where the exclusions are stated once, and the other readers are checked against them.

- **Name each file.** Add the four `.plot-worker.*` paths to the named exclusions, in the whole-line, untracked-only form `.plot-worker.continue.md` has, so a tracked or nested `docs/.plot-worker.exit` still counts. The monitor logs are two exact names (`.plot-worker.monitor.worker.jsonl`, `.plot-worker.monitor.agent.jsonl`) plus `.plot-worker.monitor.build.jsonl`, which `desk-fs.ts` also writes. No glob: a glob over `.plot-worker.*` would also excuse a file no code of this repository writes.
- **Keep the live-worker guard.** A desk whose `.plot-worker.pid` names a live process stays kept; the exclusion removes only the dirt reading.
- **Always print a reason.** The reaper prints a reason for desk 3894's case. The slice first reproduces the silent keep to find which arm returns without a line, then fixes that arm.
- **Take the manifest with the desk.** A reaped desk's manifest in `.plot/agents/` goes with it (#1552's rule). The slice proves it on a desk whose only dirt was the excused files.
- **Declared duplicates.** `desk_dirt` and `bashCleanliness` already answer the same question in two languages. The slice extends the existing corpus comparison rather than adding a second copy of the list, and `scripts/check-shell-lines.sh` requires the shell line count not to grow.

### Open Questions

- [ ] Does the reproduction of desk 3894 (a `.plot-worker.continue.md` plus the other files) fail on the missing four names alone, or on a second arm of the reaper? The slice answers this before it fixes anything.
- [ ] Does an adopting repository's `info/exclude` (`plot_desk_exclude`, written at dispatch) offer a better home for the four files than the named exclusions, so a desk's `git status` stays clean for every reader at once? It cannot help desks dispatched before the change, which argues for the named exclusions regardless.

## Slices

### Reaper reads the worker's own files

- `feature/reap-excuses-worker-own-files` — excuse `.exit`, `.monitor.*.jsonl`, `.ending.json` and `.envelope.json` in the dirt readers, print a reason for every kept desk, and reap the manifest with the desk <!-- builds: the worker-own-files exclusions in plot-desk-dirt.sh -->

## Notes

- Raised from tracker issue #2807. Drafted by an unattended run: the ceremony answers are defaults (`Review: pr` because the repository declares `Plan PRs: required`; `Impl: own branches`), and the design question was not asked, so the plan starts in Draft.
- Deliverable search for the four file names found only readers (`ended-desks.ts`, `fleet.ts`, `agents-fs.ts`) and no existing exclusion for them in `plot-desk-dirt.sh` or `plot-worker-state.sh`.
