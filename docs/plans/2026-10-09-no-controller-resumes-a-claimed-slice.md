# No controller resumes a claimed slice whose agent timed out

> An agent that ends on its time bound (exit 124) always leaves a `bound` ending, and the supervisor answers that ending as it answers `holding-work`: one fresh agent continues the claimed branch, and a second time-out asks a person.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #1420, #1409
- **Sprint:** the-release-train-fixes-what-it-found
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-10-09, jwloka, in-session
- **Started:** 2026-10-09, jwloka, `bug/a-working-desk-never-reads-free`
- **Started:** 2026-10-09, jwloka, `feature/a-time-out-writes-its-ending`
- **Started:** 2026-10-09, jwloka, `feature/a-time-out-writes-its-ending`

## Changelog

- An agent that runs out its time bound no longer strands its slice. The loop records a `bound` ending on every time-out, and the supervisor starts one fresh agent on the claimed branch to commit, check and push what the first agent left. A second time-out on the same slice asks a person through `WAITING ON YOU`.

<!-- Board impact: none to the plan format, template or docs/plans layout. The
     board's fleet row for a desk reads the ending through `/api/fleet`; a
     `bound` ending replaces `ending: null` there, and a desk that gets a fresh
     agent leaves "worker crashed — exited 124". -->

## Motivation

On 2026-10-09 the agent on `feature/the-fleet-package-exists` (plan `the-fleet-runs-without-the-board`) ended with exit 124 at 09:27. It left one unpushed commit (`dec27bb26`) and 50 uncommitted files at desk `.worktrees/free-1c9c57a0`, and it wrote no ending record. The board showed "worker crashed — exited 124" with "someone is on it". `/api/fleet` read `worker: failed`, `ending: null`.

The supervisor took no action. The master agent committed the tree as `888dc0e7d` and pushed it by hand. After that, every controller refused or did nothing:

| Controller | Answer | Why |
|---|---|---|
| `POST /api/dispatch` | `dispatched=0 skipped=0` | the slice reads as claimed |
| `POST /api/continue` | `no-question` | it needs an unanswered `PLOT-BLOCKED` marker |
| `releaseClaim` | not called | it deletes the claim ref, and a fresh dispatch would then start from the default branch instead of the pushed work |

Two gaps combine here:

