## Implementation brief — a-desk-and-its-manifest-name-each-other (slice 2: The monitor follows the hop)

- **Plan (canonical):** `docs/plans/2026-10-01-a-desk-and-its-manifest-name-each-other.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-monitor-follows-the-hop` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (CI plus a person reading the diff)
- **Issue:** #1085

Both waits are met on `main`: slice 1 (`bug/the-join-is-one-rule`) landed `packages/domain/src/rules/desk-manifest.ts` with `manifestDirectory` and `deskManifest`, and `bug/the-loop-reports-idle` (#1218) removed `plot-worker-monitor.sh`. Slices 3 and 4 wait on slice 1 only and do not wait on this one, but slice 3 adds `loopRegistration` to the same file, so add `watchedDesk` as a separate export and leave the existing two untouched.

### What to build

A dispatched agent that hops to its next slice cuts a new desk (`plot-wt-<suffix>`), writes it into the manifest's `worktree` field (`update_manifest_on_hop`, `plot-worker-loop.sh:311`, called at `:2973`) and exports it as the loop's own `PLOT_WORKTREE` (`:2994`). The wrapper started its children once, with `PLOT_WORKTREE` fixed at launch, so after the hop two of them still look at the old desk:

- `plot-agent-monitor.sh:119` and `plot-build-monitor.sh:130` copy `PLOT_WORKTREE` once. After a hop the BuildMonitor reads the OLD desk's HEAD (`monitor_head_sha`) while `monitor_branch` re-reads the old desk's branch, so it asks the host about a commit the agent no longer works on, and it writes its findings into the old desk's `.plot-worker.monitor.build.jsonl` while the loop reads the new one. The AgentMonitor reads the old desk's dirt, blocked marker and transcripts the same way.
- The wrapper's `gone`/`clear` line (`sh -c` body in `plot-dispatch.sh`, after `wait "$agent"`) goes to `PLOT_WRAPPER_FINDINGS_FILE`, which the dispatcher set to `$wt/.plot-worker.monitor.worker.jsonl` at launch, and it prints `PLOT_WORKTREE` in the line's `worktree` field. After a hop both name the launch desk, while the loop's watcher (and the board's reader) look in the new desk. A killed hopped agent therefore never reads `gone`.

Build `watchedDesk({ launched, manifestWorktree })` in `rules/desk-manifest.ts`: the manifest's `worktree` when it is non-empty, else `launched`. Then:

- the AgentMonitor and the BuildMonitor read the manifest's `worktree` at the start of every pass (the wrapper already exports `PLOT_MANIFEST_FILE` to them, `plot-dispatch.sh` env block) and apply the rule. Everything desk-derived follows: `worktree`, the default findings path, and the `publish()` line's `worktree` field;
- the wrapper reads the manifest ONCE, right after `wait "$agent"` returns, applies the rule, and appends its line to `<watched desk>/.plot-worker.monitor.worker.jsonl` with the watched desk in the `worktree` field.

The plan is canonical. This brief is orientation.

### Decisions the plan settles — do not re-derive them

**`PLOT_PID_FILE` and `PLOT_EXIT_FILE` stay at the launch desk.** The wrapper writes the agent pid and the exit status there, and the loop empties the old pid file on a hop (`move_worker_record`). `plot-monitor-subject.sh` already reads an empty pid plus a `.plot-worker.exit` beside it as `gone`. Do not move them and do not derive `pid_file` from the watched desk: the monitor would then wait on a pid file nobody writes and never end with its agent (`test/e2e/monitors-end.test.mjs` measures that hang).

**The shell keeps a declared duplicate and no bundle call.** The BuildMonitor passes every 30 s per agent, so a 39 ms `node` start per pass is the per-pass cost *A Shell Script Asks The Domain* assigns to duplication. Add a `watchedDesk` row to `packages/domain/corpus/desk-manifest.corpus.test.ts` (it exists from slice 1): the real shell function and the rule over the same fixtures, naming both answers on a disagreement. On a disagreement the branch stops; adjusting either side to make the comparison pass is the one forbidden move. No new `plot-*.sh` script: keep the shell reading in the two monitors and in the wrapper body, and put a shared function in `plot-monitor-subject.sh` only if both monitors source it already (they do).

