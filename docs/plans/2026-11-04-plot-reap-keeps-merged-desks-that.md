# plot-reap keeps merged desks that hold only the worker's own files

> A merged desk whose only uncommitted paths are the files the worker wrote about itself is reaped with its manifest, and a kept desk always prints a reason.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #2807
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-05, Jan Wloka, plan-PR #3133 merged

## Changelog

- `plot-reap` reaps a merged desk whose uncommitted paths are all untracked root files the fleet wrote (`.plot-worker.pid`, `.wrapper.pid`, `.exit`, `.log`, `.freewait`, `.ending.json`, `.envelope.json`, `.monitor.worker.jsonl`, `.monitor.agent.jsonl`, `.monitor.build.jsonl`), and removes the desk's registry manifest with it. These records, the agent's transcript `.plot-worker.log` included, go with the desk.
- `plot-reap` prints a `keep` row for a worktree it skipped without a row before: a tree outside the `Worktree root` with no worker pid, and a dirty tree whose pid or manifest names an owner.

Board impact: none. The board's drop rule (`bashCleanliness`, `packages/fleet/src/shared/registry.ts:1319`) already excuses every `.plot-worker.` path by prefix, and this slice does not change it. `packages/board/src/server/entry/reap.ts` changes, so `pnpm run typecheck` runs; `main` rebuilds `skills/plot/scripts/board/plot-reap.mjs`, and the PR carries no bundle (`scripts/check-no-bundle-diff.sh`).

## Motivation

`plot-reap.sh --dry-run` (2.29.0) in ewz-kus-portal kept three merged and delivered desks (EWZKUS-3893, 3894, 3895, worktrees `.worktrees/free-*`):

```
LEFTOVER bug/ewzkus-3893-property-cache-verwerfen          4 uncommitted, owner: nobody — clear it by hand
LEFTOVER feature/ewzkus-3895-zevvy-auf-liegenschaftsseiten 5 uncommitted, owner: nobody — clear it by hand
summary: reapable=0 removed=0 kept=6 ... dirty_trees=2 dry_run=1
```

The uncommitted paths were the dead worker's own files. Desk 3893 held `.plot-worker.ending.json`, `.envelope.json`, `.exit` and `.monitor.worker.jsonl`; desk 3895 added `.monitor.agent.jsonl`; desk 3894 also held `.plot-worker.continue.md`. None of the three held a tracked change, an unpushed commit or a live worker pid.

Three defects follow from that report:

1. `desk_dirt` (`skills/plot/scripts/plot-desk-dirt.sh:114-120`) excuses `PLOT-CORRECTION.md`, `.plot-worker.continue.md` and `.plot-worker.pid.startedAt` as whole untracked porcelain lines, and the generated bundles by path. It excuses no other `.plot-worker.*` file. This repository's `.gitignore:63-75` lists them, so its own desks never show them; an adopting repository's `.gitignore` does not.
2. Desk 3894 was neither reaped nor listed as a leftover, and the issue quotes no reason for it. Two arms of `packages/board/src/server/entry/reap.ts` skip a tree with no row: `:877` (kind 1, no `.plot-worker.pid`, no `/plot-wt-` path, outside the `Worktree root`) and `:1543` (kind 4, `runDirtyKind`, a dirty tree whose pid or manifest names an owner). Desk 3894's manifest still existed, so `:1543` hid it from the `LEFTOVER` list.
3. The kept desks' registry manifests in `.plot/agents/` still named the dead pid, so `plot-fleetctl.sh --status` listed all three as `failed`. `reap.ts:1130-1138` already unlinks the manifest after a reap (#1552), and `:1150-1180` clears orphaned manifests. The manifests stayed because the desks were never reaped.

The operator trashed the three directories and the manifests by hand and ran `git worktree prune`.

Related: #1166, #1433, #1552.

## Design

### Readers of a desk's dirt

Four readers read a desk's uncommitted paths. They do not read it the same way, and this slice declares the difference instead of removing it.

