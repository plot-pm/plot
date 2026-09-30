## Implementation brief — an-idle-reading-knows-the-conversation-started

- **Plan (canonical):** `docs/plans/2026-09-29-an-idle-reading-knows-the-conversation-started.md` on `main`
- **Approved:** 2026-09-30, jwloka, in-session (four panel rounds; round 4 `proceed`, built as written)
- **Branch:** `bug/an-idle-reading-knows-the-conversation-started` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention
- **Issue:** #1074

Single-slice plan: nothing waits on this branch, and it waits on nothing. It builds on #1067 (`update_manifest_on_hop` mints a fresh `resumeId` per slice), which is on `main` as `291ce603` via PR #1077. #1085 (the created-desk hop) and #1086 (`plot_manifest_for_worktree` resolves to the desk) are filed separately and are not this branch.

### What to build

`sample_verdict` (`plot-worker-monitor.sh:465`) reads `plot_transcript_quiet_seconds`, which takes the newest mtime across every non-`agent-` `*.jsonl` in the desk's transcript directory. After a hop to a new branch, the new conversation has no file until its first line, so the newest file is the previous slice's. When that file is older than `PLOT_MONITOR_QUIET_SECONDS` (900 s), the new worker is `quiet` on its first two passes and `monitor_pass` publishes `idle` on a silence that the previous session produced. The window is short on an idle machine (the runtime writes its first line 1.56–5.96 s after start, measured on Claude Code 2.1.285) and grows under load, so the defect fires when the fleet is busiest.

The fix: past the window, and only there, `sample_verdict` asks whether `<transcript dir>/<handle>.jsonl` exists. If it does not, the verdict is `unspoken`, and `monitor_pass` publishes nothing, as it does for `busy` and `unknown`. The handle is the manifest's `resumeId`, else `PLOT_SESSION_ID`, the same order the prompt uses. The plan's *Design* section is the spec. This brief lists what not to re-open.

### Settled decisions — do not re-derive them

