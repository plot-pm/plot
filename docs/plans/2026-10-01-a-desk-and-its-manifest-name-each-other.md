# A desk and its manifest name each other

> The manifest's `worktree` field is the one join between an agent and its desk. Four readers make that join in four ways, the worker monitors never re-read it after a hop, and `/api/continue` starts a loop that carries no manifest at all. One domain rule makes the join, and every reader asks it.

## Status

- **State:** Delivered
- **Approved:** 2026-10-02, jwloka, in-session
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1085, #1086, #1101
- **Review:** in-session
- **Impl:** own branches
- **Started:** 2026-10-02, Jan Wloka, `bug/the-join-is-one-rule`
- **Started:** 2026-10-02, Jan Wloka, `bug/the-monitor-follows-the-hop`
- **Started:** 2026-10-03, Jan Wloka, `bug/a-continued-loop-carries-its-manifest`
- **Started:** 2026-10-03, Jan Wloka, `bug/a-desk-with-no-manifest-says-so`
- **Delivered:** 2026-10-03

## Changelog

- The AgentMonitor, the BuildMonitor and the wrapper's `gone` line follow their agent to a new desk after a hop, so their findings are about, and land in, the desk the agent works in.
- The worker-state reading finds a desk's manifest from inside a dispatched desk and under a configured `Agent registry`.
- `/api/continue` starts a loop that knows its manifest and refuses a desk no manifest names; a loop whose manifest is gone ends its wait instead of holding the desk for eight hours.
- A board row for a desk no manifest names says so, and no longer labels it with the branch the desk has checked out.

## Motivation

The three issues are one defect seen from three readers: the join from a desk to the manifest that names it, and back.

- **#1086, desk to manifest in shell.** `plot_manifest_for_worktree` lives in `skills/plot/scripts/plot-worker-state.sh:121`, not in `plot-agent-manifest.sh` as the issue says. It derives the directory as `git -C "$wt" rev-parse --show-toplevel`/.plot/agents (`:132`). From a desk, `--show-toplevel` answers the desk, and the comment at `:129-131` claims the opposite. It also ignores the `Agent registry` key. Its callers are `plot_worker_state` (`:801`) and the liveness reading (`:1008`); the issue's `:779` and `:986` have moved. `plot-worker-monitor.sh:265-267` already avoids the function and names #1086 as the reason.
- **#1085, manifest to desk after a hop.** When `reset_desk` fails, or the desk holds work, the loop cuts `plot-wt-<suffix>` (`plot-worker-loop.sh:2229-2231`, `:2243-2245`), writes the new desk into the manifest (`:2307`) and exports it (`:2315`). The wrapper started all three monitors once, with `PLOT_WORKTREE` fixed at launch (`plot-dispatch.sh:1487`, `:1502`). Each monitor copies it once: `plot-worker-monitor.sh:217`, `plot-agent-monitor.sh:119`, `plot-build-monitor.sh:127`. So after the hop the WorkerMonitor reads the old desk's transcripts and commits and writes its findings into the old desk (`plot-worker-monitor.sh:238`), while the loop reads findings from the new desk (`plot-worker-loop.sh:1465`). The loop's `idle` watcher can then never fire. #1074's comment measured the false `has-commits` this gives.
- **#1101, a loop with no manifest.** `/api/continue` spawns the `Worker command` with `PLOT_BRANCH`, `PLOT_WORKTREE` and `PLOT_EXIT_FILE` and nothing else (`packages/board/src/server/continue.ts:525-530`). It finds the manifest only to stamp it, and runs regardless when none names the desk (`:548-573`). A continued loop therefore has no `PLOT_MANIFEST_FILE`, so `assigned_branch` (`plot-worker-loop.sh:623-636`) never answers and the loop waits out `Worker bound`, logging *free on ?* — the exact line #1101 measured on `free-c7b58b4f`. The route also leaves the previous dispatch's `.plot-worker.wrapper.pid` on the desk while it starts no wrapper. `plot_worker_state` treats that file as proof of a wrapper (`plot-worker-state.sh:881`) and reads a waiting loop with no agent beneath it as finished (`:885-894`). That is #1101's comment: `--stop` answered *not running (finished 29948)* while 29948 ran.
- **#1101, the row.** `synthesizeEntry` sets `branch: wt.branch` (`packages/board/src/server/registry.ts:876-895`), so a desk no manifest names reads as an agent on that branch.

