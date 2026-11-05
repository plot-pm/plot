# Testability juror: plot-reap keeps merged desks that hold only the worker's own files

Lens: is every behaviour asserted on a domain property or a script contract without a browser, does each named test fail before the change and pass after, and can the test run without touching the operator's real fleet, launchd or port 7777?

Position: amend

## Summary

The defect is real and testable without a browser, and isolated harnesses for it already exist. The plan names no test at all, two of its claims about the code are false in ways that change which tests can fail before the change, and the silent-keep fix has no fixture shape an unattended agent can reproduce.

## Findings

### F1. The plan names no test

The `## Slices` line and `## Design` name behaviours but no test file and no test name. Rubric question 6 cannot be answered from the plan. Usable harnesses exist on origin/main:

- `test/reconcile/desk-dirt.test.mjs` sources `plot-desk-dirt.sh` against a real git repo in `mkdtempSync` (line 20). Its tests at lines 109–146 (`.plot-worker.continue.md`, `.plot-worker.pid.startedAt`) are the exact pattern for the four new names. These fail before the change: `desk_dirt` (`plot-desk-dirt.sh`, last function) excuses only `?? PLOT-CORRECTION.md`, `?? .plot-worker.continue.md` and `?? .plot-worker.pid.startedAt`.
- `packages/board/test/unit/reap-worktree-kind.test.ts` and `reap-dirty-kind.test.ts` drive `runWorktreeKind` / `runDirtyKind` with a stubbed `Trees` and a manifest dir under the test's own `mkdtemp` root (`reap-worktree-kind.test.ts:18`, `:75`). No fleet, launchd or port is touched.

### F2. `plot-worker-state.sh` already excuses these files, so no test there can fail before

`plot-worker-state.sh:89` sets `PLOT_WORKER_RECORD='\.plot-worker\.'` and `plot_worker_dirty_filter` drops every path matching `(^|/)\.plot-worker\.` (`:590`). `bashCleanliness` (`packages/fleet/src/shared/registry.ts:1319`, program at ~1340) carries the same pattern. The plan's Notes ("no existing exclusion for them in `plot-desk-dirt.sh` or `plot-worker-state.sh`") is false for the second file, and the Approach ("the change is made in `plot-desk-dirt.sh` and `plot-worker-state.sh`") schedules a change with no failing test. `desk_dirt` is the only reader that lacks the exclusion.

### F3. The "existing corpus comparison" does not exist

`packages/domain/corpus/` holds no file that names `desk_dirt`, `deskDirt` or `bashCleanliness` (grep over origin/main: zero hits). The plan tells the slice to "extend the existing corpus comparison". An unattended agent either invents one or skips it. Also note: the plan's own design makes the readers disagree on purpose. It keeps `docs/.plot-worker.exit` and a tracked copy dirty in `desk_dirt`, while `plot_worker_dirty_filter` and `bashCleanliness` excuse any `.plot-worker.` path, nested or tracked. A comparison test written after this change fails on that fixture unless the divergence is declared. The plan says "must agree" in the Board impact line and designs disagreement in the Approach.

### F4. A stubbed-trees reap test passes before the change

`reap-worktree-kind.test.ts:61` stubs `dirtyPathsWithStatus`, so a test that feeds it `['?? .plot-worker.exit']` asserts the stub, not `desk_dirt`. The exclusion is proven only by `desk-dirt.test.mjs` (script contract) or by a test that goes through `treesGit` with a real `scriptDir` (`trees-git.ts:225`, `:339`). The plan must say which layer carries the fail-before assertion, or a Sonnet agent will write the stub version and it will pass on main.

### F5. Manifest removal is existing behaviour; its test needs the real reader to fail before

`reap.ts:246–270` already takes worktree, then manifest, then log. The plan's "take the manifest with the desk" adds no code. "The slice proves it on a desk whose only dirt was the excused files" fails before the change only if the dirt reading is the real `desk_dirt`. With a stub it passes on main. The test must pass its own manifest dir (as `reap-given-up-desk.test.ts:166` does) and never the configured `Agent registry` key, which in this repository is the absolute path of the operator's real `.plot/agents`.

