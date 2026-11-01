# Panel moderation — the-agent-reporter-starts-a-sleep

Subject: `docs/plans/2026-11-01-the-agent-reporter-starts-a-sleep.md` (Draft, plan PR #3025, issue #3024). Jurors: layering, safety, testability, seams. Round 1.

**Reconciled: unanimous amend.** All four verdicts name `Position: amend`, and each passed the gate.

## What each juror looked at

| Juror | Read | Ran |
|---|---|---|
| layering | `continuation.ts:1391-1399`, `reporterTail`, `start_worker`'s wrapper, `plot-monitor-subject.sh`, `check-shell-lines.sh`, the CI spawn and script ratchets | `scratchpad/jl/exp/probe.sh` on macOS `/bin/sh`: the outer shell opens the FIFO read-write and read-only before it forks, the command runs with the write end closed. Natural exit → `done rc=0`, ppid 1; `kill -9` to the recorded pid → `rc=137` while the command's `sleep 30` lived; group `SIGTERM` → `rc=143`, reporter alive. `git grep` of short polls over `skills` and `packages/*/src`; the CI spawn grep (11 lines, `continuation.ts:1391` not among them) |
| safety | `continuation.ts:1264-1399`, the e2e and unit guards, `.gitignore:63-74`, `start_worker` | `scratchpad/probe/probe.mjs` with `drive.sh` and `linux.sh`, on macOS `/bin/sh` and on `dash` in `debian:stable-slim`: natural exit, `exit 3`, instant exit, `SIGKILL` and group `SIGTERM` each wrote one finding with 4 starts per run. Failure modes: a reporter that keeps the write end survived `--stop` (pid 22140, ended by hand with `SIGKILL`); a command that keeps the write end delayed the finding 4 s and 6 s; `exec 4<` on a missing path ended the shell on both shells, and `{ ...; } < "$FIFO" || fallback` fell through. A `PATH` shim count: poll shape 11 starts at 2 s and 16 at 5 s, FIFO shape 4 in every case |
| testability | `git show --stat` of d4bc9b8fc, ad509c157, 6b0ac7188; `continue-route.test.ts:2699-2830`; the e2e monitor suites; `ci.yml:409`, `:704` | probes under `/bin/sh` and `/bin/dash`: with `3>&-` EOF in the same second as `kill -9`, without it `done=none` after 1.5 s; natural exit found the exit file already holding `0`; a `PATH` shim named `sleep` on the current loop, agent gated on a FIFO: 12 starts at 1 s and 37 at 3 s; dash execs a subshell's last command |
| seams | the plan's facts on `origin/main` (`c023c7c60`), open PRs, `continuation.test.ts`, `startMonitors`, every short poll in shipped shell and in node | `PATH` shims for `sleep`, `cat`, `tr`, `dirname` against a live pid for 5 s: 5, 5, 5 (the AgentMonitor, 3 per second); the same shim on the reporter: 8 `sleep` starts in 5 s at about 600 ms per start. `gh pr list --state open` for collisions: none |

Every juror ran a shell probe. Safety alone ran Linux `dash` in a container; testability ran macOS's `/bin/dash`. No juror ran the e2e suites, and no juror ran a probe through the real `continueOnDesk`.

The testability juror ran one `cd /private/tmp` against its brief's rule. The command changed nothing and its findings do not depend on it.

## What they agreed on

1. The held descriptor is the mechanism, in the `sh -c` string `continuation.ts` builds, with no new shipped script, no node reporter and no new spawn site.
2. The command runs with the write end closed (`( ${cmd} ) 3>&-`). Without it a `SIGKILL` finding waits for the command's last descendant.
3. The outer shell opens the FIFO before it forks either side. An open by path from each side deadlocks an agent that ends first.
4. The bounded builtin poll does not exist: `dash` has no `read -t` and no builtin `sleep`, and bash 3.2 has no `sleep` builtin. Requirement 4 refutes it.
5. The count comes from a `PATH` shim log over every external name, compared between two run lengths. A process-table sample measures load, and a `sleep`-only shim passes a loop that moves to another command.
6. `exec 3<>fifo` is not POSIX, so the proof runs on macOS `/bin/sh` and on Linux `dash`.
7. `start_worker` waits as the agent's parent and has no poll. The continuation path cannot copy it, because the recorded pid must have ppid 1.
8. The other short polls are bounded, operator-run or one-shot, and stay out.

## Where they differed, and what the plan took

- **The AgentMonitor loop.** Layering, testability and seams found `plot_monitor_wait` (`plot-monitor-subject.sh:193-203`, run from `plot-agent-monitor.sh:565`), which starts `sleep`, `cat` and `tr` once per second for every agent. Layering and testability required a named follow-up; seams offered a second slice or a filed issue. Safety's poll count did not name it. **The operator decided: slice 2 of this plan.** Seams' `read -r pid < "$pid_file"` is the mechanism; it removes 2 of 3 starts per second. The `sleep 1` nap stays, because no portable builtin wait exists and the monitor cannot share the reporter's FIFO without a new seam.
- **Whether slice 2 waits on slice 1.** The brief assumed both write `.plot-worker.monitor.worker.jsonl`. The moderator read `plot-agent-monitor.sh:144`: the AgentMonitor writes `.plot-worker.monitor.agent.jsonl`. The slices share no file. The reporter sources `plot_watched_desk` from `plot-monitor-subject.sh`, and slice 2 leaves that function unchanged; slice 1 leaves the pid file the AgentMonitor reads unchanged. **Taken: no wait.**
- **The FIFO's failure path.** Only safety proved that a failed open by `exec` ends the reporter before it writes, and required a non-fatal redirect on a block with a fallback. Layering's shape opens both ends with `exec` in the outer shell, which has the same fatal failure there. **Taken: safety.** The plan requires a non-fatal outer open and a 1 s `kill -0` fallback that runs only when the FIFO cannot be made or opened.
- **Where the FIFO lives and who removes it.** Layering removes it right after the open; safety has the reporter remove it after the read; testability has the controller remove a stale one before the spawn. **Taken: the worktree, with a `.gitignore` line; the controller removes a stale one and the reporter removes its own.**
- **Where the tests live.** Testability named `packages/board/test/unit/continue-route.test.ts`; seams named `packages/fleet/test/unit/continuation.test.ts`, which already holds `monitorLines` and the reporter case. **Taken: seams**, next to the code, with the board's ppid-1 test kept green.
- **The race-fix rows.** Testability alone traced the three commits and found that d4bc9b8fc shipped no test and the other two are held only by CI-only e2e suites. Its table (exit file before `kill -0` fails, `SIGKILL` 137, group `SIGTERM`, ppid 1, missing script dir, early death) is the plan's table. Layering added the 20-fold repetition; safety added the grandchild and failed-`mkfifo` rows.
- **Rates.** The plan stated 20 per second. Seams showed that under load each start is slower and the rate falls to about 5 per second, which the plan's own `ps` sample (49 in 10 s) already showed. **Taken: 20 per second is the idle ceiling.**

## Shared blind spots

- **Nobody proved the outer shell's open non-fatal.** Safety proved the reporter's block redirect on both shells. Every proven shape opens the FIFO in the outer shell with `exec`, which a failed `mkfifo` makes fatal before the agent starts. The plan names the condition; slice 1 must prove it on both shells.
- **Nobody ran the real `continueOnDesk`.** Every probe rebuilt the string by hand. The `sh -c` string and the `env` the controller passes were not run together; extracting the string into a function is what lets slice 1 do that.
- **Nobody measured slice 2's floor.** One `sleep` per second per agent remains after slice 2. No juror asked whether a wake-up from the agent's end is worth a seam. The plan records it as a follow-up.
- **All four lenses counted process starts on the operator's machine.** The `syspolicyd` cost per start is a macOS fact. The plan's motivation rests on it, and Linux CI cannot show it.

## Outcome

The plan is amended from this panel and records `- **Rounds:** 1`. `Type` is `bug`. Its slices are `bug/the-agent-reporter-waits-without-a-poll` and `bug/the-agent-monitor-reads-its-pid-with-a-builtin`, with no wait between them.