**An empty or unreadable manifest field falls back to the launch desk.** Absent is not false: a hand-started monitor with no `PLOT_MANIFEST_FILE`, a manifest that is gone and a manifest whose `worktree` is empty all mean "watch what you were launched on", never "watch nothing" and never a crash. A manifest `worktree` that names a directory that does not exist is NOT a fallback case in the rule (the rule is string work); the monitors' existing `[ -d "$worktree" ]` guards already answer it.

**Do not touch `plot-worker-monitor.sh` or `PLOT_WORKTREE` for the loop.** The file is gone. The loop's watcher already follows the hop because the loop exports the new desk; the plan's `workerloop.test.mjs` case only LOCKS that in and passes on `main` today. Keep it, but expect it green before your change.

### Traps the plan does not name

**1. The wrapper body is single-quoted `sh -c` run by dash.** Everything you add to the `sh -c '…'` string in `start_worker` must avoid `'`, bashisms (`[[ ]]`, `${var//}`, arrays, `local`) and anything that needs the outer function's variables: they travel as `PLOT_*` env vars, as `PLOT_WRAPPER_FINDINGS_FILE` does. Pass nothing but `PLOT_MANIFEST_FILE` and `PLOT_WORKTREE`, which are already exported. A new `'` inside the body closes the string early and fails far from where you typed it. Prefer a small shell function defined in a script the wrapper already puts on `PATH` (`PATH="$PLOT_SCRIPT_DIR:$PATH"` is set before the agent starts) over inline `awk`/`sed` in that string.

**2. The manifest is JSON written by `JSON.stringify(…, null, 2)`**, so the field is a line `  "worktree": "<path>",` (the wrapper's own `awk` already matches fields by that exact shape). Read it with `sed`/`awk` on that line and unescape nothing beyond `\\` and `\"`, or ask `node -e`/`jq` ONLY where it runs once (the wrapper's single read after `wait`), never on the 30 s pass. A path with a quote or backslash in it must not corrupt the findings line: the monitors' `publish()` escapes through `json_escape`, the wrapper's `printf` does not, so check what it prints for a desk path containing a space.

**3. A hop races the pass.** `update_manifest_on_hop` writes the manifest (`mv -f` of a temp file, so a reader sees the old or the new file whole) BEFORE the loop exports `PLOT_WORKTREE` and before the new desk holds a checked-out HEAD in some paths. A pass that reads the new `worktree` and finds no HEAD yet takes the monitors' existing "no head, no question" branch (`monitor_head_sha` returns nothing) and asks nothing. Do not add a retry, a lock or a sleep for this.

**4. `monitor_pass` in the BuildMonitor reads `worktree` through three functions** (`monitor_head_sha`, `monitor_branch`, `publish`) and the AgentMonitor through `plot_worker_dirty*`/`plot_worker_blocked*` and its transcript probe. Re-assign `worktree` (and `findings` when `PLOT_MONITOR_FILE` is not set) once at the top of `monitor_pass`, in the one place, rather than threading a parameter through each reader. A test sources both files with `PLOT_MONITOR_NO_MAIN=1` and redefines the ports, so keep the port names and signatures unchanged. If `PLOT_MONITOR_FILE` IS set it wins and does not follow the desk, which is the existing contract (`plot-agent-monitor.sh` usage text), but update both usage texts: `PLOT_WORKTREE` becomes "the desk it STARTS on; it follows the manifest's `worktree` from then on".

**5. The AgentMonitor publishes `clear` by comparing against its last published finding,** and its subject desk now changes between passes. A finding about the old desk (`holds unlanded work`) must not be reported cleared merely because the new desk is clean: after a hop the first pass compares a new desk against old state. Read how `published`/`since` are kept in `monitor_pass` and decide deliberately whether a desk change resets them; say which you chose and why in the PR body. Do not paper over it.

