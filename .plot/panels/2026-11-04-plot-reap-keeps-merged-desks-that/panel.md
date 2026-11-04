# Panel — plot-reap keeps merged desks that hold only the worker's own files

Subject: `docs/plans/2026-11-04-plot-reap-keeps-merged-desks-that.md` (idea branch `idea/plot-reap-keeps-merged-desks-that`, plan PR #3133, issue #2807)
Convened: 2026-11-04, round 1, against `origin/main`
Lenses: layering, safety, testability, seams — four jurors, one rubric, persona varied only.

## Outcome: UNANIMOUS — 4 amend

| Lens | Position | Evidence |
|---|---|---|
| layering | **amend** | read only |
| safety | **amend** | read only |
| testability | **amend** | read only |
| seams | **amend** | read only (one `grep` refused by the controller gate) |

All four verdict files name a committed position. The gate refused none.

## Where all four agree

1. **Two of the four readers already excuse the files.** `plot_worker_dirty_filter` (`plot-worker-state.sh:89`, `:590`) and `bashCleanliness` (`packages/fleet/src/shared/registry.ts:1319`) drop every path matching `(^|/)\.plot-worker\.`. Only `desk_dirt` (`plot-desk-dirt.sh:117`) names exact lines. The plan's Notes said the opposite for `plot-worker-state.sh`. Verified on origin/main.
2. **`bashCleanliness` lives in `packages/fleet/src/shared/registry.ts`**, not `packages/board/src/server/registry.ts`. The `plot-desk-dirt.sh:11` header carries the same stale path. Verified.
3. **No corpus comparison of the dirt readers exists.** `packages/domain/corpus/` names none of them. Verified.
4. **The reaper is TypeScript.** `plot-reap.sh` launches `board/plot-reap.mjs`; rows, manifest removal and the summary live in `packages/board/src/server/entry/reap.ts`. Three jurors (layering, testability, seams) named this; safety cited `reap.ts` lines throughout. Verified.
5. **Manifest removal already exists** (`reap.ts:1130-1138`), so defect 3 follows from defect 1 and needs a test, not code. Layering, safety and testability state it; seams implies it.

## Where they differ

The moderator records these and does not average them.

- **Prefix or named list.** Layering and seams ask for one rule for all readers and lean to the prefix (reader agreement; the `plot-worker-state.sh:83-88` comment records a drift between a list and a prefix). Safety forbids both alignments: widening `desk_dirt` lets the reaper force-delete a tracked or nested file, and narrowing the other two brings back the `stalled` false positive. Testability names the divergence as a decision for a person. **Decided by the caller:** `desk_dirt` stays narrow (exact names, untracked root lines), the prefix readers keep the prefix, and a test pins the difference.
- **Where the reader test lives.** Layering and seams propose a new corpus comparison; testability offers a new contract test or dropping the sentence; safety names the existing test homes. **Decided by the amender:** extend the existing three-reader comparison at `packages/fleet/test/unit/registry.test.ts:1295`, which no juror found. Reason: it already runs all three readers over real worktrees, and `bashCleanliness` is not a domain rule, so the corpus tier does not fit.
- **The silent keep of desk 3894.** Layering and testability name `reap.ts:877` and `:1543` as candidate arms. Safety argues desk 3894 more probably printed a kind-1 `keep … uncommitted` row and was hidden from `LEFTOVER` by `:1543` because its manifest existed, and warns that a fix that widens dispatch-tree recognition force-removes hand-made worktrees. **Decided by the caller:** both arms print one `keep` row, output only, no tree becomes reapable.
- **Which names to excuse.** Testability lists six (adding `.monitor.build.jsonl`); safety names "the six root files"; seams adds `.log`, `.pid`, `.wrapper.pid`, `.reporter.fifo`, `.freewait` from `.gitignore:63-75`. **Decided by the caller, verified by the amender:** ten names. `.reporter.fifo` dropped because `git status` never lists a FIFO (measured in a scratch repo, 2026-11-04). `.limited`, `.continue.lock` and `.log.1` left as dirt (fail-closed; #3144).
- **Shell-lines cost.** Layering estimates 20 to 35 lines; safety and seams say names inside the `printf` add zero; testability says zero if kept on the line. The `check-shell-lines.sh` header confirms comments and backslash continuations do not count. **Amended plan:** zero commands, no offset.
- **Other `desk_dirt` callers.** Only safety names `plot-dispatch.sh:2119` and `plot-reconcile-scan.sh:2736,2768`. Verified; the amended plan names both and their tests.
- **Process seams.** Only seams names PR #3135 (controller gate refuses a read-only grep naming a gated script) and plan #3130 (`check-shell-lines.sh` missing from `Local checks`). Both carried into the plan.

## What the lenses shared, and could have missed together

- **No juror ran anything.** Every verdict is a reading of origin/main. No juror ran `desk_dirt` on a fixture, ran the reaper, or reproduced desk 3894. The account of desk 3894 is an inference from code in all four.
- **No juror found the existing three-reader test** at `packages/fleet/test/unit/registry.test.ts:1295`, so three proposed building a comparison that half exists.
- **No juror checked that the new rows leave the summary footer unchanged.** `unplaced=`, `kept=` and `dirty_trees=` are asserted by `desk-finding.test.mjs`, `sweep.test.mjs` and `reap-agent-liveness.test.mjs`; the amended plan binds the rows to no counter.
- **No juror checked whether a FIFO can reach porcelain.** It cannot.
- **All four read the issue's porcelain lists as complete.** None asked whether ewz-kus-portal's `.gitignore` hid `.plot-worker.pid` and `.log`, which decides whether kind 1 treated the `free-*` desks as dispatch trees.

## Decisions taken

| Decision | By | Reason |
|---|---|---|
| `desk_dirt` narrow, prefix readers unchanged, a test pins the difference | caller | `desk_dirt` is the only reader before `git worktree remove --force` |
| Ten names, exact list | caller, verified by amender | writers on origin/main; issue evidence |
| Drop `.plot-worker.reporter.fifo` | amender | `git status` never lists a FIFO |
| Keep `.limited`, `.continue.lock`, `.log.1` as dirt | amender | not in the evidence; a lock can mark live work; keeping is reversible (#3144) |
| Keep rows at `reap.ts:877`, `:1543`, no counter change | caller (rows), amender (counters) | output only; the footer is asserted by three test files |
| Manifest removal: test only | caller | `reap.ts:1130-1138` exists |
| Reader test in `registry.test.ts:1295`, no corpus test | amender | the three-reader harness exists; not a domain rule |
| No `info/exclude` home | amender | helps only new desks; adds a fifth statement of the list |
| Shell budget zero, no offset | amender | continuation lines and comments do not count |