| Reader | File | Serves | `.plot-worker.*` rule |
|---|---|---|---|
| `desk_dirt` | `skills/plot/scripts/plot-desk-dirt.sh:114` | the reaper (through `trees-git.ts:342` `dirtyPathsWithStatus`), `plot-dispatch.sh:2119`, `plot-reconcile-scan.sh:2736,2768` | exact names, untracked root lines only |
| `plot_worker_dirty_filter` | `skills/plot/scripts/plot-worker-state.sh:569-595` | `stalled`, `desk_is_resettable`, the `--restart`/`--release` refusals | prefix `(^|/)\.plot-worker\.` (`:89`, `:590`), any status, any depth |
| `bashCleanliness` | `packages/fleet/src/shared/registry.ts:1319` | the board's drop rule | the same prefix (`:1334`) |
| raw porcelain | `plot-fleetctl.sh:1352` | the `--stop` summary count | none (bundles only) |

**`desk_dirt` stays narrow by design.** It is the only reader in front of `git worktree remove --force` (`packages/domain/src/adapters/trees/trees-git.ts:545`). Every name it excuses is a file the reaper then deletes without a refusal. A tracked, staged or nested `.plot-worker.*` file is somebody's decision, so it still counts as dirt in `desk_dirt`. The other two readers answer a status question (is this desk stalled, may the board drop its row), where a wrong "clean" deletes nothing, so they keep the prefix. Widening `desk_dirt` to the prefix and narrowing the other two to the list are both out of scope for this slice and for any agent that implements it.

**A test pins the difference.** `packages/fleet/test/unit/registry.test.ts:1295` already runs `bashCleanliness`, `plot_worker_dirty` and `desk_dirt` over one real worktree per shape for `PLOT-CORRECTION.md`. The slice adds a sibling `describe` for `.plot-worker.exit` with three shapes: untracked root (all three read clean), nested `docs/.plot-worker.exit` and tracked `.plot-worker.exit` (both prefix readers read clean, `desk_dirt` reads dirty). A change that moves either side fails that test.

No corpus comparison of these readers exists in `packages/domain/corpus/`, and the slice adds none: `bashCleanliness` is a bash program inside TypeScript, not a domain rule, so the corpus tier (`docs/shell-and-domain.md`) does not fit.

### Approach

- **Name each file in `desk_dirt`.** Add ten names to the `grep -vxFf` list at `plot-desk-dirt.sh:117`, each in the whole-line untracked form `?? <name>`: `.plot-worker.pid`, `.plot-worker.wrapper.pid`, `.plot-worker.exit`, `.plot-worker.log`, `.plot-worker.freewait`, `.plot-worker.ending.json`, `.plot-worker.envelope.json`, `.plot-worker.monitor.worker.jsonl`, `.plot-worker.monitor.agent.jsonl`, `.plot-worker.monitor.build.jsonl`. Each name has a writer on origin/main: `plot-dispatch.sh:1503-1505` (`.pid`, `.exit`, `.wrapper.pid`), `plot-dispatch.sh:1130` and `continuation.ts:1191` (`.log`), `desk-fs.ts:235` (`.freewait`), `entities/ending.ts:15`, `entities/declaration.ts:9`, `rules/monitor-log.ts:12-14`. No glob.
- **Names not added, and why.** `.plot-worker.reporter.fifo` (`continuation.ts:828`) is a FIFO, and `git status --porcelain` never lists a FIFO, so the name can never reach `desk_dirt`. `.plot-worker.limited` (`worker-loop.ts:1223`), `.plot-worker.continue.lock` (`continue-lock.ts:39`) and a rotated `.plot-worker.log.1` still count as dirt: none appears in the issue's desks, and a continue lock can mark a continuation that is still running. Keeping a desk is reversible. #3144 tracks the decision.
- **Update the header.** The `plot-desk-dirt.sh` header (`:8-60`) gets one entry for the ten names and one paragraph that states the narrow-by-design rule above. The stale path `packages/board/src/server/registry.ts` at `:11` becomes `packages/fleet/src/shared/registry.ts`.
- **Keep the live-worker guard.** `deskWorkerPid` (`reap.ts:510-516`) reads `.plot-worker.pid`, then the manifest's `pid` and `wrapperPid`, and answers alive on a failed reading. The exclusion removes only the dirt reading, so a desk whose recorded pid is alive still keeps with `worker alive`.
- **Print a reason at the two silent arms, and change nothing else.** At `reap.ts:877`, a tree that is not a dispatch tree and is outside the `Worktree root` prints `keep <label> not a dispatch tree (no .plot-worker.pid, outside <root>/) — never reaped`. At `reap.ts:1543`, a dirty tree with an owner prints `keep <branch> <n> uncommitted, owner: <owner> — kept for its owner`. Both rows carry no removal command and increment no counter, so the `summary:` footer stays byte-identical (`unplaced=`, `kept=` and `dirty_trees=` are asserted by `desk-finding.test.mjs:116`, `sweep.test.mjs:640-771` and `reap-agent-liveness.test.mjs:447-454`). The change never alters which trees are dispatch trees or reapable. The main checkout and the invoking tree (`:858`, `:1524`) stay silent. `plot-reconcile-scan.sh` §19 is not touched, so `desk-finding.test.mjs:104` (a hand-made checkout outside the root produces no scan finding) still holds.
- **Manifest removal is existing behaviour.** `reap.ts:1130-1138` already unlinks the manifest. The slice adds no removal code; it adds a test that proves the manifest goes with a desk whose only dirt is the worker's files.
- **No reason text and no manifest code go into shell.** `skills/plot/scripts/plot-reap.sh` is a 13-line launcher for `board/plot-reap.mjs`. Rows and removal live in `reap.ts`.