The join itself has four implementations today, and they disagree:

| Reader | Directory | Path match |
|---|---|---|
| `plot_manifest_for_worktree`, `plot-worker-state.sh:121` | desk's `--show-toplevel`, key ignored | path or realpath |
| `manifestForWorktree`, `manifest-stamp.ts:201` | `resolveManifestDir` from the main checkout | path or realpath |
| registry claimed set, `registry.ts:811-833` | `resolveManifestDirAsync` | path or realpath |
| supervisor `registered`, `supervisor.ts:151-156` | the registry's entries | path only |

## Design

### Approach

**One rule makes the join.** `packages/domain/src/rules/desk-manifest.ts` exports:

- `manifestDirectory({ mainCheckout, configured })` — the absolute directory: `configured` when absolute, else joined to `mainCheckout`, and `.plot/agents` when `configured` is empty. It replaces `joinManifestDir` (`registry.ts:417`), which keeps no second answer.
- `deskManifest({ desk, deskReal, manifests })` — `manifests` are `{ path, worktree }` readings. It answers `{ kind: 'named', path }` when exactly one manifest names `desk` or `deskReal`, `{ kind: 'unnamed' }` when none does, and `{ kind: 'several', paths }` when more than one does. `several` is a separate answer because two agents on one desk is an estate defect, and the first match would hide it. Callers read `several` as "no manifest" and name it.
- `watchedDesk({ launched, manifestWorktree })` — the desk a monitor reads: the manifest's `worktree` when it is non-empty, else `launched`.
- `loopRegistration({ manifestFile, exists })` — `registered`, `unset` (no `PLOT_MANIFEST_FILE`) or `gone` (the file was named and is absent).
- `unnamedDeskLabel({ checkout, live })` — the words a row shows for a desk no manifest names: it names the absence and the process state, and carries the checkout only as a separate field.

Each export has 100% branch coverage in `packages/domain/test/`.

**The shell keeps a declared duplicate, with a corpus test.** `plot_manifest_for_worktree` runs per worktree per fleet-scan pass, and the monitor's re-read runs every 30 s per agent. Per *A Shell Script Asks The Domain*, both are per-pass costs, so this plan chooses a declared shell duplicate over a bundle call. `packages/domain/corpus/desk-manifest.corpus.test.ts` drives the real shell functions and the rule over the same fixtures (path match, realpath match, none, several, configured absolute and relative directory, a call from inside a desk) and names both answers on a disagreement. No new `plot-*.sh` script is added: the shell side stays inside `plot-worker-state.sh`, the two remaining monitors, the wrapper in `plot-dispatch.sh` and `plot-worker-loop.sh`.

**The shell resolves the main checkout through `--git-common-dir`**, the reading `plot_repo_root` in `plot-desk-root.sh:38-46` already makes, and reads `Agent registry` through `plot-config.sh` once per process, cached in `PLOT_MANIFEST_DIR`.

