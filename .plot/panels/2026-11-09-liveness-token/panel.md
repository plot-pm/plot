# Panel moderation — liveness-token

Subject: `docs/plans/2026-11-09-liveness-token.md`. Jurors: correctness, cost, operator. Round 1.

## Reconcile

```
$ printf 'committed\tcorrectness\tamend\ncommitted\tcost\tamend\ncommitted\toperator\tamend\n' | node skills/plot/scripts/board/plot-panel.mjs reconcile
unanimous	amend	correctness,cost,operator
```

The panel is unanimous on `amend`. The three jurors agree on the defects and disagree on four of the fixes (below).

## What each juror looked at

| Juror | Ran or measured | Read only |
|---|---|---|
| correctness | A macOS scratch test on Node v26.13.0: fd 3 passed through `spawn` `stdio[3]` stays in the child; a grandchild spawned with three `stdio` entries does not get it. A macOS FIFO read with `O_RDONLY\|O_NONBLOCK`: `EAGAIN` while a shell holds `exec 3<>fifo`, `0` after it exits. | `plot-worker-loop.sh:18`, `rules/implement-lock.ts`, `continuation.ts:1096-1105` (#1379), `fleet-clock.ts:202-222`, `plot-worker-state.sh:89`, `:1020` |
| cost | Read the `census-report-head` artifact 13664721538 of CI run 42595561157: S4 GitHub 3 desks `ps` 42 (21 per pass), S4 GitHub 0 desks no `ps`, Bitbucket 3 desks `ps` 18. | `plot-worker-state.sh:352`, `:872`, `:988`, `:1020`; `reader-lock-file.ts:434`; `pr-reader.ts:98-153`; the three `heldImplementLock` callers; `plan-walk-desks.ts`, `plan-walk-branches.ts` |
| operator | Nothing ran. | `continuation.ts:878`, `:1321-1328`; `plot-worker-state.sh:89`, `:1020`, `:1447`; `rules/agent-state.ts:136`; `plot-agent-monitor.sh:556-562` |

The moderator checked four claims against the code on `1b7f8ec6e`: `reader-lock-file.ts:428-434` passes `null` as the start time and runs no `ps`; `stillFollowed` (`pr-reader.ts:139-153`) calls `psLiveness` only for `board.<pid>` heartbeats and reads only `.alive`; `DeskReading` (`plan-walk-desks.ts`) holds no commit count and no changeset list, while `plan-walk-branches.ts:465-478` carries `commitsAhead` and `changedPaths` and `:372`/`:377` answer `'none'` only from a complete listing; `agentState` (`agent-state.ts:136`) returns `running` on `live` before any exit arm.

## Shared amendments (no juror contests them)

1. **The census target is wrong.** All three: the `orphaned` walk (`ps -o pid=,ppid=,comm= -ax`, `plot-worker-state.sh:1020`) stays, so S4 cannot read `ps` 0 per pass. The *Worker token* slice removes the `lstart` column, not a process. Restate the row as "no start-time read for a desk with a token; `ps` at most 1 per pass".
2. **Rule 2 needs the pid and a bound** (leftover a). All three: a stray child that keeps fd 3 holds the token with no end. Rule 2 must read `kill(recordedPid, 0)` too; `held` with no answering pid is a named reading (`holder-only` / `stray holder`) that starts no restart and releases no claim; `Worker bound` from the manifest's `startedAt` is a ceiling on `live`. One syscall, no process.
3. **`mkfifo` per launch is allowed** (leftover b). All three: a launch is a trigger. The plan must say so in *Census effect*. No `mkfifo` per election beat.
4. **The final pass contradicts itself.** All three: the design says a missing index row writes no `owes a review`, and the Done-when row expects `owes a review` with no PR row. The mechanism is contested (below).
5. **A restart must not inherit a stale token.** correctness (defect 3) and operator (leftover b): make the FIFO under a temporary name, open it, `rename` it over the token path, and only then remove the old exit record.
6. **A late exit record from the old wrapper** (correctness defect 4, #1379): rule 1 holds only for an exit record not older than the token.
7. **`mkfifo` failure leaves no file and a visible reason.** correctness: no partial path, a non-FIFO at the path reads rule 4. cost and operator: the wrapper logs the failure; operator adds `token: none (<reason>)` in the manifest.
8. **The FIFO is not dirt, by test.** All three: `PLOT_WORKER_RECORD` (`:89`) covers the desk FIFO; a test must prove `deskDirtFilter` agrees.
9. **A `dead` reading names its cause** (operator defect 2) and **the exit-versus-token order has one owner** (operator defect 3), with a corpus row for "exit record present, token held".
10. **P5 replaces P1 in the slice that deletes the script** (all three), and the census README names it. cost adds a row that holds fleetd's finding cost at S4's merge base.
11. **The reader election targets the wrong `ps`** (cost only, verified by the moderator). The election runs no `ps`; `psLiveness` reads board followers' pids, which a reader token cannot answer. `process.kill(pid, 0)` replaces it. This removes the reader FIFO, so correctness OQ 5 and operator OQ 5 (one FIFO path for two worktrees) no longer apply.
12. **`readDeskReadings` lacks two of the finding's inputs** (cost only, verified). Read `commitsAhead` and `changedPaths` from the branch stage the pass already holds, not from new per-pass `git` calls.

## Disagreements

1. **Who holds fd 3.** correctness: the loop passes fd 3 to the harness, because a loop killed alone (jetsam, OOM) with a live harness reads `released`, rule 3 answers `dead`, and a restart puts a second writer on the branch. operator: the loop holds fd 3 and passes it to no child (`3>&-` on every command it starts), so one holder answers and stray holders are rarer. cost: measure, and add a second token passed only to the harness. The disagreement is about which false answer is worse: a false `dead` with a live harness (correctness) or an unbounded false `live` from a stray holder (operator). Amendment 2 bounds the second, which weakens operator's reason, but no juror said so.
2. **The last `ps` per pass (`orphaned`).** cost: a second harness token answers `orphaned` and removes the walk. correctness and operator: run the walk only on a trigger, or accept 1 `ps` per pass. This couples to disagreement 1: if the harness holds the loop's token (correctness), a second token is needed to tell `orphaned` apart.
3. **The implement lock.** correctness: a token opened by the runner is not inherited by the agent (measured), so a runner killed alone releases the slug while the agent works; keep the agent and group arms of `implementLockHeld`, or pass the fd to the agent. cost: all three callers (`dispatch-command.ts:135`, `brief-ask.ts:141`, `implement-run.ts:601`) run at action time, so leave the lock on `ps`, as the plan leaves the continue lock. operator: silent.
4. **Where the final pass's "no PR" comes from.** correctness and operator: on the final pass only, ask the host once for the branch (`pr-state`); a final pass is a trigger. cost: read the branch stage's `pr: 'none'`, which `plan-walk-branches.ts:372`/`:377` give only from a complete listing, at zero host calls. cost's source is free but answers `unreadable` when the listing is incomplete; the host ask always answers but adds one call per agent end.

## Shared blind spot

All three lenses read the plan as "fleetd replaces the AgentMonitor". None asked **what writes findings when fleetd does not run**. Today `plot-dispatch.sh:1430-1431` starts `plot-agent-monitor.sh` per desk whatever runs above it, and `packages/board/src/server/findings.ts:12-14` states the reason: *"the failures these monitors catch happen on machines where nothing but the monitors is up."* `plot-dispatch-command.mjs` dispatches with no board and no fleetd. After the *Monitor in fleetd* slice, such a desk writes no finding and no final pass, and the board shows a clean desk for an agent that committed everything and opened no PR. The plan must say whether a fleetd-free dispatch is still supported, and what writes its findings.

A second gap, unverified: the three jurors discuss `mkfifo` that FAILS on a network filesystem. NFS can create a FIFO node, and the pipe then lives in each host's kernel; a reader on another host reads `released` (rule 3, `dead`) for a live agent. The plan's rule set has no check that the reader and the holder share a host.

## Leftovers for the person

1. **Who holds fd 3?** (a) the loop and the harness (correctness: no false `dead` when the loop dies alone); (b) the loop only, closed for every child (operator: one known holder); (c) the loop, plus a second token for the harness (cost).
2. **How does `orphaned` keep its answer?** (a) keep the process-table walk, 1 `ps` per pass (correctness, operator accept); (b) run the walk only on a trigger (correctness, operator); (c) a second token passed to the harness, 0 `ps` per pass (cost).
3. **The implement lock: token or `ps`?** (a) token, with the agent and group arms kept (correctness); (b) stay on `ps` as an action-time read, like the continue lock (cost).
4. **The final pass's "no PR": host or branch stage?** (a) one host `pr-state` per agent end (correctness, operator); (b) the branch stage's `pr: 'none'` from a complete listing, no host call (cost).
5. **A fleetd-free dispatch** (moderator, no juror): does it keep its findings? (a) the wrapper keeps a final pass of its own; (b) a desk with no fleetd writes no findings, and the board says so; (c) dispatch requires fleetd.
6. **Shared mounts** (moderator, no juror): does a desk on a network mount need a same-host check on the token, or does the plan state that desks live on a local filesystem?
7. **The board label for a desk with no token** (operator only): show "liveness by start time" on the board, or keep the board unchanged as the plan's *Board impact* states?