### Other `desk_dirt` callers

- `plot-dispatch.sh:2119` (the release path that detaches a desk and runs `git branch -D`, `:2131`). A desk that holds only the ten files now detaches and loses its local branch. That arm already requires zero file-changing commits beyond `origin/<main>` (`:2111-2116`) and no running worker (`:2106`), so only empty claim commits go. `test/reconcile/release.test.mjs` covers it and must pass unchanged.
- `plot-reconcile-scan.sh:2736` and `:2768` (§21 `d_clean` and the marker reading). A desk that holds only the ten files now reads clean in §21, which agrees with the reaper. `test/reconcile/desk-finding.test.mjs:143` covers it and must pass unchanged.

### Shell-lines budget

Zero commands. The ten names go into the existing `printf` argument list at `plot-desk-dirt.sh:117`, split over backslash continuation lines, which `scripts/check-shell-lines.sh` does not count (header, "NOT COUNTED: a backslash continuation"). Comment lines do not count either. No offset is needed. If the implementation adds any command line, `check-shell-lines.sh pr` fails, and the slice rewrites the change rather than finding an offset.

### Decisions

- [x] Named list or prefix in `desk_dirt`: named list, untracked root lines only. Settled by the caller after the panel: `desk_dirt` guards a forced removal, and the other readers keep the prefix.
- [x] Which arm hid desk 3894: `reap.ts:1543` hid it from the `LEFTOVER` list because its manifest existed; kind 1 either kept it for `uncommitted` (with `.plot-worker.pid` present) or skipped it at `:877`. The slice does not reproduce ewz-kus-portal. It closes both silent arms with a row, and its tests cover a desk shaped like 3894.
- [x] `info/exclude` (`plot_desk_exclude`) as the home of the names: no. It helps only desks dispatched after the change, and it would be a fifth place that states the exclusions.

### Tests that fail on main and pass after

- `test/reconcile/desk-dirt.test.mjs`: one case per name, `desk_dirt: a desk holding only <name> reads clean, with no ignore rule for it`, ten cases, each asserting the precondition that `git status --porcelain` lists `?? <name>` (the pattern at `:130`). One case for desk 3894's set (the six issue files plus `.plot-worker.pid`) reads clean. These fail on main.
- `test/reconcile/desk-dirt.test.mjs`, cases that stay dirty and pass on main and after: `docs/.plot-worker.exit` (nested), a committed `.plot-worker.exit` modified in the tree (` M`), and `git add .plot-worker.ending.json` (`A `). Each asserts the path is named in the output.
- `test/reconcile/reap-manifest.test.mjs`: `a merged desk holding only the worker's own files is reaped with its manifest`. The fixture uses the file's own `makeRepo` with its own `Agent registry` directory inside the `mkdtemp` root (never the configured registry path of this repository), a merged `plot-wt-*` desk, a `.plot-worker.pid` naming `999999`, the 3894 file set, and a manifest naming the desk and pid `999999`. It asserts the desk directory and the manifest are gone and the row says `manifest cleared`. It fails on main (`keep … uncommitted: ?? .plot-worker…`).
- `test/reconcile/reap-manifest.test.mjs`: `a desk holding only the worker's own files with a live recorded pid keeps with worker alive`, using the test process's own pid. Passes on main and after; it proves the live-worker guard.
- `packages/board/test/unit/reap-worktree-kind.test.ts`: `prints a keep row for a tree outside the worktree root with no worker pid`, asserting the row text and that `counters.kept` and `counters.unplaced` are unchanged. Fails on main.
- `packages/board/test/unit/reap-dirty-kind.test.ts`: `prints a keep row for a dirty tree whose manifest names an owner`, with a manifest under the test's own `mkdtemp` directory, asserting the row text, no `LEFTOVER`, and a return of `0`. Fails on main.
- `packages/fleet/test/unit/registry.test.ts`: the `.plot-worker.exit` reader-difference `describe` above. The untracked-root shape fails on main (`desk_dirt` reads dirty); the nested and tracked shapes pass on main and after.

