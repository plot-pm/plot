## Implementation brief — plot-reap-keeps-merged-desks-that

- **Plan (canonical):** docs/plans/2026-11-04-plot-reap-keeps-merged-desks-that.md on main
- **Approved:** 2026-11-05
- **Branch:** `feature/reap-excuses-worker-own-files` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per `Plan PRs: required` — PR review via the configured review channel

This plan has exactly one slice; there is no wave ordering to track.

### What to build

`plot-reap --dry-run` in ewz-kus-portal (2.29.0) kept three merged, delivered desks (`LEFTOVER ... owner: nobody — clear it by hand`) whose only uncommitted paths were the dead worker's own bookkeeping files (`.plot-worker.ending.json`, `.envelope.json`, `.exit`, `.monitor.worker.jsonl`, `.monitor.agent.jsonl`, `.plot-worker.continue.md`). None held a tracked change, an unpushed commit, or a live worker pid. The operator had to trash the directories and manifests by hand.

Three things change:

1. **`desk_dirt`** (`skills/plot/scripts/plot-desk-dirt.sh:117`) gets ten new whole-line untracked-root exclusions (`?? <name>` form, no glob) so these files no longer count as dirt: `.plot-worker.pid`, `.plot-worker.wrapper.pid`, `.plot-worker.exit`, `.plot-worker.log`, `.plot-worker.freewait`, `.plot-worker.ending.json`, `.plot-worker.envelope.json`, `.plot-worker.monitor.worker.jsonl`, `.plot-worker.monitor.agent.jsonl`, `.plot-worker.monitor.build.jsonl`.
2. **`packages/board/src/server/entry/reap.ts`** prints a `keep` reason at two arms that currently skip silently: `:877` (a tree outside `Worktree root` with no `.plot-worker.pid` — not a dispatch tree, never reaped) and `:1543` (a dirty tree whose pid or manifest names a live owner).
3. **Manifest removal already works** (`reap.ts:1130-1138` unlinks it after a reap) — this slice adds no removal code, only a test proving the manifest goes with a desk whose only dirt is the ten files.

### Decisions the plan settles — do not re-derive them

