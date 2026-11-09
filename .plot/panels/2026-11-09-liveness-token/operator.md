# Operator juror: liveness-token

Lens: what a person sees and does when this fails or misbehaves. Is every failure named, visible on the board or in a log, and recoverable without reading code?

Position: amend

## Open Questions

1. **Which processes hold fd 3.** Measure it as the plan says, then make the answer narrow on purpose: the loop holds fd 3 and passes it to no child. `continuation.ts:878` already closes the reporter descriptor for the `Worker command` with `3>&-`; apply the same close to every command `plot-worker-loop.sh` starts, and to the harness `spawn`. A person reads "the loop lives" from one holder, not from an unknown set of descendants. This also narrows leftover (a).
2. **`orphaned`.** Keep the walk, as the plan says. But the walk is a `ps` process table (`plot-worker-state.sh:1020`, `ps -o pid=,ppid=,comm= -ax`), and `plot-worker-state.sh:1447` runs it for every live desk with a wrapper file. So the census claim "S4 GitHub 3 desks reads `ps` 0 per pass" cannot hold while the walk stays; the floor is the 1 table per pass from `desk-probes-in-domain`. Change the Done-when row to "`ps` at most 1 per pass, and no `lstart` read for a desk with a token", or run the walk only when the token reads `held` and the loop reports its harness ended.
3. **`mkfifo` fails.** The fallback to rule 4 is enough for correctness, but today it is silent. The wrapper must write the failure (errno and path) to the desk log and to the manifest as `token: none (<reason>)`, and the board must show "liveness by start time" on that desk. Otherwise an operator cannot tell why one desk still costs a `ps`.
4. **FIFO as dirt.** Yes, `.plot-worker.*` covers the desk FIFO (`plot-worker-state.sh:89`). Add a test that a desk holding `.plot-worker.token.fifo` reads clean; a FIFO that reads as dirt shows `holds unlanded work` on every desk, which is the worst false finding for an operator.
5. **Reader FIFO path.** Confirm with a test that two linked worktrees resolve one path; the heartbeat already resolves to the main checkout since #3298, so reuse that resolver and do not add a second one.
6. **P1 retirement.** P5 replaces P1. Name it in the census README in the same slice.

## Leftovers

**(a) Rule 2 never checks the pid.** Not handled, and from the operator seat it is the worst failure in the plan: the desk reads `running` forever, no restart starts, no finding is written, and nothing on the board says why. A background child that keeps fd 3 is common (a dev server, a watch-mode test, `pnpm board`). Change rule 2: token `held` AND `kill(pid, 0)` answers on the recorded loop pid → `live`. Token `held` and the pid does not answer → a named reading, `stray holder`, routed like `orphaned` (to `taskState`), and the board names it: "the worker ended without a record; a process still holds its token". `kill(pid, 0)` is a syscall, so the census cost stays zero. Also apply the `Worker bound` (28800 s) from the manifest's `startedAt` as a hard ceiling on `live`, because the bound the wrapper enforced dies with the wrapper. Add a Done-when row for each: "SIGKILL the wrapper, end the loop, leave a child holding fd 3: the desk reads `stray holder` on the next read" and "a desk past `Worker bound` never reads `live`".

**(b) One `mkfifo` process per launch.** Acceptable: it is once per launch, an action-time cost, and the reporter already pays it (`continuation.ts:878`). State it in the plan so a reviewer does not count it against the per-pass census. Remove a stale FIFO before `mkfifo`, as `continuation.ts:1321-1328` does for the reporter FIFO, and test that a restart on a desk whose previous run left a stray holder makes a new FIFO, so the new run never inherits the old holder's `held`.

## Defects

1. **The final pass contradicts itself and loses the finding the monitor exists for.** Design: "an index with no row for the branch answers `unaskable` and writes no `owes a review`". Done-when: "an agent exits 0 with commits and no PR row; fleetd writes `owes a review` within one pass". Both cannot hold. With the design as written, the agent that commits everything and opens no PR (`plot-agent-monitor.sh:556-562` names it the case that matters most) produces no finding, and the operator sees a clean desk. Fix: on the final pass only, when the index has no row, fleetd asks the host once for that branch (`pr-state`). That is one call per agent end, a trigger, which the story allows ("an action is itself a trigger"). Keep `unaskable` for every other pass.
2. **A `dead` reading must reach the operator as a fact.** Rule 3 is the new case (wrapper killed, all holders gone). Write a desk log line and a `.plot-worker.monitor.agent.jsonl` line with the reason ("the token was released with no exit record"), so the board's attention row says what happened instead of a bare `ended`.
3. **Rule 1 and `agentState` order.** `agentState` (`rules/agent-state.ts:136`) checks `live` before the exit arms. Rule 1 puts the exit record first. Say in the *Worker token* slice which function owns the order, and add a corpus row for "exit record present, token held".

## The one change that matters most

Make rule 2 require the recorded pid as well as the token, with a named `stray holder` reading and the `Worker bound` ceiling. Without it, the plan trades a reused pid that reads `live` for a stray child that reads `live`, and the new failure has no bound, no finding and no restart.
