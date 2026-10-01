# An idle reading knows the conversation started

> The idle verdict reads the desk's newest transcript mtime, which on a reused desk is the PREVIOUS session's. A new conversation that writes nothing for 900 s is ended as idle on a silence it did not produce.

## Status

- **State:** Released
- **Approved:** 2026-09-30, jwloka, in-session
- **Type:** bug
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Issue:** #1074
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 4
- **Started:** 2026-09-30, jwloka, `bug/an-idle-reading-knows-the-conversation-started`
- **Delivered:** 2026-09-30
- **Released:** 2026-10-01, v2.22.0

## Changelog

- The idle verdict no longer fires on a conversation that has not written yet: a worker whose own conversation has no transcript file reads as `unspoken`, not as silence, and the monitor publishes nothing for it.

Board impact: none. This is the worker monitor's verdict, which the board renders but does not compute.

## Motivation

`plot-transcript-quiet.sh:105-106` takes the newest mtime across every non-`agent-` `*.jsonl` in the desk's project directory:

```sh
if [ -z "$newest" ] || [ "$mtime" -gt "$newest" ] 2>/dev/null; then newest="$mtime"; fi
done < <(find "$dir" -maxdepth 1 -type f -name '*.jsonl' -print0 2>/dev/null)
```

No session id enters that loop, and its header says so deliberately (`:27-35`): the question is *is anything happening at this desk*, and an operator typing at the same worktree is a true answer to it.

**That join is right for its own question and wrong for the one `idle` asks.** `plot-worker-monitor.sh:545-551` fires `idle` when four conditions hold together: this pass quiet, the previous pass quiet, the tree unchanged, and `monitor_has_commits` yes. Every one of those reads the DESK. None asks whether the current worker's conversation ever started.

So a worker whose first prompt is slow inherits the previous session's last write as its own activity clock. If that write was more than `PLOT_MONITOR_QUIET_SECONDS` (900 s) ago — which on a reused desk it usually is — the worker is quiet from its first pass, quiet again on its second, and ended on a silence produced by a session that already finished.

### The commit condition should have refused, and the ticket could not establish why it did not

#1074 records the ewz-leg finding as *"the branch already carries commits"* and says it cannot be established whether the reset fell through.

**It can be established, and the answer narrows this plan.** `monitor_has_commits` counts with a pathspec:

```sh
n=$(git -C "$worktree" rev-list --count "$base..HEAD" -- . 2>/dev/null) || return 2
```

The `-- .` keeps only commits that TOUCHED A FILE, and the loop writes the claim as `commit --allow-empty` (`plot-worker-loop.sh:2277`). That pathspec was added for #538, where a claim commit satisfied the guard that was meant to refuse. So on a correctly reset desk — `reset_desk` detaching to `origin/<main>` at `plot-worker-loop.sh:928` before cutting the new branch — `has_commits` returns 1 and `idle` cannot fire.

**Two readings survive, and they need different fixes:**

1. The reset fell through and the desk kept the previous slice's commits. Then the defect is in `reset_desk`, not here.
2. The branch carried pushed work from an earlier attempt — a `--restart`, or a slice resumed after a stop. Then `has_commits` is correctly yes and the quiet join is the whole defect.

**This plan fixes (2) and MEASURES (1) rather than assuming it away.** The first slice reproduces the ewz-leg shape in a sandbox and reports which reading it is; the fix does not depend on the answer, because the join is wrong in both.

### Why #1067 does not remove it

#1067 (`bug/a-slice-starts-its-own-conversation`, PR #1077, merged as `1427ccc2`) makes a hop to a new branch mint a fresh `resumeId` (`update_manifest_on_hop`, `plot-worker-loop.sh:301-306`), so the first prompt on the new slice runs with `--session-id` and writes a new `<resumeId>.jsonl`. That removes the measured *cause* of the 2 770 s silence: the first prompt no longer reloads the previous slice's transcript.

**It also makes this defect reachable, and it leaves the reader unchanged.** The transcript directory now holds one file per slice, and `plot_transcript_quiet_seconds` still takes the newest mtime across all of them. Until the new conversation writes its first line, the newest file is the previous slice's. That window runs from the hop's manifest write (`plot-worker-loop.sh:2314`) to the runtime's first line: the loop's own work before the prompt, plus process start. The runtime writes its `queue-operation` lines before its first model call — measured on Claude Code 2.1.285, 1.56 s after a `--resume` and 5.96 s after a fresh `--session-id` — so a slow model does not extend the window, and a model that hangs after that line makes the NEW file go quiet, which the existing rule reads correctly. A machine under load extends it. **A defect that is only reachable under load fires when the fleet is busiest.**