### F6. The silent keep has no reproduction recipe

`runWorktreeKind` has silent `continue` arms. The likely one for desk 3894 is `reap.ts:877`: a tree with no `.plot-worker.pid` and a path outside `wtRoot` is skipped with no row. `runDirtyKind` skips silently at `:1543` when `dirtyTreeOwner` answers anything other than `nobody`, for example when a manifest still exists. The issue says 3894's manifest still named the dead pid, so `:1543` would hide it from the LEFTOVER list. The plan's Open Question defers this to the slice with no fixture shape: which files 3894 held beyond the porcelain list (`.plot-worker.pid` present or not, manifest present or not), and what `Worktree root` the adopting repo declares. Without that, "reproduce first" is not a test an agent can write.

### F7. No browser and no rebuild are needed

`bashCleanliness` already excuses `.plot-worker.*` (F2), so the board's drop reading does not change. The board impact line can say so as a fact.

## Amendments required

1. Name the tests. For `test/reconcile/desk-dirt.test.mjs`: one "a desk holding only `<name>` reads clean" case per name (`.plot-worker.exit`, `.plot-worker.ending.json`, `.plot-worker.envelope.json`, `.plot-worker.monitor.worker.jsonl`, `.plot-worker.monitor.agent.jsonl`, `.plot-worker.monitor.build.jsonl`), one case with all of them plus `.plot-worker.continue.md` (desk 3894's set), and one "a real file beside them still reads dirty" case. State that each fails on origin/main.
2. Remove `plot-worker-state.sh` from the change, and correct the Notes line: its filter already excuses `.plot-worker.` paths (`plot-worker-state.sh:89`, `:590`).
3. Replace "extend the existing corpus comparison" with a decision: either add a new contract test that runs `desk_dirt`, `plot_worker_dirty_filter` and `bashCleanliness` over the same fixture desks and declares the nested/tracked divergence, or drop the corpus sentence. Name the file.
4. For the silent keep, name the arms to test (`reap.ts:877` and `:1543`) and require one `runWorktreeKind` / `runDirtyKind` unit test per arm that asserts a printed row for a desk shaped like 3894: no live pid, a manifest present, only excused files. Assert on the printed row text, which is a script contract.
5. Say that the manifest assertion runs through `treesGit` with a real `scriptDir` in an `mkdtemp` git repo with an explicit manifest dir, or say that manifest removal is existing behaviour and drop it from the slice's claims.
6. Name the `scripts/check-shell-lines.sh` cost: six names added to `desk_dirt`'s `printf` list cost lines only if written one per line. Keep them on the existing line or name the offset.

## Decisions for a person

- Whether `desk_dirt` should keep a nested or tracked `.plot-worker.exit` dirty while `plot_worker_dirty_filter` and `bashCleanliness` excuse it. This is the one reader disagreement the change would create, and choosing which reader is right is judgement (CLAUDE.md, "A Shell Script Asks The Domain").
- Whether the silent keep at `reap.ts:877` (a desk with no `.plot-worker.pid` outside `Worktree root`) should print a row. This changes output for every non-dispatch worktree the reaper sees.

## Ran versus read

Ran (read-only): `git fetch origin main`; `git show` / `git grep` on origin/main for `plot-desk-dirt.sh`, `plot-worker-state.sh`, `packages/fleet/src/shared/registry.ts`, `packages/board/src/server/entry/reap.ts`, `packages/domain/src/adapters/trees/trees-git.ts`, the reap and desk-dirt test files, and the `packages/domain/corpus/` listing; `gh issue view 2807`. Ran no test suite, no fleet, board or host write. The fail-before claims for `desk-dirt.test.mjs` come from reading `desk_dirt`'s exclusion list, not from running the test.
