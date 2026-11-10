# Correctness juror — liveness-token

Lens: where the plan can go wrong silently (false `live`, false `gone`, a lost partial answer, a drifting duplicate, a race between two writers).

Position: amend

## Measurements made for this verdict

- macOS, Node v26.13.0, scratch test: a node process that receives fd 3 through `spawn` `stdio[3]` keeps it; a child that this node process spawns with a three-entry `stdio` does NOT have fd 3. Node closes non-stdio descriptors at `spawn`. So the harness (`claude`) and everything it starts do not hold the token unless the loop passes fd 3 on explicitly.
- macOS FIFO, Node `openSync(O_RDONLY|O_NONBLOCK)` then `readSync`: `EAGAIN` while a shell holds `exec 3<>fifo`; `0` after it exits. The plan's three readings are correct on macOS.
- `plot-worker-loop.sh:18` is `exec node "$bundle"`, so the chain is `sh -c <Worker command>` → (same pid) node loop. Holders are that `sh` and the node loop, nothing else.

## Open Questions

1. Fd 3 chain: the measurement above confirms the expected chain on macOS. The token answers "the loop lives", not "the harness lives". This is a correctness gap, not only a wording question: if the node loop dies alone (jetsam/OOM kills one process, not a group), the harness keeps writing to the branch, the token reads `released`, rule 3 answers `dead`, and a restart puts two writers on one branch. That is the exact failure the story's Phase 6 names. Recommend: the loop passes fd 3 to the harness in its `spawn` `stdio`, so the harness holds the token; then handle the stray-holder case with leftover (a)'s fix below. The Linux `lsof` measurement stays in the slice.
2. `orphaned`: keep the walk, but this contradicts the census claim. `orphaned` comes from `ps -o pid=,ppid=,comm= -ax` (`plot-worker-state.sh:1020`) per running desk. While that walk runs per pass, S4 cannot read `ps 0 per pass`. Recommend: either run the walk only on a trigger (log stops growing past `Slice idle after`), or change the Done-when row to "the start-time `ps` is 0; the process-table walk for `orphaned` stays at 1 per pass". Do not let a slice drop `orphaned` to meet the number (four agents ended orphaned on 2026-09-11, `rules/agent-state.ts` doc).
3. `mkfifo` failure: the rule-4 fallback is enough, on one condition: the wrapper must write no FIFO path and no partial token when `mkfifo` fails, so the reader gets `ENOENT` and not a regular file. A regular file at the path must read as "no token" (rule 4), not as `released`. Add a test that a non-FIFO at the path reads rule 4.
4. Dirt: `PLOT_WORKER_RECORD='\.plot-worker\.'` (`plot-worker-state.sh:89`) matches `.plot-worker.token.fifo`; confirm. `.plot/state/` is under the main checkout, not a desk, so it is not desk dirt; confirm in `deskDirtFilter` by test, not by reading.
5. Reader FIFO path: the path must come from the same common-dir resolution the reader lock uses, in one function; two path computations drift. A test with two linked worktrees must open one inode.
6. P1 → P5: accept P5, with P1 retired in the same slice that deletes the script, so no commit has neither row.

## Leftovers

(a) Rule 2 never checks the pid — the plan does not handle it, and the input `pidAnswers` is in the signature but no rule reads it. With fd 3 passed to the harness (OQ 1), the stray-holder case becomes more likely: a dev server or `node --watch` that the agent starts from a tool call inherits fd 3 and holds the token for hours. Change rule 2: `held` and the recorded pid answers `kill(pid, 0)` → `live`; `held` and the pid does not answer → a new reading (for example `holder-only`) that starts no restart and releases no claim, and that turns `dead` when `Worker bound` from the manifest's `startedAt` passes. Both inputs are syscalls or file reads; no process. Add a Done-when row: wrapper `SIGKILL`ed, loop exits, a background child keeps fd 3 → the desk reads `holder-only`, then `dead` at the bound, and no restart starts before the bound. The bound is the property that matters: today the plan gives a false `live` with no end.

(b) `mkfifo` per launch: intended and allowed. A launch is a trigger (story, *Re-ask before acting*: "An action is itself a trigger"), and `node-worker-wrapper` already counts `node`, `sh -c` and `ps` ×2 per launch. The plan must say so in Census effect, and must say that the two `ps` per launch go, so a launch has net one fewer process. One caution: the PR-reader token must call `mkfifo` only when a process first wins the election, never on a renewal. `fleetPrs` elects before every PR beat (`fleet-clock.ts:202-222`) and a renewal also reads `elected`; a `mkfifo` per beat adds an `execve` to every pass.

## What would fail or ship a wrong answer

1. Implement lock goes false-released. `implementLockHeld` (`rules/implement-lock.ts`) holds through three arms: the runner pid, the agent pid, and the process group. The plan's token is opened by "a long-lived node process", and Node does not pass it to the agent (measured above). If the runner dies and the agent lives, the token reads `released` and a second implement run takes the slug. Keep the agent and group arms, or pass the fd to the agent. Add a Done-when row: runner `SIGKILL`ed, agent alive → the slug stays held.
2. The Monitor slice contradicts itself. Design: "an index with no row for the branch answers `unaskable` and writes no `owes a review`". Done-when: "an agent exits 0 with commits and no PR row; fleetd writes `owes a review` within one pass". Both cannot pass. The final pass is a trigger, so it may ask the host once for that branch (in-process or `plot-host.sh pr-state`), as the shell's final pass does; the per-300 s pass reads the index only. State that, and test the final pass with a host stub that answers no PR. Otherwise the slice either breaks the "index never says `pr: 'none'`" invariant or loses the final pass, which is the case the shell loop exists to catch.
3. Stale token across runs. The plan says the wrapper "creates it with `mkfifo`". On a restart the path already exists, and a stray holder from the earlier run still holds that inode. If the wrapper reuses the path, the new desk reads `held` after its own loop dies. Required order: `mkfifo` a temporary name, open it read-write, `rename` it over `.plot-worker.token.fifo`, and only then remove the old `.plot-worker.exit` and write the new pid. If the exit record goes first, a reader in the gap sees no exit record and the old `released` FIFO, answers `dead`, and starts a restart onto a launching desk.
4. A late exit record from the old wrapper. Rule 1 trusts any exit record over a `held` token. `continuation.ts:1096-1105` documents that an old wrapper can write `.plot-worker.exit` after the new run removed it (#1379). With rule 1 unconditional, that write turns a live new run into `ended`. Rule 1 must apply only when the exit record is not older than the token (compare mtime with the FIFO's, both file reads), or the exit record must carry the run's id. Add a test.

## The one change that matters most

Fix the false `dead` before the false `live`: make the harness hold the token (pass fd 3 in the loop's `spawn`), and bound rule 2 with `kill(pid, 0)` and `Worker bound`. A false `dead` starts a second writer on the branch, which nothing downstream catches. A false `live` with a bound costs at most one `Worker bound` of delay.
