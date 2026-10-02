## Implementation brief — idle-is-read-from-what-the-desk-recorded (wave 1: Idle is one reading)

- **Plan (canonical):** `docs/plans/2026-10-01-idle-is-read-from-what-the-desk-recorded.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/idle-is-one-reading` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention
- **Issue:** #1041

Wave 1 of 2. This branch waits on nothing and ships alone: the WorkerMonitor stays a running process in this slice. `bug/the-loop-reports-idle` (wave 2) waits on this branch and on `bug/the-loop-waits-out-a-usage-limit`. Wave 2 moves the call site into the loop's watcher and deletes the monitor, so nothing in this branch may assume either move.

### What to build

`idle` needs two samples today. `sample(previous, current)` (`packages/domain/src/rules/sample.ts:106-117`) answers `idle` only when the previous pass was also quiet and the tree fingerprint did not change between the passes, and the monitor holds that previous pass in `prev_verdict` and `prev_tree` (`plot-worker-monitor.sh:491-492`). A process that holds a previous sample cannot be removed, and #1041 asked where `idle` goes when the WorkerMonitor goes.

The fix makes `idle` a one-sample rule. Every condition behind it is already a duration the desk records: the transcript's silence, the age of the newest tree change, and commits on the branch. The CPU stays as a veto. This branch builds the rule in two places (`idleNow` in the domain, `plot_worker_idle_now` in shell), pairs them in the corpus tier, and makes the monitor ask the shell function on every pass instead of comparing two passes.

The observable result: a desk whose transcript and tree have both been untouched for the window, with commits on the branch, publishes `idle` on the FIRST pass. The plan is canonical. This brief lists what not to re-open.

### Settled decisions — do not re-derive them

- **The fourth option, not the three in #1041.** A state file per agent breaks the supervisor's statelessness (`registryd.ts:178-197`). Keeping the WorkerMonitor for `idle` alone leaves fleet control at `1 + 4N`. Dropping `idle` is the "cheapest topology is no monitors, and it is worthless" case (`DESIGN-process.md` §0). All three assume two samples, and the reading that required the second sample was replaced on 2026-09-02, when the quiet reading became transcript silence past a 900 s window. Do not add a state file.
- **The tree reading is one number, `treeQuietSeconds`.** It is seconds since the newest of: HEAD's committer time (`git log -1 --format=%ct`), the mtime of each dirty path, and the mtime of each dirty path's parent directory. The dirty list is the one `monitor_tree_fingerprint` uses today (`plot-worker-monitor.sh:429-444`), filtered through `plot_worker_dirty_filter`, so the monitor's own findings file stays out. A clean tree reads HEAD's time alone. A rename moves the new parent directory's mtime, which is why parents are read at all.
- **The desk root directory's mtime is never read.** The loop writes `.plot-worker.*` records into the desk root, and replacing one (the manifest's `mv`, `plot-dispatch.sh:1535`) moves the root's mtime. `plot_worker_dirty_filter` drops those records from the list, but a dirty path at the root would still contribute its parent, and the loop's own bookkeeping would then read as tree activity: `idle` would never fire. A parent directory counts only when it is BELOW the desk root, and a root-level dirty path contributes its own mtime. The stated cost: a removal or rename at the desk root alone does not move the number.
- **The window is one number for both durations.** `PLOT_MONITOR_QUIET_SECONDS` (900) gates `silenceSeconds` and `treeQuietSeconds`. `≥ window` is `idle`-eligible, exactly as `quiet -lt window → busy` reads today (`plot-worker-monitor.sh:556`).
- **The CPU is a veto and not the verdict, and `childOnCore` is a boolean.** It is true only when `monitor_activity` answers `working`. Both `idle` and `''` (no child holds a clock) are false. That is how `sample_verdict` reads them today ("`''` is not refused", `plot-worker-monitor.sh:575-579`). It is NOT how `observe()` in `sample.ts:73-76` reads `''`: that function belongs to the CPU-snapshot rule and is not the model. The corpus must send the shell the `''` word, not only `working` and `idle`.
- **No handle means judged on the desk alone.** `monitor_conversation_spoken` returns 0 spoken, 1 unspoken, 2 no handle. The port maps 0 and 2 to `spoken` true and 1 to false. Mapping 2 to false disables `idle` silently for a hand-started monitor, which is the failure the #1074 brief names.
- **Unreadable is `silent`, and `dead` is `silent`.** `unrecorded` pid, no transcript (`unavailable`), no tree and `unanswerable` commits each answer `silent`. A failure to observe is not evidence. `dead` also answers `silent`: wave 2's wrapper publishes `gone`, so `idleNow` has no `gone` arm. THIS branch keeps the monitor's own one-sample `gone` arm untouched.
- **A shell duplicate, not a bundle.** `skills/plot/scripts/board/plot-monitor.mjs` is committed, but no build emits it and no script calls it, and the rule is asked once per agent per pass. `docs/shell-and-domain.md` §1 says that frequency duplicates the rule and a test holds the pair. `plot_worker_idle_now` goes in `plot-worker-state.sh`, which the monitor sources (`plot-worker-monitor.sh:251`) and the loop sources (`plot-worker-loop.sh:712`), so wave 2 reads the same function. Put it beside `plot_worker_dirty_filter` (`:431`).
- **`sample`, `MonitorReading`, `observe` and `entry/monitor.ts` STAY in this branch.** `entry/monitor.ts` imports `sample` and `MonitorReading`, and `packages/domain/test/sample.test.ts` tests them. Deleting them here breaks the board typecheck. Wave 2 removes them with `entry/monitor.ts`. The plan's "no two-sample path" bullet describes the end state of both waves, not this PR. `publication` is unchanged.
- **Why one reading is not the hazard the comment warns about.** The header block "TWO SAMPLES, NEVER ONE" (`plot-worker-monitor.sh:100`) was about a CPU snapshot, a process caught between syscalls. Here each non-CPU condition is already a span of at least 900 s, and the CPU is only a veto. Rewrite that block to say so. Also fix the comment in `monitor_pass` that says `idle` needs two `quiet` passes after the first line: after this branch it needs one, and the 900 s of silence after the conversation's first line is what protects it.