1. **The ending was written, and its cause is already fixed.** The desk of `feature/the-fleet-package-exists` (`.worktrees/free-1c9c57a0`) holds `.plot-worker.ending.json` with `reason: quiet`, `actor: monitor`; the loop exited 124 at 08:49:30Z (10:49 local). Measured on `feature/a-time-out-writes-its-ending` (2026-10-09): that exit came from the idle watch (`worker-loop.ts:1737-1741`), which `bug/a-working-desk-never-reads-free` (#1429, merged) already fixed by counting a session's subagent transcripts. Every exit-124 path left in the loop today already writes an ending through `agentLoop` before returning 124 — row 5 (`quiet`/`monitor`) and row 6 (`bound`/`unreadable`, actor `bound`) for the command runner at `worker-loop.ts:1737-1760`, row 9a (`bound`) for the SDK runner, row 3 (`unregistered`) for a gone manifest. A path that is killed by `Worker bound` is caught by `result.value.timedOut` before its exit status is ever read (`bounded-run-process.ts`), so it cannot be misread as `unstarted`; a SIGKILL or machine sleep still leaves no ending, and that stays correct — absent is absent. 135 `agent-loop` tests and 189 `worker-loop` tests already assert `bound`/`quiet`/`unreadable` are written with the held branch, actor and reason, and pass unmodified today. There was nothing left to build on this branch beyond this correction.
2. **A `bound` ending answers `leave`.** `endingAction` (`packages/domain/src/rules/ending-action.ts:101-104`) lists `bound` among the reasons with no row. So even with the ending written, the supervisor does nothing and the slice stays claimed with nobody on it.

`every-loop-ending-has-a-supervisor-rule` set the rule that no ending leaves a slice claimed with nobody working on it, and #1384 gave `holding-work` after a prompt a fresh agent. A time-out is the same situation — work on a desk, an agent gone — reached through a different exit. #1409 is the same family: a desk's loop reads itself free while its branch waits on checks.

## Design

### Approach

**Slice 1: every time-out leaves an ending.** The slice first reproduces the 09:27 case and names the exit path that wrote `124` to `.plot-worker.exit` without an ending file. Then it makes that path write the ending through `agentLoop`, as row 6 already does for the run's own bound. The ending reason is `bound`, or `unreadable` where no transcript exists, and the actor is `bound`. A worker that a signal kills outright (SIGKILL) still leaves no ending; "absent is absent" in `plot-worker-state.sh` stays true, and this plan does not read an exit code of 124 as an ending.

**Slice 2: `bound` gets a row in `endingAction`.** The row follows the `holding-work`-after-a-prompt row:

| Ending | Branch holds | Action |
|---|---|---|
| `bound` or `unreadable`, first on this slice | a commit beyond the claim, an open PR, or a dirty tree | `start-fresh`: one fresh agent on the same desk, told to commit, check and push the held work, then continue the slice |
| `bound` or `unreadable`, first on this slice | nothing beyond the claim | `release-claim`, as `nothing-done` does |
| `bound` or `unreadable`, after a fresh session | anything | `needs-a-person`, through the `PLOT-BLOCKED.md` marker and `questionEscalation` |

`bound` joins the set that shares one fresh session per slice (`FRESH_SESSION_ENDINGS` plus after-prompt `holding-work`), so a slice that times out, gets a fresh agent, and then ends `holding-work` asks a person instead of starting a third agent. The fresh start goes through the same registry path that `a-fresh-start-has-its-question` (#1388) fixed for `turn-limit`, so `continueOnDesk` does not refuse it `no-question`.

The rule stays pure: it reads the ending, the branch readings and the fresh-session count, and reads no disk.

### Open Questions

- [x] Which process wrote exit 124 at 09:27 without an ending? — *answered 2026-10-09 from the desk files of `feature/the-fleet-package-exists` (`.worktrees/free-1c9c57a0`):* the idle watch ended the agent, not the free-wait bound. `.plot-worker.ending.json` holds `reason: quiet`, `actor: monitor`, which `agent-loop.ts:609-611` writes through `ran.ended === 'idle'` at `worker-loop.ts:1737-1741`; the bound path at `:1610` writes no ending. `transcript-fs.ts:57` reads the modification times of the `*.jsonl` files directly in the desk's transcript directory and skips `<session>/subagents/`. The main transcript last wrote at 06:51:36Z when it started a subagent; the subagent transcript wrote until 08:43:23Z; the loop exited 124 at 08:49:30Z. The `free on ?` lines and the monitor's `branch: ""` are launch labels of a free-started agent (`worker-loop.ts:1594`, `plot-agent-monitor.sh:122`) and not a blank assignment. The first slice removes this cause; the two slices after it are the fallback for any other time-out.
- [ ] Should a fresh agent after a time-out get a shorter or longer bound than the first? This plan keeps `Worker bound` (28800 s) unchanged.
- [ ] Should `unreadable` share the `bound` row? This plan says yes, because the work on the desk is the same; an `unreadable` ending only says no transcript explained the time-out.

## Slices

### A working desk never reads free

- `bug/a-working-desk-never-reads-free` — the idle watch counts the newest transcript under `<session>/subagents/` as well as the session's own, so an agent whose subagent works is never read idle and never ended with 124; reproduce the 2026-10-09 case on `feature/the-fleet-package-exists` first → #1429 <!-- builds: subagent transcripts in the idle reading -->

### A time-out writes its ending

- `feature/a-time-out-writes-its-ending` — reproduce the exit-124-without-an-ending case from 2026-10-09 and route that exit path through `agentLoop` so it writes a `bound` or `unreadable` ending → #1431 <!-- builds: the bound ending on every time-out exit path of the worker loop -->

### A timed-out slice gets a fresh agent

- `feature/a-timed-out-slice-gets-a-fresh-agent` — the `bound` and `unreadable` rows of `endingAction`, their share of the one fresh session per slice, and the registry tick that starts the fresh agent or writes the marker <!-- builds: the bound rows of endingAction -->

## Done when

Each test below fails on `origin/main` (`3d45ebd2a`) today:

- The worker loop: every exit-124 path (idle watch, run bound, SDK run bound) already writes an ending file with reason `quiet`/`bound`/`unreadable` and the matching actor before returning 124 — measured on `feature/a-time-out-writes-its-ending`, with 135 `agent-loop` and 189 `worker-loop` tests passing unmodified; no board field named `ending` exists to read, and `deskEnding`/`readEnding` (`continuation.ts`, `registryd.ts`) already read the file fresh, unfiltered by reason or branch.
- `endingAction`: a first `bound` ending on a branch with a commit beyond the claim answers `start-fresh`; with a dirty tree and no commit it answers `start-fresh`; with nothing beyond the claim it answers `release-claim`; after one fresh session it answers `needs-a-person`; a desk a manifest names answers `leave`.
- The registry tick: a `bound` ending starts one fresh agent whose answer names the held files, and `continueOnDesk` does not refuse it `no-question`.
- `node skills/plot/scripts/board/plot-local-checks.mjs` and the commands it prints pass on each branch.

## Notes

**Created unattended, 2026-10-09**, from issue #1420. Ceremony follows this repo's practice for issue plans: `in-session` review, `own branches`, plan committed to `main`. Type `feature` came from the prompt.

- Overlapping plans: `every-loop-ending-has-a-supervisor-rule` (Released, v2.24.1) built `endingAction` and lists `bound` among the reasons that answer `leave`; this plan adds the row it left open. `a-blocked-agent-s-question-has` (Released) built the continue route a fresh start uses. No Draft or Approved plan overlaps the title.
- Deliverable search, 2026-10-09: `endingAction` (`packages/domain/src/rules/ending-action.ts`) and its registry caller (`packages/fleet/src/server/entry/registryd.ts:844-975`) are the code slice 2 extends, not duplicates. `agentLoop` row 6 (`agent-loop.ts:617`) already writes `bound` for one exit path; slice 1 extends it to the path that missed it. No `bound` row exists in `endingAction`.
- #1409 (a desk's loop reads itself free while its branch waits on checks) reports the same launch labels (`free on ?`, `branch: ""`). Its desk, log and transcripts are gone, so its exit path cannot be measured; the 2026-10-09 case is the reproduced one.
- 2026-10-09, jwloka, in-session: the root-cause slice *A working desk never reads free* comes first; the ending and the fresh agent stay as the fallback. Type `bug`, not the `feature` the idea controller wrote (#1419).