## Design

### The rule

**An idle verdict requires evidence that THIS worker's conversation has written.** The conversation has written when a transcript file named for its handle exists: `$(plot_transcript_dir "$worktree")/<handle>.jsonl`. Where that file does not exist, the conversation has not spoken yet, and a desk-wide silence says nothing about it.

**The instrument is the probe the loop already uses.** `session_transcript_exists` (`plot-worker-loop.sh:698-705`) asks exactly this question to choose between `--session-id` and `--resume` (`session_flag`, `:749`). The monitor asks the same probe with the same handle. One probe with two readers cannot disagree about whether a conversation exists.

**The quiet NUMBER stays desk-wide.** `plot_transcript_quiet_seconds` is unchanged: it still takes the newest mtime across every non-`agent-` file in the desk's directory, for the reason its header gives at `plot-transcript-quiet.sh:27-35`. An operator typing at the desk is activity at the desk. The handle enters only as an existence test, and only after the number is past the window.

### The rule against every writer of the manifest

The handle is the manifest's `resumeId`, and seven writers touch the manifest. The rule reads the field, not the file's mtime, so only a writer that changes `resumeId` can change the answer:

| writer | where | changes `resumeId`? | answer after it |
|---|---|---|---|
| launch pid stamp | `plot-dispatch.sh:1438-1471` | no | `unspoken` until the first line, then a number |
| `performerShell.assignSlice` | `performer-shell.ts:71` | no | as before the write |
| `update_manifest_on_hop` to a new branch | `plot-worker-loop.sh:301`, called `:2314` | **yes**, a fresh id | `unspoken` until the new conversation writes |
| `update_manifest_on_hop` to the same branch | same | no | a number — the file exists |
| `raise_manifest_attempts` | `plot-worker-loop.sh:398`, called `:2015` | no | `unspoken` if the prompt never ran, else a number |
| `raise_manifest_corrections` | `plot-worker-loop.sh:465`, called `:2080` | no | a number — the resumed conversation's file exists |
| `clear_manifest_branch` | `plot-agent-manifest.sh:47`, called `:2133` | no | a number — the slice's file exists |
| `writeManifestStamp` | `continue.ts:566` | no | no reader: `/api/continue` starts no WorkerMonitor (`continue.ts:558`) |

A same-second tie does not arise, because the rule compares no timestamps. A transcript file created in the same second as the hop exists, and the conversation reads as started.

### The word is `unspoken`, and it is not a finding

`plot-transcript-quiet.sh` already answers `unavailable` as a WORD rather than a number: a caller that reads an absent capability as *quiet for 0 seconds* would report every unreadable agent healthy. This needs the same treatment. `unspoken` is not `0`, which claims output just happened, and not `unavailable`, which claims the reading could not be made. The reading was made, and it says this conversation has not written.

**`unstarted` is not available.** It is an `EndingReason` (`packages/domain/src/entities/ending.ts:55`), written at `plot-worker-loop.sh:2021` when the prompt exited without running on every start attempt, and `packages/domain/src/transitions/agent.ts:390` gives it its own actor rules. One word for an ending and for a non-finding would make a log grep ambiguous. `unspoken` names the observed fact (no line written), and `git grep -w unspoken` finds no other use in `skills/`, `packages/` or `docs/`.

`sample_verdict` returns `unspoken` and `monitor_pass` publishes NOTHING on it, exactly as it does for `busy` and `unknown` (`plot-worker-monitor.sh:560-562`). `prev_verdict` records it, so the two-sample rule needs two `quiet` passes after the first line before `idle` can fire. **No new finding is added.**

### How the monitor reaches the handle

**The monitor reads the environment it already inherits, and never the worktree finder.** `plot-dispatch.sh` sets `PLOT_SESSION_ID` (`:1426`) and `PLOT_MANIFEST_FILE` (`:1431`) on the wrapper `sh -c`, and the wrapper starts the monitor as its child (`:1438`). Neither variable is read by the monitor today.