- **The instrument is the file's existence, not a timestamp.** Round 1 refuted `.plot-worker.pid`'s mtime: it is the wrapper's launch, never rewritten on a hop, and 0 of 17 live transcripts predated it, so the rule was inert. Round 2 refuted the manifest's mtime: seven writers touch the manifest, and `raise_manifest_corrections` and `clear_manifest_branch` rewrite it after the conversation has spoken, so a sandbox read both as not started. Existence compares no timestamps, so the same-second tie does not arise.
- **The quiet number stays desk-wide.** Do not scope `plot_transcript_quiet_seconds` to the handle. An operator typing at the desk is activity at the desk (`plot-transcript-quiet.sh:27-35`). The handle enters only as an existence test, after the number is past the window.
- **The word is `unspoken`.** `unstarted` is an `EndingReason` (`packages/domain/src/entities/ending.ts:55`, written at `plot-worker-loop.sh:2021`, actor rules at `packages/domain/src/transitions/agent.ts:390`). Not `0` (claims output just happened), and not `unavailable` (claims the reading failed). `git grep -w unspoken` finds only this plan and the sprint file today.
- **No new finding, and no grace period.** `prev_verdict` records `unspoken`, so `idle` needs two `quiet` passes after the first line. A bound on the file's absence over N passes is N × `PLOT_MONITOR_INTERVAL`, which is the timer the plan refuses. The unbounded case (a live prompt process that never writes one line) ends at `Worker bound`, which is the cost the monitor already accepts for `unavailable` (`plot-worker-monitor.sh:487-493`).
- **The monitor reads its inherited environment, never `plot_manifest_for_worktree`.** `plot-dispatch.sh` sets `PLOT_SESSION_ID` (`:1426`) and `PLOT_MANIFEST_FILE` (`:1431`) on the wrapper `sh -c`, which starts the monitor as its child (`:1438`). `plot_manifest_for_worktree` resolves `--show-toplevel` to the DESK and ignores `Agent registry`; measured on `free-c7b58b4f`, it names a directory that does not exist.
- **One probe, one handle, two readers.** Move `manifest_resume_id` (`plot-worker-loop.sh:648`) and `session_handle` (`:720`) into `plot-agent-manifest.sh`. Move `session_transcript_exists` (`:698`) into `plot-transcript-quiet.sh` as `plot_transcript_exists`. `session_flag` (`:748`) calls the new name. The monitor sources `plot-agent-manifest.sh` (already vendored, `packages/board/build.mjs:961`). Done-when greps the loop for 0 lines of the old names.
- **The probe is a seventh port, `monitor_conversation_spoken`**, beside the six at `plot-worker-monitor.sh:341-419`. It returns 0 when the file exists, 1 when it does not, and 2 when there is no handle. `sample_verdict` answers `unspoken` on 1 only. **Watch the rc mapping:** the loop's `session_transcript_exists` returns 1 for *no handle* as well as for *no file*, because for `session_flag` an unanswerable probe means create. The port must check the handle itself before it calls `plot_transcript_exists`, or a hand-started monitor with no handle reads every quiet worker as `unspoken` and the fix disables `idle` silently.
- **A missing handle writes one stderr line at start** and behaves as today: `plot-worker-monitor: no session handle (PLOT_SESSION_ID and PLOT_MANIFEST_FILE unset) — idle is judged on the desk alone`. Only a monitor started outside `start_worker` has no handle.
- **The probe is lazy.** `manifest_resume_id` starts one `node` (about 35 ms). Call the port only after `quiet >= PLOT_MONITOR_QUIET_SECONDS`, so a busy worker pays nothing.
- **`monitor_has_commits` is untouched.** Its `-- .` pathspec (#538) excludes the `--allow-empty` claim commit (`plot-worker-loop.sh:2277`), so a correctly reset desk returns rc=1 and `idle` cannot fire. That was measured in round 1.

### Carried-over invariants

- **Absent is not false.** `unspoken` is a reading that was made. `unknown` means no reading. Keep them separate in the code and in comments.
- **`packages/board/plot-worker-monitor.sh` and `packages/board/plot-transcript-quiet.sh` are gitignored build outputs** (`build.mjs:938-966`, `packages/board/.gitignore:22-24`). Edit `skills/plot/scripts/` only, then run `pnpm build:board`.
- **macOS `/bin/bash` is 3.2.** No `declare -A`, no `mapfile`.

### Done when

The plan's `## Done when` list is the specification. Some bullets exist because a naive implementation passes without them:

- **The correction case** (`raise_manifest_corrections`, resumed file 1 200 s old, `idle` still fires): catches any instrument keyed on a manifest write, which is the one round 2 refuted.
- **The same-second tie, asserted with `touch -t`:** catches a comparison of timestamps that has crept back in.
- **The three operator-at-the-desk readings** (own file present plus a newer foreign one → activity; before the own file, a foreign one inside the window → `busy`; before the own file, a foreign one 1 000 s old → `unspoken`): catch a handle-scoped quiet number, and catch a probe that runs before the window check.
- **`drive()` blanks `PLOT_SESSION_ID: ''` and `PLOT_MANIFEST_FILE: ''`** after `...process.env` and before `...env` (`test/reconcile/workermonitor.test.mjs:48`). Without it, a worker running the suite turns 8 of 36 tests red (measured in round 3, 28/36). The clearing test at `:305` builds its own ports and relies on this. Run the file with the variable unset and set; both must pass 36 plus the new cases.
- **The e2e engagement pair** in `test/e2e/worker-monitor-samples.test.mjs`: a real dispatch publishes `idle` when the handle's file is present and old, and no `idle` when it is absent. Round 4's three fixes apply. First, the WORKER writes the handle's file, not the test, because the handle is minted inside the launch and `staffDesk` returns through `plot-dispatch.sh --restart`. Second, "nothing" means no `idle`: `gone` on worker exit is correct, and the healthy-worker test already excludes it (`:319`). Third, `PLOT_TRANSCRIPT_HOME` and `PLOT_MONITOR_QUIET_SECONDS` travel through `staffDesk`'s `env`, as `PLOT_MONITOR_INTERVAL` does. **This suite runs in CI, not locally.**
- **The ewz-leg reading is named.** Reproduce the shape in a sandbox and say which reading it was: pushed work from an earlier attempt, or a reset that fell through. File the other reading as an issue (with the `ai-generated` label if it goes to Jira). Record the result in the PR body.

Plus the repo gates: `nvm use` (Node 24), `node --test test/reconcile/workermonitor.test.mjs test/reconcile/workerloop.test.mjs` green, `pnpm build:board`, `pnpm test`, `pnpm run test:contracts`. Do not run `pnpm run test:e2e` locally. Add a changeset for `'plot': patch` with the description first and a `bumps:` block last, plus `plan: docs/plans/2026-09-29-an-idle-reading-knows-the-conversation-started.md`. Update the three-questions header in `plot-transcript-quiet.sh:36-41` (plan, *Notes*).

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while moving). Never use `gh pr create`.
- When the PR exists, append it inside this plan's slice heading on `main`, `(Branch: bug/an-idle-reading-knows-the-conversation-started, PR: #N)`. That is the form a wave-heading plan parses. A trailing `→ #N` parses as `prs=[]`. Make the edit from a scratch worktree on `origin/main`, not from the shared main checkout.

### Scope guard

This branch owns `skills/plot/scripts/plot-worker-monitor.sh`, `skills/plot/scripts/plot-transcript-quiet.sh`, `skills/plot/scripts/plot-agent-manifest.sh`, the three moved functions in `skills/plot/scripts/plot-worker-loop.sh`, `test/reconcile/workermonitor.test.mjs`, `test/e2e/worker-monitor-samples.test.mjs`, and its changeset.

It does not touch `plot_transcript_quiet_seconds`'s join, `monitor_has_commits`, `reset_desk`, the `gone` path, `plot_manifest_for_worktree` (#1086), or the created-desk hop (#1085).

Verified 2026-09-30 at claim time: none of the in-flight remote branches (`bug/a-question-nobody-asked-has-its-own-word`, `bug/a-state-sweep-is-one-request`, `bug/fleet-status-sees-every-supervisor`, `bug/the-board-runs-the-artifact-its-repo-built`, `changeset-release/main`) changes any file this branch owns.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