### Gates

CI runs these on the PR. A non-fleet session runs them locally through `node skills/plot/scripts/board/plot-local-checks.mjs`.

- `node --test test/reconcile/desk-dirt.test.mjs test/reconcile/reap-manifest.test.mjs test/reconcile/desk-finding.test.mjs test/reconcile/release.test.mjs test/reconcile/sweep.test.mjs test/reconcile/reap-agent-liveness.test.mjs`
- `pnpm --filter @plot-pm/board exec vitest related --run --project parallel packages/board/src/server/entry/reap.ts`
- `pnpm --filter @plot-pm/fleet exec vitest related --run packages/fleet/test/unit/registry.test.ts`
- `pnpm run typecheck`
- `./scripts/check-shell-lines.sh pr`, `./scripts/check-bash32-syntax.sh`, `./scripts/check-no-bundle-diff.sh`, and the other `scripts/check-*.sh` gates the `Local checks` key lists. `check-shell-lines.sh` is not in that key yet (#3130), so the slice runs it by name.

### Seams

- PR #3135: the controller gate refuses a read-only `grep` or `sed` whose command line names a gated script such as `plot-dispatch.sh`. Until it merges, read `plot-dispatch.sh` and `plot-fleetctl.sh` with the Read tool, not with a shell command that names them.
- Plan #3130: `check-shell-lines.sh` is missing from `Local checks`. The slice runs it by name (Gates above).
- No open PR touches `plot-desk-dirt.sh`, `plot-worker-state.sh`, `registry.ts`, `reap.ts` or `trees-git.ts` (seams juror, 2026-11-04). `2026-11-03-a-desk-s-design-question-waits.md` concerns the `PLOT-BLOCKED` arm of the reaper, which this slice does not change.

## Slices

### Reaper reads the worker's own files

- `feature/reap-excuses-worker-own-files` — excuse ten untracked root `.plot-worker.*` files in `desk_dirt`, declare the narrow-by-design difference from the prefix readers with a test, print a keep row at `reap.ts:877` and `:1543`, and prove the manifest goes with the desk <!-- builds: the worker-own-files exclusions in plot-desk-dirt.sh -->

## Notes

- Raised from tracker issue #2807. Drafted by an unattended run with default ceremony answers (`Review: pr` because the repository declares `Plan PRs: required`; `Impl: own branches`).
- Round 1, 2026-11-04: four jurors (layering, safety, testability, seams), unanimous amend. Moderation in `.plot/panels/2026-11-04-plot-reap-keeps-merged-desks-that/panel.md`. The draft claimed that `plot-worker-state.sh` had no exclusion for these files, that a corpus comparison existed to extend, and that `bashCleanliness` lived in `packages/board/src/server/registry.ts`; all three were false and are corrected above.
- Files the slice touches: `skills/plot/scripts/plot-desk-dirt.sh`, `packages/board/src/server/entry/reap.ts`, `test/reconcile/desk-dirt.test.mjs`, `test/reconcile/reap-manifest.test.mjs`, `packages/board/test/unit/reap-worktree-kind.test.ts`, `packages/board/test/unit/reap-dirty-kind.test.ts`, `packages/fleet/test/unit/registry.test.ts`, and a changeset (`'plot': patch`, `plan:` line after the description).
