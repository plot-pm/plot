## Implementation brief — idle-is-read-from-what-the-desk-recorded (wave 2: The loop reports idle and the wrapper reports gone)

- **Plan (canonical):** `docs/plans/2026-10-01-idle-is-read-from-what-the-desk-recorded.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-loop-reports-idle` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention
- **Issue:** #1041

Wave 2 of 2. Both waits have merged: `bug/idle-is-one-reading` (#1183) and `bug/the-loop-waits-out-a-usage-limit` (#1202). The plan's line numbers moved with them, so find each site by name, not by the plan's `:NNN`. This branch removes the WorkerMonitor process: the loop's watcher judges `idle`, and the wrapper reports `gone` and `clear`.

### What to build

A dispatched agent runs three resident processes today besides the worker's own shell: the WorkerMonitor, the AgentMonitor and the BuildMonitor (`1 + 4N` for fleet control). The WorkerMonitor exists only because `idle` once needed two samples. Wave 1 made `idle` one reading (`idleNow` in `rules/sample.ts`, `plot_worker_idle_now` in `plot-worker-state.sh`, paired in `corpus/sample.corpus.test.ts`). Wave 2 uses that: no process holds a previous sample, so no process has to exist for it.

Four changes, one PR:

1. **The loop's watcher judges `idle`.** The subshell in `plot-worker-loop.sh`'s prompt function (the `if [ "$MONITOR_ENDS_WORKER" = "1" ]` block that polls `monitor_says_idle`) is rewritten. It starts whatever `PLOT_MONITOR_ENDS_WORKER` says, takes the six readings every `PLOT_MONITOR_INTERVAL` (30 s default), asks `plot_worker_idle_now`, and publishes into `.plot-worker.monitor.worker.jsonl` on a change. The flag now gates ONE thing, the `kill -USR1`. With `0` the watcher keeps judging and publishing and never signals.
2. **The wrapper reports `gone` and `clear`.** In `plot-dispatch.sh`'s `sh -c` blob, after `wait "$agent"; rc=$?`, append one line to the findings file: `gone` when `rc` is not 0 (124, 137, anything else), `clear` when it is 0. The wrapper stops starting the WorkerMonitor.
3. **The WorkerMonitor is deleted** with everything that exists only for it (list below).
4. **The tests are rewritten** around the new owners.

The observable result: `ps` for a dispatched agent shows the worker, the AgentMonitor and the BuildMonitor and nothing else per agent, `1 + 3N`.

### Settled decisions — do not re-derive them

- **The fourth option, not #1041's three.** A state file per agent breaks the supervisor's statelessness (`registryd.ts`, the tick holds nothing). Keeping the WorkerMonitor for `idle` alone leaves `1 + 4N`. Dropping `idle` is the "worthless" topology of `DESIGN-process.md` §0. `registryd.ts` is NOT edited by this branch; the plan lists that as a Done-when bullet.
- **The watcher is the only publisher of `idle`, so it must run whatever the flag says.** Today the loop starts it only when the flag is `1`, and the flag's comment promises `0` *"leaves the finding published"*. Leaving the start conditional would make `0` silently stop publishing. Rewrite that comment: it is wrong after this branch.
- **The readings move into a library the loop already sources.** They live today in `plot-worker-monitor.sh`, which is deleted: `monitor_transcript_quiet`, `monitor_limited_reset` and the clamp in `sample_verdict`, `monitor_conversation_spoken`, `monitor_tree_quiet`, `monitor_has_commits`, and the publish-on-change logic. The loop already sources `plot-transcript-quiet.sh`, `plot-agent-manifest.sh` (`session_handle`) and `plot-worker-state.sh`. Put one reading function in `plot-worker-state.sh` beside `plot_worker_idle_now`, and move the bodies; do not write a second copy of any of them. `monitor_has_commits` is a git count that stays as it is (the scope guard of wave 1 named it untouchable, and it still is: move it, do not change it).
- **The usage-limit clamp stays ahead of the window check.** Silence is measured from the later of the newest transcript line and the reset the desk waits for, and a reset still ahead of now clamps silence to 0. #1202's `test/reconcile/usage-limit.test.mjs` asserts this against the monitor. Repoint it at the new reading; do not delete it.
- **No handle means judged on the desk alone.** `monitor_conversation_spoken`: 0 spoken, 1 unspoken, 2 no handle. The reading maps 0 and 2 to `spoken=1` and 1 to `spoken=0`. Mapping 2 to unspoken disables `idle` for a hand-started loop (the #1074 failure).
- **The pid the watcher passes is the loop's own (`$_watch_loop_pid`).** `pid` is `alive` by construction while the watcher runs. `childOnCore` samples `plot_worker_activity` on that pid inside the pass; only the word `working` is true, and `''` and `idle` are false.
- **`gone` changes meaning, and the operator sees it.** Before: any death of the pid, including exit 0 and the `Worker bound` stop (124). The board turns `gone` into *"restart it"* (`attention.ts`). After: exit 0 appends `clear`, so a finished agent asks for no restart and no earlier `idle` stays the newest line. Keep the line shape of `publish()` exactly (`monitor`, `branch`, `worktree`, `finding`, `since`, `evidence`, `measuredAt`, with `monitor` = `WorkerMonitor`): the board's reader parses it. The wrapper is POSIX `sh` inside single quotes; the line needs `printf` with fixed keys and the values the wrapper already holds. Read how the existing awk in the same blob quotes its values before adding one.
- **The wrapper's `gone` and `clear` lines go to the findings file the wrapper already exports as `PLOT_MONITOR_FILE`**, which is the launch desk. Following a hop to another desk is `a-desk-and-its-manifest-name-each-other`'s slice 2 (`bug/the-monitor-follows-the-hop`), which waits on THIS branch. Do not build it here.
- **`workerMonitorPid` stays in the manifest schema with its `''` default** (`contract/schema.ts`, `manifest-stamp.ts`), so a manifest written by an older desk still parses. The wrapper stops recording a pid for it; the schema is not touched.
- **No `1 + 2N` here.** Merging the AgentMonitor and the BuildMonitor is a separate change.
- **`sample`, `MonitorReading`, `observe` are removed; `publication` stays.** Wave 1 kept them because `entry/monitor.ts` imported them. That file goes now, so `rules/sample.ts` ends with no two-sample path, which is the plan's first Done-when bullet. `publication(published, verdict)` is unchanged and keeps its tests; the plan says so, and a caller may still need it. Remove `sample`'s unit tests with it, and keep `idleNow`'s at 100% branches.

### Carried-over invariants

- **Absent is not false.** `spoken=0` is a reading that was made. An unreadable value (no transcript, no tree, `unanswerable` commits) is a missing reading and answers `silent`.
- **Read the exit code, not the emptiness.** `plot_worker_idle_now` prints one word and returns 0.
- **The watcher publishes a CHANGE, not a state.** It holds the last finding it published in a variable of the subshell. That variable dies with the subshell at the end of each prompt, which is fine: the plan's Open Points say the watcher does not run between prompts.
- **macOS `/bin/bash` is 3.2.** No `declare -A`, no `mapfile`. One `stat` call over all paths and one `date +%s` per pass; `stat -c %Y` first, then `stat -f %m`.
- **Edit `skills/plot/scripts/` only.** `packages/board/plot-worker-monitor.sh` is a gitignored build output. Run `pnpm build:board` after, and commit the regenerated `skills/plot/scripts/board/*.mjs` artifacts that changed.
- **Do not use `kill`-by-name or `pkill`.** The watcher is stopped through `_kill_tree` on the pid the loop recorded, as today.

### One case the plan did not name — write the test first

The old monitor ran for the whole life of the wrapper. The new watcher starts with each prompt and reads the transcript's age from before the prompt began. A prompt started into a conversation whose transcript is already older than the window could read `idle` on its FIRST pass and be ended before the model answers. The usage-limit clamp covers a limited wait and nothing else.

Write the test before the watcher: a desk with commits, a spoken conversation whose transcript is 2000 s old, no child on a core, a tree quiet for 2000 s, and a prompt that has run for 5 s. The watcher must publish nothing and send no signal. If it fails, clamp `silenceSeconds` by the seconds since `_prompt_started_at`, as the limit clamp does, and add one line to the plan's Open Points naming the measurement. If it passes, say why in the PR description. Do not widen the reading without the failing test.

### Done when

The plan's `## Done when` list is the specification, plus these assertions that exist because a naive implementation passes without them:

- **`PLOT_MONITOR_ENDS_WORKER=0` still publishes `idle` and does not end the prompt.** It catches a watcher that is still started only under `1`, which is the old shape and the likeliest regression.
- **A stalled prompt with commits is ended within one window plus one interval.** Use a short window through `PLOT_MONITOR_QUIET_SECONDS` and a short `PLOT_MONITOR_INTERVAL`; do not wait 900 s.
- **Exit 124 and a SIGKILLed agent each produce exactly one `gone` line. Exit 0 produces one `clear` line and no `gone`.** It catches a `[ $rc -ne 0 ]` that tests the wrong variable after the `printf` to the exit file has reset `$?`: read `rc` once, into its own variable, as the blob does.
- **No finding is published between prompts.** The watcher is killed with the prompt, so a desk between slices publishes nothing.
- **`ps` for a dispatched agent shows the worker, the AgentMonitor and the BuildMonitor, and no WorkerMonitor** (`test/e2e/monitors-attached.test.mjs`, rewritten). This is a CI test. Do not run `pnpm run test:e2e` locally.
- **The board still reads the findings.** Run `packages/board/test/unit/attention.test.ts` and `findings-reach-attention.test.ts` unchanged, and keep what `monitors.test.ts` asserts about findings in its replacement. `idle`, `clear` and `gone` lines parse as before.
- **The contract tests of wave 1 survive the move.** `test/reconcile/workeridle.test.mjs` drives the monitor today. Repoint its scratch-desk cases at the loop's reading: tree untouched for the window publishes `idle` on the first pass, a rename inside the window publishes nothing, a desk where only `.plot-worker.*` files changed publishes `idle`, and a file edited inside a wholly new untracked directory publishes nothing (`-uall`). Do not drop one: each guards a measurement in the plan's Open Points.
- **`rules/sample.ts` has no two-sample path; `idleNow` stays at 100% branches** (read the per-file coverage line, not the exit code).

Deletions, each with its references. Search for the file name across the repo after removing, excluding `docs/` history: `skills/plot/scripts/plot-worker-monitor.sh`; `packages/board/src/server/entry/monitor.ts`; `skills/plot/scripts/board/plot-monitor.mjs`; the `plot-worker-monitor.sh` entries in `packages/board/build.mjs` (and the comment about the sourced library beside it), `packages/board/package.json` `files`, and `packages/board/.gitignore`; the `plot-monitor.mjs` comments in `.gitattributes`, `.github/workflows/ci.yml` and `scripts/check-bundle-attributes.sh` (they explain an absence that no longer exists); the `plot-monitor.mjs` comment in `contract/schema.ts`; `test/reconcile/workermonitor.test.mjs` (its surviving cases move into the loop's tests), `packages/board/test/unit/monitors.test.ts` and `test/e2e/monitors-attached.test.mjs`, `test/e2e/monitors-end.test.mjs` (rewrite, do not delete what still asserts a fact). The remaining mentions in `trees-git.ts`, `trees-reads.test.ts`, `resolver.test.ts` and `stuck.test.ts` are probably comments; read each and fix a comment that names a file that is gone.

Plus the repo gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints (`nvm use` first: Node 24). Run `pnpm build:board`, and `pnpm --filter @plot-pm/domain run test:corpus` once, because this branch edits the rule's file and the pair must still agree. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Add a changeset for `'plot': patch` (the package is `plot`, because the skills directory changes), description first, then a `bumps:` block with `skills: plot: patch` and a `plan: docs/plans/2026-10-01-idle-is-read-from-what-the-desk-recorded.md` line inside it. Check that `.changeset/` already holds siblings' files: add yours and touch none of theirs.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while moving). Never use `gh pr create`.
- When the PR exists, annotate it inside the plan's wave heading on `main`: `### The loop reports idle and the wrapper reports gone (Branch: bug/the-loop-reports-idle, PR: #N)` and keep both `<!-- waits: -->` comments. A trailing `→ #N` parses as `prs=[]`. Make the edit from a scratch worktree on `origin/main`, not from the shared main checkout.
- **Do not edit the `<!-- waits: -->` comments for any other reason.** The heading carries two; `plot-plan-meta.sh` keeps only the last one (`docs/plans/2026-10-02-a-slice-waits-on-every-branch-it-names.md` records this). Both waits have merged, so the slice is eligible either way.

### Scope guard

This branch owns: `skills/plot/scripts/plot-worker-loop.sh` (the watcher and the flag comment), `skills/plot/scripts/plot-worker-state.sh` (the moved readings), `skills/plot/scripts/plot-dispatch.sh` (the wrapper blob only), the deleted files above and their references, `packages/domain/src/rules/sample.ts` with its test and barrel export, the rewritten tests, and its changeset.

It does not touch: `packages/board/src/server/entry/registryd.ts`, `plot-agent-monitor.sh`, `plot-build-monitor.sh`, `entry/continue.ts`, `rules/desk-manifest.ts`, the manifest schema's `workerMonitorPid`, `publication`, `monitor_has_commits`'s body, the usage-limit clamp's rule, or the monitor's following a hop.

Collisions, verified 2026-10-02 against `origin/main` at `dfb591d01` by diffing every remote `bug/*`, `feature/*` and `infra/*` branch against the files above: none of the six in-flight branches (`bug/a-worker-runs-at-one-desk`, `bug/delivery-reads-the-last-finished-scan`, `bug/the-draft-rule-reads-every-state`, `bug/the-full-read-asks-verdicts-of-open-prs-only`, `bug/the-plan-index-is-read-once`, `bug/the-two-merge-lookups-agree`) changes one. Two PLANNED slices will: `bug/the-monitor-follows-the-hop` waits on this branch and edits `plot-dispatch.sh`'s wrapper line plus both remaining monitors, and `bug/the-join-is-one-rule` has merged (#1170), so its `plot-worker-state.sh` hunks are already on `main`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