**The monitors re-read the manifest each pass.** `docs/plans/2026-10-01-idle-is-read-from-what-the-desk-recorded.md` (#1041) removes `plot-worker-monitor.sh` in its slice `bug/the-loop-reports-idle`: the loop's watcher subshell judges `idle` and the wrapper appends `gone` or `clear` after `wait "$agent"`. The watcher runs inside the loop, which exports the new desk as `PLOT_WORKTREE` after a hop (`plot-worker-loop.sh:2315`), so its findings follow the hop without this plan. The AgentMonitor and the BuildMonitor remain, and each copies `PLOT_WORKTREE` once (`plot-agent-monitor.sh:119`, `plot-build-monitor.sh:127`). The wrapper's `gone` and `clear` lines go to the launch desk, because the wrapper's `PLOT_WORKTREE` is fixed at launch. The wrapper already exports `PLOT_MANIFEST_FILE` to the monitors (`plot-dispatch.sh:1494`). Each pass, the AgentMonitor and the BuildMonitor read the manifest's `worktree` and apply `watchedDesk`, and their findings files follow the watched desk. The wrapper applies `watchedDesk` once, after `wait "$agent"` returns, and appends its line to the watched desk's `.plot-worker.monitor.worker.jsonl`, the file the loop's watcher writes. `PLOT_PID_FILE` and `PLOT_EXIT_FILE` stay at the launch desk, because the wrapper writes the agent pid and exit status there.

**`/api/continue` carries the manifest or refuses.** The route asks `deskManifest`. On `named` it passes `PLOT_MANIFEST_FILE` in the spawn environment. On `unnamed` or `several` it refuses with a sentence that names the desk and the answer, and starts nothing. It removes `.plot-worker.wrapper.pid` before the spawn, because it starts no wrapper and the file would claim one.

**The loop ends a wait whose manifest is gone.** Inside `wait_for_work`, `loopRegistration` answering `gone` ends the wait with a `write_ending` reason `unregistered`, and the log line names the manifest path. `unset` keeps today's behaviour, because a hand-started loop is a supported shape.

**The registry, the stamp and the supervisor ask the rule.** `registry.ts` builds its claimed set from `deskManifest`, `manifestForWorktree` becomes a reader that collects `{ path, worktree }` and asks the rule, and `supervisor.ts:151-156` matches realpaths through the same rule. A synthesized row carries `branch: ''`, `checkout: wt.branch` and the label from `unnamedDeskLabel`.

### What this does NOT do

- It does not find what removed the two manifests in #1101. The candidates are the board's Drop (`drop.ts:278-280`) and the reaper; neither is shown to fire on a live desk.
- It does not stop an orphaned loop. The supervisor decides and performs nothing, and a stop needs a person.
- It does not move the agent's pid file after a hop.

### Open Points

- [ ] Should the supervisor also name a LIVE loop on a desk no manifest names as its own finding? `isUnclaimedTree` (`rules/unclaimed.ts:72`) is silent for both #1101 desks because a plan names their branches. This plan leaves that finding out; #1101's first expectation is met by slices 3 and 4.
- [ ] `several` is refused everywhere. If a measured estate shows a legitimate two-manifest desk, the answer needs a tie-break rather than a refusal.

## Slices

### The join is one rule (Branch: bug/the-join-is-one-rule, PR: #1170) <!-- builds: deskManifest, the desk-to-manifest join -->

`rules/desk-manifest.ts` (`manifestDirectory`, `deskManifest`) with unit tests; `plot_manifest_for_worktree` resolves through `--git-common-dir` and `Agent registry`; the corpus test; `registry.ts`, `manifest-stamp.ts` and `supervisor.ts` ask the rule; `joinManifestDir` removed; an `@plot-pm/board` patch and a `plot` patch changeset. Answers #1086.

Tests that fail on origin/main: a contract case in `test/reconcile/workerstate.test.mjs` sources `plot-worker-state.sh` from inside a linked worktree whose manifest sits in the main checkout's `.plot/agents/`, with `PLOT_MANIFEST_DIR` unset, and asserts `plot_manifest_for_worktree` prints that manifest; a second case sets `Agent registry` to an absolute directory and asserts the same; a `supervisor` unit case registers a desk by its symlinked path and asserts the real path reads `registered: true`.

### The monitor follows the hop (Branch: bug/the-monitor-follows-the-hop, PR: #1234) <!-- builds: watchedDesk, the monitor's per-pass desk --> <!-- waits: bug/the-join-is-one-rule --> <!-- waits: bug/the-loop-reports-idle -->

`watchedDesk` in `rules/desk-manifest.ts` with unit tests; `plot-agent-monitor.sh` and `plot-build-monitor.sh` re-read the manifest's `worktree` each pass and move their findings files with it; the wrapper in `plot-dispatch.sh` appends its `gone` or `clear` line to the watched desk; a corpus row for `watchedDesk`; a `plot` patch changeset. The slice builds on #1041's `bug/the-loop-reports-idle`, which removes `plot-worker-monitor.sh` and moves `idle` into the loop's watcher and `gone` into the wrapper; it does not edit `plot-worker-monitor.sh`. Answers #1085.

Tests that fail on origin/main: a contract case in `test/reconcile/` starts the BuildMonitor with `--once` on desk A, rewrites the manifest's `worktree` to desk B, runs `--once` again, and asserts the finding names desk B and lands in B's findings file, and a second case does the same for the AgentMonitor; a `workerloop.test.mjs` case drives the create path of the hop (`reset_desk` refused at step 1, #1085's third row) and asserts the loop's watcher publishes `idle` into the new desk's `.plot-worker.monitor.worker.jsonl`, which locks in what #1041 gives; a dispatch contract case hops an agent and lets it exit 124, and asserts the `gone` line lands in the new desk's `.plot-worker.monitor.worker.jsonl`.

### A continued loop carries its manifest (Branch: bug/a-continued-loop-carries-its-manifest, PR: #1256) <!-- builds: loopRegistration, the continue refusal --> <!-- waits: bug/the-join-is-one-rule -->

`loopRegistration` in `rules/desk-manifest.ts` with unit tests; `continue.ts` asks `deskManifest`, passes `PLOT_MANIFEST_FILE`, refuses `unnamed` and `several`, and removes a stale `.plot-worker.wrapper.pid`; `wait_for_work` in `plot-worker-loop.sh` ends on `gone` with the ending `unregistered`; a corpus row for `loopRegistration`; `@plot-pm/board` and `plot` patch changesets. Answers #1101's loop half.

Tests that fail on origin/main: a `continue-route.test.ts` case asserts the spawn environment carries `PLOT_MANIFEST_FILE` for a desk a manifest names; a second asserts a 409 that names the desk when no manifest names it; a third asserts the desk's `.plot-worker.wrapper.pid` is gone after a continuation; a `workerloop.test.mjs` case deletes the manifest during the wait and asserts the loop exits within two polls with `.plot-worker.ending` naming `unregistered`.

### A desk with no manifest says so (Branch: bug/a-desk-with-no-manifest-says-so, PR: #1261) <!-- builds: unnamedDeskLabel, the unregistered row label --> <!-- waits: bug/the-join-is-one-rule -->

`unnamedDeskLabel` in `rules/desk-manifest.ts` with unit tests; `synthesizeEntry` sets `branch: ''` and a `checkout` field; `AgentEntrySchema` gains `checkout`; the registry row renders the label; an `@plot-pm/board` patch changeset. Answers #1101's row half.

Tests that fail on origin/main: a `registry.test.ts` case lists a worktree no manifest names on `bug/x` and asserts the entry's `branch` is `''` and `checkout` is `bug/x`; a browser test asserts the synthesized row does not show `bug/x` as its branch and shows the label.

Slices 2, 3 and 4 each wait on slice 1, because each adds an export to `rules/desk-manifest.ts` and slices 1 and 4 both edit `registry.ts`. Slice 2 also waits on `bug/the-loop-reports-idle` from #1041's plan, because that slice removes `plot-worker-monitor.sh` and rewrites the wrapper line in `plot-dispatch.sh` that slice 2 edits. Slices 2, 3 and 4 do not wait on each other.

## Done when

- Every test listed under the four slices fails on origin/main and passes on its branch.
- `rules/desk-manifest.ts` holds 100% branch coverage, and `desk-manifest.corpus.test.ts` shows the shell and the rule agree on every fixture.
- `grep -n 'show-toplevel' skills/plot/scripts/plot-worker-state.sh` finds no manifest-directory derivation.
- `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` and `pnpm run typecheck` pass.

## Notes

- One plan, because the three issues share one mechanism: the `worktree` field of a manifest, read from the desk side (#1086, #1101's row), from the manifest side (#1085), and not passed at all (#1101's loop).
- Measured cases: `free-c7b58b4f` and `free-a8d68976` (2026-09-30, #1101); #1074's comment on #1085 (four `reset_desk` shapes).
- #1085's hop case for the `idle` finding is covered by `docs/plans/2026-10-01-idle-is-read-from-what-the-desk-recorded.md`, slice `bug/the-loop-reports-idle`: the loop's watcher judges `idle` and reads the desk the loop exports after a hop. That plan does not cover the AgentMonitor, the BuildMonitor or the wrapper's `gone` line, so slice 2 keeps those and waits on it.