### Done when

The plan's `## Done when` list is the specification. Each test below must FAIL on `origin/main` and PASS on the branch; run each against `main` before claiming it.

- **BuildMonitor case** (`test/reconcile/buildmonitor.test.mjs` or a new file beside it): start `plot-build-monitor.sh --once` with `PLOT_MANIFEST_FILE` naming desk A, rewrite the manifest's `worktree` to desk B, run `--once` again, and assert the second finding names desk B (head sha and `worktree` field) and lands in B's `.plot-worker.monitor.build.jsonl`, with nothing new in A's. A naive fix that re-reads only the branch passes the first run and fails this.
- **AgentMonitor case**, same shape, in `test/reconcile/agentmonitor.test.mjs`: a debt on B (uncommitted work, or a blocked marker) is reported in B's `.plot-worker.monitor.agent.jsonl`, naming B.
- **Dispatch contract case** (`test/reconcile/dispatch.test.mjs`): hop an agent (rewrite the manifest's `worktree` to a second desk while the wrapper's agent runs), let the agent exit 124, and assert the `gone` line lands in the NEW desk's `.plot-worker.monitor.worker.jsonl` and its `worktree` field names the new desk. A second case: manifest absent at exit, the line lands in the launch desk (the fallback).
- **`workerloop.test.mjs` case** (locks in #1218): drive the create path of the hop (`reset_desk` refused at step 1, #1085's third row) and assert the loop's watcher publishes `idle` into the new desk's `.plot-worker.monitor.worker.jsonl`.
- **`packages/domain/test/desk-manifest.test.ts`:** `watchedDesk` branches (non-empty manifest worktree, empty, whitespace-only) at 100% branch coverage; keep the module's existing coverage.
- **Corpus:** `watchedDesk` row in `desk-manifest.corpus.test.ts` driving the real shell reading.
- `test/e2e/monitors-attached.test.mjs` and `monitors-end.test.mjs` assert the monitors still start and still end with their agent; CI runs them. Do not run `test:e2e` locally (it is CI's gate).

Plus: one `plot` patch changeset with the description first and the `bumps:` block last (`skills: plot: patch`; add `plan: docs/plans/2026-10-01-a-desk-and-its-manifest-name-each-other.md` inside the block). Add `'@plot-pm/board': patch` only if a `packages/board` file changes. Run `./scripts/check-changeset-packages.sh`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Use `nvm use` (Node 24) before any `pnpm` command.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while work continues). Do not use `gh pr create`.
- When the PR exists, append `→ #<number>` inside this slice's heading in the plan's `## Slices` (`(Branch: bug/the-monitor-follows-the-hop, PR: #N)` is the form waved plans parse), through a scratch worktree on `origin/main`.
- Do not `git add -A` after a suite run: board tests rewrite the tracked `tiny-garden/.plot/state` fixture.

### Scope guard

This branch owns:

- `packages/domain/src/rules/desk-manifest.ts` (add `watchedDesk` only), `packages/domain/test/desk-manifest.test.ts`, `packages/domain/corpus/desk-manifest.corpus.test.ts` (one row)
- `skills/plot/scripts/plot-agent-monitor.sh`, `skills/plot/scripts/plot-build-monitor.sh`, and `skills/plot/scripts/plot-monitor-subject.sh` if the shared reading goes there
- the wrapper's `sh -c` body and its env block in `skills/plot/scripts/plot-dispatch.sh` (the `gone`/`clear` line only)
- the tests named above

Other branches in flight on the same plan: `bug/a-continued-loop-carries-its-manifest` (slice 3: adds `loopRegistration`, edits `continue.ts` and `wait_for_work` in `plot-worker-loop.sh`) and `bug/a-desk-with-no-manifest-says-so` (slice 4: `synthesizeEntry` and `registry.ts`). Neither edits the monitors or the wrapper. Do not edit `plot-worker-loop.sh`, `continue.ts` or `registry.ts` here.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