### Carried-over invariants

- **Absent is not false.** `spoken` false is a reading that was made. An unreadable value is a missing reading and answers `silent`. Keep them separate in code and in comments.
- **Read the exit code, not the emptiness.** `plot_worker_idle_now` prints one word and returns 0. A caller that tests only for empty output cannot tell "silent" from "the function was missing".
- **Edit `skills/plot/scripts/` only.** `packages/board/plot-worker-monitor.sh` is a gitignored build output. Run `pnpm build:board` after.
- **macOS `/bin/bash` is 3.2.** No `declare -A`, no `mapfile`.
- **`stat` is not portable, and the wrong order is silent.** On Linux, `stat -f %m FILE` prints a filesystem report and succeeds (`plot-fleetctl.sh:466`). Try `stat -c %Y` first, then `stat -f %m`. Check `plot-transcript-quiet.sh` and `plot-fleet-scan.sh:1455` (`file_mtime`) before you write a third helper. Use ONE `stat` call over all paths, and one `date +%s` per pass.
- **`plot_worker_dirty_filter` output is bare paths, not porcelain.** It cuts column 4 on, so a rename arrives as `old -> new` and a path with unusual bytes arrives quoted. Take the part after ` -> `. A deleted path does not exist, so its mtime is unreadable: skip it, and let its parent directory (below the root) carry the change.

### Done when

The plan's `## Done when` list is the specification. Its bullets about wave 2 (`1 + 3N`, `PLOT_MONITOR_ENDS_WORKER=0`, `gone` for exit 124) are not this branch. The assertions that exist because a naive implementation passes without them:

