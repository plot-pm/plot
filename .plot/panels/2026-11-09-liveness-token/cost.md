# Cost juror: liveness-token

Lens: does each slice remove the process starts it claims, measured against the census rows of CI run 42595561157, and what new costs does it add?

Position: amend

## Census check

- `census-report-head` (artifact 13664721538) records `"ps":42` for S4 GitHub 3 desks, S5 `"ps":21` and S6 `"ps":21`. Half of 42 is 21 per pass, so the plan's S4 figure holds. S4 GitHub 0 desks records no `ps`, so every `ps` in S4 comes from desk probes. Bitbucket 3 desks records `"ps":18`.
- The 21 per pass are not all start-time reads. `plot-worker-state.sh` runs `ps -o lstart=` (`:352`), `ps -o pid=,ppid=,time= -ax` (`:872`), `ps -o etime=` (`:988`) and `ps -o pid=,ppid=,comm= -ax` for the harness walk (`:1020`). The census names commands, not callers, so the share of `:352` is unmeasured.
- After `desk-probes-in-domain` slice 1, one `ps -A -o pid=,ppid=,lstart=,time=,comm=` per pass serves `pidIsCurrent` and `agentAlive` (its Done-when: "1 `ps` … per pass"). The token removes the `lstart` column only. Open Question 2 keeps the process-table walk for `orphaned`, so that one `ps` stays on every pass with a running desk.
- Result: the *Worker token* slice saves 0 `execve` per pass on top of `desk-probes-in-domain`. The Done-when row "S4 GitHub 3 desks: `ps` 0 per pass" fails as written, or it passes only if the slice silently drops the `orphaned` reading. The slice's value is correctness (a killed wrapper) and the Phase 8 trigger, not process count.

## Open Questions

1. fd 3 chain. Measure it, as the plan says. Extend the measurement to the harness's own children (the Bash tool's background jobs): libuv's `uv_spawn` dups only the stdio it is given, but an inherited fd without `FD_CLOEXEC` can still reach a grandchild. Every extra holder makes leftover (a) more frequent. The `lsof` run is test-time only and adds no idle cost.
2. `orphaned`. Keeping the walk keeps 1 `ps` per pass. Recommend a second token in this plan: the loop passes a second FIFO only to the harness spawn, and `orphaned` reads "loop token held, harness token released". That costs one more `mkfifo` per launch and removes the last per-pass `ps`. If a person defers it, restate the census target as `ps` at most 1 per pass.
3. `mkfifo` on a network filesystem. The rule 4 fallback is sufficient: it costs what `desk-probes-in-domain` already costs (the shared table). Require the wrapper to log one line when `mkfifo` fails, so a desk on the fallback is visible.
4. Dirt. `.plot-worker.*` covers the desk FIFO. `PLOT_TOOL_SCRATCH` (`plot-worker-state.sh:409`) excludes `plot/state`, so `.plot/state/*.fifo` is excluded in the shell; `deskDirtFilter` does not exist on this worktree yet (grep finds none in `packages/domain/src`), so the corpus test of `desk-probes-in-domain` must carry a FIFO row.
5. Reader FIFO path. Moot if the change below for the reader is taken: no reader FIFO is needed.
6. P1. P5 may replace it. Add a second row that measures what fleetd now spends on findings: `execve` per pass for 3 desks with no HEAD change must equal S4 at its merge base. Without it, the monitor slice can add per-pass `git` calls and no row sees them.

## Leftovers

- (a) Rule 2 never checks the pid. The plan does not handle it. Change rule 2 to: no exit record, token `held`, and `kill(recordedPid, 0)` answers → `live`; token `held` and the pid gone → a held-but-ended reading that a `Worker bound` deadline ends. Cost: one syscall and an in-process timer, no process. A reused pid cannot make the desk `live` on its own, because the token must also read `held`.
- (b) `mkfifo` per launch. Intended and cheap for workers: a dispatch is an action, so its one `execve` is outside the idle count. State it in the plan. The risk is in the *Locks* slice: "fleetd opens `.plot/state/reader.<connector>.fifo` at election", and `fleetPrs` elects before every PR beat. A `mkfifo` per election is one `execve` per beat on an idle fleet, which breaks S4's strict tolerance. If any FIFO stays in *Locks*, make it once per process lifetime and name that in the slice.

## Slice-by-slice cost

- *Worker token*: adds 1 `mkfifo` per launch, 1 FIFO file per desk, 1 `open`+`read` syscall per desk per pass. Removes 0 `execve` per pass after `desk-probes-in-domain` (see above). Fix the Done-when target.
- *Locks*, reader election: the plan targets the wrong `ps`. The election already runs no `ps`: `reader-lock-file.ts:434` passes `startedAt` `null`. The `ps` in `psLiveness` (`pr-reader.ts:98-121`) checks the BOARD followers' pids (`stillFollowed`, `:139-153`) on every `PR_REFRESH_MS` beat, and a token held by the reader cannot answer that. `stillFollowed` reads only `.alive` and never `startedAt`, and a fresh heartbeat already bounds pid reuse. Replace `psLiveness` with `process.kill(pid, 0)`: zero processes, no FIFO, no new file.
- *Locks*, implement lock: `heldImplementLock` has three callers, `dispatch-command.ts:135`, `brief-ask.ts:141` and `implement-run.ts:601`, all at action time. The plan's own argument for the continue lock ("an action is itself a trigger") applies here too. A token adds a `mkfifo` and a file per run to save one `ps` per action. Leave it on `ps` and name it beside the continue lock, or keep it only for the correctness case the lock record cannot cover.
- *Monitor in fleetd*: the saving is real (one long-lived `bash` per desk, and per desk every 300 s `git status`, `git rev-list`, `git diff` and one `plot-host.sh pr-state` with its `gh`/`bb`, `mktemp`, `jq` and `rm` starts). Two defects:
  - "from the readings `readDeskReadings` already takes" is false for two arms. `DeskReading` (`plan-walk-desks.ts:7-33`) holds marker, dirt and unpushed, but no commit count and no added-changeset list. If fleetd reads them per pass, it starts 2 `git` per desk every 5 s against the monitor's every 300 s, about 60 times as many. The branch stage already carries `commitsAhead` and `changedPaths` (`plan-walk-branches.ts:465-478`), so read those, and ask `git diff --diff-filter=A` only when a PR exists and the desk HEAD moved.
  - The PR index cannot answer "no PR": the plan says a missing row answers `unaskable`, so `owes a review`, the finding the final pass exists for, is never written. The Done-when row "commits and no PR row → `owes a review`" then fails. The branch stage already carries `pr` (`'none'` from a complete listing, `plan-walk-branches.ts:218-221`) and `prListComplete`, bought by `scanOnce` on the same pass. Read that: zero added host calls, and `none` is licensed only where the listing is complete.

## The one change that matters most

Restate the census claims so each slice names what it removes after its dependencies merge: the *Worker token* slice removes 0 `ps` per pass while `orphaned` keeps its walk, the reader's `ps` goes with `process.kill(pid, 0)` and not with a FIFO, and the monitor slice reads `pr`, `commitsAhead` and `changedPaths` from the branch stage that the pass already holds, not from the PR index or new per-pass `git` calls.