- `manifest_resume_id` (`plot-worker-loop.sh:648`) and `session_handle` (`:720`) move into `plot-agent-manifest.sh`, which the loop already sources (`:333`). The monitor sources the same file. The handle is the manifest's `resumeId`, else `PLOT_SESSION_ID`, which is the order the prompt uses.
- `session_transcript_exists` moves into `plot-transcript-quiet.sh` as `plot_transcript_exists`, which both the loop (`:92`) and the monitor (`:254-256`) already source. The loop's `session_flag` calls it under the new name.
- **`plot_manifest_for_worktree` is not used.** It resolves `git rev-parse --show-toplevel` from the worktree (`plot-worker-state.sh:129-131`), which returns the DESK, not the main repository, and it ignores the `Agent registry` key. Measured on `free-c7b58b4f`: it names `.worktrees/free-c7b58b4f/.plot/agents`, which does not exist. Its comment is wrong, and that is filed as its own finding.
- `usage()` (`plot-worker-monitor.sh:175-187`) lists `PLOT_SESSION_ID` and `PLOT_MANIFEST_FILE`.
- **The probe is a seventh `monitor_*` port**, `monitor_conversation_spoken`, beside the six the monitor already defines (`monitor_pid_alive`, `monitor_pid`, `monitor_activity`, `monitor_transcript_quiet`, `monitor_tree_fingerprint`, `monitor_has_commits`, `plot-worker-monitor.sh:341-419`). It returns 0 when the handle's file exists, 1 when it does not, and 2 when there is no handle; `sample_verdict` answers `unspoken` on 1 only. A port is what lets `test/reconcile/workermonitor.test.mjs` stub it the way it stubs the other six.
- The probe runs only when the desk-wide number is past `PLOT_MONITOR_QUIET_SECONDS`. `manifest_resume_id` starts one `node` (about 35 ms), so a busy worker pays nothing and a quiet one pays one start per 30 s pass.

### A missing handle cannot disable the fix silently

A wrapper-started monitor always holds a handle: `PLOT_SESSION_ID` is set on every launch, and a pre-`resumeId` manifest falls back to it. **So the only monitor with no handle is one started by hand**, outside `start_worker`. That monitor behaves as today and writes one line to stderr at start: `plot-worker-monitor: no session handle (PLOT_SESSION_ID and PLOT_MANIFEST_FILE unset) — idle is judged on the desk alone`.

The fix is proved engaged, not assumed, in `test/e2e/worker-monitor-samples.test.mjs`, the suite whose subject is the monitor across the real `plot-dispatch.sh` wrapper. It runs one real dispatch twice over a desk whose other transcript is past a shortened `PLOT_MONITOR_QUIET_SECONDS`: with the handle's own file present and old, the monitor publishes `idle`; with it absent, the monitor publishes nothing. The pair shows the handle reached the monitor, because only the handle separates the two runs. A fixture that sets the variables by hand does not prove that the wrapper passes them. **This suite runs in CI (`pnpm run test:e2e`, `ci.yml:206`) and not locally**, per the repository's testing rule; the local proof is the unit suite below.

### The cost, and why no bound is added

**Until the conversation writes its first line, `idle` cannot fire, and only `Worker bound` (28 800 s) ends a worker in that state.** The runtime writes a line before its first model call, so the unbounded case is a prompt process that stays alive and never writes one line — not a slow model. This is accepted, and no bound is added.

- It is the cost the monitor already accepts for `unavailable` (`plot-worker-monitor.sh:487-493`: *"a genuinely stuck agent then holds a desk for up to 8 hours"*). A first slice on a fresh desk pays it today, because an absent or empty transcript directory reads as `unavailable`. This rule gives a hop the same answer a first start already gets.
- A prompt that exits without running is not covered by this path: the loop's start-attempt budget ends it and writes the `unstarted` ending (`plot-worker-loop.sh:2013-2021`).
- A bound on the file's absence across N passes is N × `PLOT_MONITOR_INTERVAL` seconds, which is the grace-period timer this plan refuses below.

### Out of scope, filed separately

- **A hop that creates a desk leaves the monitor on the old one.** When the reset is refused, the loop cuts `plot-wt-<suffix>` (`plot-worker-loop.sh:2233`, `:2247`), and the monitor's `worktree` is fixed at launch (`plot-worker-monitor.sh:212`). From then on the monitor reads the old desk's transcripts and commits. With this rule the old desk has no file for the new handle, so the monitor answers `unspoken` until `Worker bound`; today it can publish a false `idle`. The cause is a stale subject, not an unstarted conversation, and it is filed as #1085.
- **`plot_manifest_for_worktree` resolves to the desk**, as measured above. Two readers call it (`plot-worker-state.sh:779`, `:986`). It is filed as #1086.

### What this does NOT do