- **Each condition false alone answers `silent`** (`idleNow` and the shell function, six cases). It catches an `&&` that became an `||`.
- **The boundary, for BOTH durations:** window − 1 is `silent`, the window is `idle`. It catches `>` where `≥` belongs.
- **`dead`, `unrecorded`, no transcript, no tree and `unanswerable` each answer `silent`.**
- **The scratch-desk contract test uses a real git repository, not mocked ports.** The existing `drive()` mocks the ports, and mocked ports cannot prove the tree reading. Build a desk with an `origin/main` ref and a commit that touched a file, age files with `touch -t`, and set the transcript directory as `test/e2e/worker-monitor-samples.test.mjs` does. Three cases: (1) a tree untouched for the window plus a silent transcript publishes `idle` on the FIRST pass; (2) a file renamed inside the window publishes nothing; (3) a desk where only `.plot-worker.*` files changed inside the window publishes `idle` on the first pass. Case 3 catches the root directory's mtime being read.
- **A file edited inside a wholly new untracked directory.** Default porcelain collapses it to `?? dir/`, and the directory's mtime moves only when an entry is added or removed. Write the test. If the tree then reads quiet while the file is fresh, use `git status --porcelain -uall` for THIS reading only, and record it in the plan's Open Points. Do not widen the reading silently.
- **The corpus: `packages/domain/corpus/sample.corpus.test.ts`.** The corpus is constructed over every combination of the six fields, including the boundary values and the `''` activity word, run through the shipped `plot_worker_idle_now`. It follows `desk-reset.corpus.test.ts`: `describingAs({ left: 'rule', right: 'shell' })`, one empty-array assertion that collects every disagreement, a floor on corpus size, and an assertion that both `idle` and `silent` are exercised. A disagreement reads `idle-now :: <case> :: rule=idle shell=silent`. **On a disagreement the branch stops.** Fixing either side to make it pass is the one forbidden move. Report it in `PLOT-BLOCKED`.
- **`idleNow` at 100% branch coverage.** The package thresholds are package-wide, so the exit code does not prove it: read the per-file line of `pnpm --filter @plot-pm/domain run test:coverage`.
- **`workermonitor.test.mjs` is rewritten around the new port.** The tree-fingerprint ports and the "tree changed between passes" cases become "tree moved inside the window" cases. Keep the `PLOT_SESSION_ID: ''` and `PLOT_MANIFEST_FILE: ''` blanking in `drive()`. Run the file with the variable unset and set; both must pass.

Plus the repo gates: `nvm use` (Node 24), `node --test test/reconcile/workermonitor.test.mjs test/reconcile/workerloop.test.mjs`, `pnpm --filter @plot-pm/domain run test:corpus`, `pnpm build:board`, `pnpm test`, `pnpm run test:contracts`, `pnpm run typecheck`. Do not run `pnpm run test:e2e` locally. Add a changeset for `'plot': patch` with the description first, then a `bumps:` block with `skills: plot: patch`, and a `plan: docs/plans/2026-10-01-idle-is-read-from-what-the-desk-recorded.md` line inside that block. Add one line naming the new pair to `packages/domain/corpus/README.md`.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while moving). Never use `gh pr create`.
- When the PR exists, append it inside this plan's wave heading on `main`: `### Idle is one reading (Branch: bug/idle-is-one-reading, PR: #N)`. A trailing `→ #N` parses as `prs=[]`. Make the edit from a scratch worktree on `origin/main`, not from the shared main checkout.

### Scope guard

This branch owns: `packages/domain/src/rules/sample.ts` (adds `idleNow` and its types; removes nothing), its export in `packages/domain/src/index.ts` if the barrel exports the rules, `packages/domain/test/sample.test.ts`, `packages/domain/corpus/sample.corpus.test.ts` and its README line, `skills/plot/scripts/plot-worker-state.sh` (one new function beside `plot_worker_dirty_filter`, plus an mtime helper if none can be reused), `skills/plot/scripts/plot-worker-monitor.sh`, `test/reconcile/workermonitor.test.mjs`, the scratch-desk contract test, and its changeset.

It does not touch: `plot-worker-loop.sh`, `plot-dispatch.sh`, `entry/monitor.ts`, `plot-monitor.mjs`, `registryd.ts`, `monitor_has_commits`, the `gone` arm, `publication`, the manifest schema's `workerMonitorPid`, or the usage-limit clamp.

Two in-flight branches collide with this one, verified 2026-10-02 against `origin/main` at `dcca4b90`:

- **`bug/the-loop-waits-out-a-usage-limit`** edits `plot-worker-monitor.sh`. It adds `monitor_limited_reset` and a clamp block in `sample_verdict`, between the numeric check on `quiet` and the window comparison. The `silenceSeconds` this branch passes to the rule MUST be the number after that clamp. Do not copy the clamp into this branch. Whichever branch merges second rebases, and the clamp stays ahead of the window check.
- **`bug/the-join-is-one-rule`** edits `plot-worker-state.sh` (the manifest lookup, roughly `:105-230`) and `packages/domain/corpus/desk-manifest.corpus.test.ts`. This branch adds its function near `:431`, so the hunks should not overlap. Rebase onto it if it lands first.

No other in-flight remote branch changes a file this branch owns.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