**Named list, not a prefix, in `desk_dirt`.** Three other readers of desk dirt already use the prefix `(^|/)\.plot-worker\.` — `plot_worker_dirty_filter` (`plot-worker-state.sh:569-595`, serves `stalled`/`desk_is_resettable`/restart-release refusals), `bashCleanliness` (`registry.ts:1319`, the board's drop rule), and raw porcelain in `plot-fleetctl.sh:1352`. `desk_dirt` stays on an exact-name list instead, because it is the only reader sitting directly in front of `git worktree remove --force` (`trees-git.ts:545`): every name it excuses is then deleted with no refusal. A tracked, staged, or nested `.plot-worker.*` file must still count as dirt here. Widening `desk_dirt` to the prefix, or narrowing the other readers to the list, are both explicitly out of scope — do not "fix the inconsistency" by unifying them.

**Not added, and why:** `.plot-worker.reporter.fifo` is a FIFO and `git status --porcelain` never lists a FIFO, so it can never reach `desk_dirt` — adding it would be dead code. `.plot-worker.limited`, `.plot-worker.continue.lock`, and a rotated `.plot-worker.log.1` are deliberately left as dirt: none appeared in the issue's desks, and a continue lock can mark a continuation still running. #3144 tracks that decision if it needs revisiting later — this slice does not reopen it.

**Which arm hid desk 3894, settled by the panel:** `reap.ts:1543` hid it from the `LEFTOVER` list because its manifest still existed. The slice closes both silent arms (`:877` and `:1543`) with a row rather than trying to reproduce the exact ewz-kus-portal scenario.

**`info/exclude` rejected as the home for these names** — it only helps desks dispatched after the change, and would be a fifth place stating the exclusions (desk_dirt, the header doc, the three other readers' prefix, and this).

**Live-worker guard is unchanged.** `deskWorkerPid` (`reap.ts:510-516`) reads `.plot-worker.pid`, then the manifest's `pid`/`wrapperPid`, and answers "alive" on a failed reading. The dirt exclusion only removes the dirt *reading* — a desk with a live recorded pid still keeps with `worker alive`. Do not touch `deskWorkerPid`.

**The two new keep-rows add no removal command and change no counter.** The `summary:` footer must stay byte-identical — `unplaced=`, `kept=`, and `dirty_trees=` are asserted by `desk-finding.test.mjs:116`, `sweep.test.mjs:640-771`, and `reap-agent-liveness.test.mjs:447-454`. Don't let the new print statements increment anything those tests pin.

**No corpus comparison is added.** `bashCleanliness` is a bash-flavored routine living inside TypeScript, not a domain rule — `docs/shell-and-domain.md`'s corpus tier doesn't apply here.

**Two other `desk_dirt` callers change behavior as a side effect, and both are covered by existing tests that must keep passing unchanged:**
- `plot-dispatch.sh:2119` (the release path's `git branch -D`, gated on zero file-changing commits beyond origin/main and no running worker) — `test/reconcile/release.test.mjs`.
- `plot-reconcile-scan.sh:2736,2768` (§21 `d_clean` and marker reading) — `test/reconcile/desk-finding.test.mjs:143`.

### Done when

The plan's `## Done when` is expressed through its "Tests that fail on main and pass after" list — treat each as a required assertion, not optional coverage:

- `test/reconcile/desk-dirt.test.mjs`: one case per new name (ten cases) asserting `?? <name>` reads clean with the precondition pattern at `:130`; one case for the full desk-3894 file set (six issue files + `.plot-worker.pid`) reads clean. These currently fail on main.
- Same file, cases that stay dirty before and after: nested `docs/.plot-worker.exit`, a tracked-then-modified `.plot-worker.exit` (` M`), and a staged `.plot-worker.ending.json` (`A `) — each must still name the path in the output.
- `test/reconcile/reap-manifest.test.mjs`: a merged desk holding only the worker's own files is reaped with its manifest (use the test file's own `makeRepo`/own `Agent registry` dir inside its `mkdtemp` root — never this repo's configured registry path). Asserts the desk directory and manifest are both gone and the row says `manifest cleared`. Fails on main today.
- Same file: a desk with a *live* recorded pid (use the test process's own pid) keeps with `worker alive` — this one already passes on main and after; it's the regression guard for the live-worker rule above.
- `packages/board/test/unit/reap-worktree-kind.test.ts`: new keep-row test for the outside-worktree-root arm, asserting both the row text and that `counters.kept`/`counters.unplaced` are unchanged. Fails on main.
- `packages/board/test/unit/reap-dirty-kind.test.ts`: new keep-row test for the owned-dirty-tree arm (manifest under the test's own `mkdtemp`), asserting the row text, no `LEFTOVER` line, and exit `0`. Fails on main.
- `packages/fleet/test/unit/registry.test.ts`: extend the existing `describe` (already covers `PLOT-CORRECTION.md`-shaped cases at `:1295`) with a sibling for `.plot-worker.exit` across three shapes — untracked root (all three readers read clean), nested, and tracked (both prefix readers clean, `desk_dirt` dirty). The untracked-root case fails on main; nested/tracked already pass.

Plus: a changeset (`'plot': patch`, with a `plan:` line pointing at this plan, description first). Update the `plot-desk-dirt.sh` header (`:8-60`) with one entry for the ten names and the narrow-by-design paragraph; also fix the stale path reference at `:11` (`packages/board/server/registry.ts` → `packages/fleet/src/shared/registry.ts`).

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. CI's `select` job runs the `CI suites` config key's entries for touched paths; a failure there comes back as a correction. Don't run the full local suite list by hand.

**Shell-lines gate:** `scripts/check-shell-lines.sh pr` refuses growth in shipped shell line count under `skills/` versus the merge base. This slice's shell change is additive names inside the existing `printf` argument list at `plot-desk-dirt.sh:117` — plan says to split them over backslash continuation lines, which the gate does not count (header: "NOT COUNTED: a backslash continuation"), and comment lines don't count either. Budget is zero actual command lines; if the diff adds any command line, rewrite rather than looking for an offset — the gate has none to grant.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

**Known seam:** PR #3135 (controller gate refusing a read-only `grep`/`sed` naming a gated script) may still be unmerged — if so, read `plot-dispatch.sh` and `plot-fleetctl.sh` with the Read tool rather than a shell command naming them. Plan #3130 (`check-shell-lines.sh` missing from the `Local checks` config key) means this slice must run that gate by name explicitly rather than relying on `plot-local-checks.mjs` to include it.

### Scope guard

Files this branch owns: `skills/plot/scripts/plot-desk-dirt.sh`, `packages/board/src/server/entry/reap.ts`, `test/reconcile/desk-dirt.test.mjs`, `test/reconcile/reap-manifest.test.mjs`, `packages/board/test/unit/reap-worktree-kind.test.ts`, `packages/board/test/unit/reap-dirty-kind.test.ts`, `packages/fleet/test/unit/registry.test.ts`, and one changeset.

As of plan approval (2026-11-04 panel check), no open PR touches `plot-desk-dirt.sh`, `plot-worker-state.sh`, `registry.ts`, `reap.ts`, or `trees-git.ts`. `2026-11-03-a-desk-s-design-question-waits.md` concerns the `PLOT-BLOCKED` arm of the reaper and is unrelated to this slice's changes — re-verify no new seam has opened since approval before starting.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