- **It does not change `plot_transcript_quiet_seconds`.** The reader still answers about the desk. The new function beside it answers about one conversation.
- **It does not add a grace period**, for the reasons in the cost section.
- **It does not touch `monitor_has_commits`.** If the sandbox finds that the reset fell through, that is a separate finding against `reset_desk`.
- **It does not change `gone`.** A dead pid is unaffected by whether its conversation started.

## Done when

- **A hop answers `unspoken`**: a desk that holds the previous slice's transcript, 3 000 s old, and a manifest whose `resumeId` names no file, answers `unspoken`, and two consecutive passes with an unchanged tree and commits present publish no finding.
- **The first line ends `unspoken`**: once `<resumeId>.jsonl` exists, the verdict is the desk-wide number again, and `idle` fires after two further quiet passes, as it does today.
- **The same-second tie reads as started**: a transcript file created in the same epoch second as the manifest rewrite answers a number, asserted with `touch -t`.
- **The correction case answers a number**: after `raise_manifest_corrections`, with the resumed conversation's file 1 200 s old, the monitor still reaches `idle` across two passes. This is the negative case that the manifest-mtime instrument failed.
- **The end-of-slice case answers a number**: after `clear_manifest_branch`, with the slice's file present, the answer is unchanged.
- **The operator-at-the-desk case is decided by the handle**: after the worker's own file exists, a newer file from another session sets the desk-wide number and reads as activity. Before the worker's own file exists, an operator's file written inside the window reads `busy` as today, and one written 1 000 s ago reads `unspoken`, not `quiet`. All three readings are asserted.
- **The fix engages through the real launch**, in `test/e2e/worker-monitor-samples.test.mjs`: a real dispatch publishes `idle` when the handle's file is present and old, and nothing when it is absent. It runs in CI, not locally. A hand-started monitor with no handle writes the stderr line above and behaves as today, asserted in the unit suite.
- **The loop and the monitor share one probe and one handle**: `session_flag` calls `plot_transcript_exists`, and both scripts call `session_handle` from `plot-agent-manifest.sh`. `grep -n 'session_transcript_exists\|^manifest_resume_id' skills/plot/scripts/plot-worker-loop.sh` returns 0 lines.
- **The ewz-leg reading is named.** A correctly reset desk returns `has_commits rc=1` and `idle` cannot fire, measured in round 1. So the desk either carried pushed work from an earlier attempt, or the reset fell through. The slice reproduces the shape in a sandbox, says which, and files the other.
- **One source file per script is changed.** `packages/board/plot-worker-monitor.sh` and `packages/board/plot-transcript-quiet.sh` are build outputs: `packages/board/build.mjs:961-966` copies them from `skills/plot/scripts/`, and `packages/board/.gitignore:22-24` ignores them. `plot-agent-manifest.sh` is already on the vendored list (`build.mjs:960`), so the monitor's new source line resolves in the npm layout. The slice edits `skills/plot/scripts/` and runs `pnpm build:board`.
- **The unit suite is insulated from the worker's own environment.** `drive()` in `test/reconcile/workermonitor.test.mjs:48` spreads `process.env`, and every dispatched worker carries `PLOT_SESSION_ID`, so a worker running the suite would give the monitor a handle with no file and turn 8 of 36 tests red. `drive()` sets `PLOT_SESSION_ID: ''` and `PLOT_MANIFEST_FILE: ''` after `...process.env` and before `...env`, so a test that wants a handle passes one. This covers the clearing test at `:305`, which builds its own ports and does not stub the new one.
- `node --test test/reconcile/workermonitor.test.mjs` stays green with `PLOT_SESSION_ID` unset and with it set. The path has no hyphen, and it runs 36 tests today.

## Slices

### An idle reading knows the conversation started (Branch: bug/an-idle-reading-knows-the-conversation-started, PR: #1097)

Move the handle and the transcript probe into the two shared helpers, add the `unspoken` verdict to the monitor, and reproduce the ewz-leg shape.

## Notes

**The two joins are now three questions, and the header should say so.** `plot-transcript-quiet.sh:36-41` already contrasts *is anything happening at this desk* (per worktree) with *what has THIS agent spent* (per session). This plan adds a third: *has this worker's conversation written* — per worktree, and per conversation handle, asked as a file's existence. It is neither of the first two, and a reader of that header should not have to derive it.

### Round 1, 2026-09-29

Two jurors, both **amend**, both **executed**. Verdicts: `.plot/panels/2026-09-29-an-idle-reading-knows-the-conversation-started/`.

**Both refuted the plan's instrument independently.** `.plot-worker.pid`'s mtime is the wrapper's launch and is never rewritten on a hop; 0 of 17 live transcripts predate their pid file, so the rule was inert on every desk on this machine — including the reused-desk case the plan was written about. One juror drove the full hop shape through two monitor passes and watched `idle` publish anyway.

**The design is rebuilt on the manifest's mtime**, which `update_manifest_on_hop` rewrites per slice, measured hours ahead of the pid file on all three live desks.

**The relationship to #1067 is reversed from what the plan claimed.** Today a hop `--resume`s one session id into one file, so there is no second file to be older and `unstarted` is unreachable. #1067 mints a fresh conversation per slice and makes the state reachable — it is a precondition, not a frequency reduction.

Also folded in: the ewz-leg commit reading is half-settled by measurement (a correctly reset desk refuses `idle`); the script has two byte-identical copies and the plan named one; and the test file is `workermonitor.test.mjs`, without the hyphen.

### Round 2, 2026-09-30

One juror, **amend**, **executed**. Verdict: `.plot/panels/2026-09-29-an-idle-reading-knows-the-conversation-started/round2.md`.

**The juror refuted the manifest-mtime instrument by measurement.** The manifest has seven writers, not one. Two of them rewrite it after the conversation has spoken: `raise_manifest_corrections` mid-slice, before the same conversation is resumed, and `clear_manifest_branch` at the end of the slice. A sandbox that drove the real functions read both cases as `unstarted`. `writeManifestStamp` in `continue.ts` is a seventh writer.

**The design is rebuilt on the juror's proposed rule**, verified here: the conversation has not spoken while no `<resumeId>.jsonl` exists, which is the probe `session_transcript_exists` already answers for the loop. The quiet number stays desk-wide.

Also changed: the word is `unspoken`, because `unstarted` is an `EndingReason`; the monitor reads `PLOT_SESSION_ID` and `PLOT_MANIFEST_FILE` from its inherited environment, because `plot_manifest_for_worktree` resolves to the desk; the "no manifest behaves as today" clause is replaced by an engagement test through the real launch environment; the cost of no bound is stated and accepted; the created-desk hop is scoped out as its own finding. **"Both copies of the script" was wrong**: the `packages/board/` copy is a gitignored build output of `build.mjs`, so the slice edits one file per script.

### Round 3, 2026-09-30

One juror, **amend**, **executed**. Verdict: `.plot/panels/2026-09-29-an-idle-reading-knows-the-conversation-started/round3.md`.

**The rule held when built.** The juror measured the runtime on Claude Code 2.1.285: `--session-id` creates `<id>.jsonl` and `--resume` appends to the same file. `PLOT_SESSION_ID` and `PLOT_MANIFEST_FILE` reach a monitor started the way `start_worker` starts it. A scratch build of the design passed every Done-when case against the real helper functions.

**Three corrections are folded in.** A worker's ambient `PLOT_SESSION_ID` turned 8 of 36 unit tests red, so `drive()` now blanks both variables and the probe is a seventh port. The runtime writes its first line before its first model call, so a cold model does not reach the defect and the unbounded cost is a process that writes no line. Two citations were wrong: the claim commit is `plot-worker-loop.sh:2277`, and `agent.ts:390` is under `packages/domain/src/transitions/`. The engagement test is named: `test/e2e/worker-monitor-samples.test.mjs`, which runs in CI.

### Round 4, 2026-09-30

One juror, **proceed**, **executed**. Verdict: `.plot/panels/2026-09-29-an-idle-reading-knows-the-conversation-started/round4.md`. Built as written: `workermonitor.test.mjs` passes 36/36 with `PLOT_SESSION_ID` unset and set, against 28/36 for the old `drive()` with the new monitor, the count the plan names. `workerloop.test.mjs` passes 36/36; one case failed once at load 22 and passed six times alone, on this branch and on `main`.

Three text fixes for the e2e bullet, for the implementer: the worker writes the handle's transcript file, not the test, because the handle is minted inside the launch (`plot_session_id`) and `staffDesk` returns through `plot-dispatch.sh --restart`; "publishes nothing" means no `idle`, since the monitor correctly publishes `gone` when the worker exits and the healthy-worker test already excludes `gone` (`:319`); and `PLOT_TRANSCRIPT_HOME` and `PLOT_MONITOR_QUIET_SECONDS` travel through `staffDesk`'s `env` and reach the monitor by inheritance, as `PLOT_MONITOR_INTERVAL` does.
