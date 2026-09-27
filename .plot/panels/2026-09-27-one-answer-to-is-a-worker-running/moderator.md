# Moderation — one answer to "is a worker running"

Jurors: 1 (evidence), gated on both labels — Position `amend`, Evidence
`executed`. **Round 2 in effect**, because the verdict arrived after a first
moderation had already been written.

## A process failure first, and it is mine

The juror's verdict landed at 17:33. A moderation declaring it ABSENT was
written at 17:26, the plan was amended from that moderation, and the amendment
was committed and pushed. **The panel was still running and I moderated it as
finished** — the same mistake recorded in memory as
`a-juror-that-executes-finds-what-readers-miss`'s sibling failure: a wait loop
that counted its own output.

The juror noticed independently: *"the file changed on disk mid-review."* It
re-measured against the amended text, which is the only reason this round is
usable at all.

**The rule this establishes:** a juror that has not written is not a juror that
found nothing. Wait for the process, not for a directory listing.

## The finding: the third diagnosis of one transcript, and the first two are both wrong

The juror **reproduced the headline transcript** in a sandbox — `finished <pid>`
from `plot_worker_state` against `worker alive (pid <pid>)` from the reaper's
reading, one pid, both components — with **no recycled pid and no exit record**:

```
LIVE wrapper pid=23768, no 'claude' child, tree CLEAN, branch pushed, no exit record
plot_worker_state    = [finished|23768|]
plot-reap.sh reading:  PLOT_PID='23768' -> 'worker alive (pid 23768)'
```

### The mechanism, verified by the moderator

`plot-worker-state.sh:863-873`:

```
    if plot_worker_agent_alive "$pid"; then
      printf 'running\t%s\t' "$pid"; return
    elif [ "$?" -eq 1 ]; then
      # The wrapper is alive and the agent is gone. The DESK decides what that
      # means — `stalled` ... `waiting` ... `finished` for a desk that is clear
      # ... No exit file exists: the wrapper has not exited.
      printf '%s\t%s\t' "$(plot_worker_task_state "$wt" "$has_pr")" "$pid"; return
    fi
```

**The code states the mechanism outright.** A live wrapper whose `claude` child
is gone is refined by the DESK into `finished`/`waiting`/`stalled`, with no exit
file involved. The reaper takes no such reading: `grep -c
'plot_worker_agent_alive\|plot-worker.exit' plot-reap.sh` → **0**.

### Why round 1's mechanism is refuted

Round 1 (the moderator's own) said the exit record is read first and the case is
a recycled pid. Both false:

- `:888` sits **after** the `kill -0` branch returns, under the header *"The
  process is gone. What exit code did it leave?"* (`:880-882`). The exit record
  is read **only when the pid is dead**.
- With an exit record present **and** the pid alive — round 1's exact case — the
  juror measured `plot_worker_state = running`. So `--stop` would have printed
  `stopped ... (pid 99861)` and killed the recycled process, not `is not running
  (finished 99861)`. **The transcript is unreachable by round 1's mechanism.**

`finished` was the tell throughout: on a live pid it is reachable only through
`plot_worker_agent_alive`.

## Three findings beyond the mechanism, all verified

**The fix as amended is correct hardening that closes none of the reported
desks.** The reaper genuinely reads no exit record — true on its own terms — but
in the measured population there IS no exit record, because the wrapper has not
exited. The refusal fires anyway.

**§"Why not route through `plot-worker-state.sh`" refutes a design nobody
offered.** Round 1's objection was *"a pure domain rule must not gain a shell
dependency."* Nothing proposes that: the reaper is the **adapter**, and it
already spawns `node`, `git`, `ps` and `plot-pr-merged.sh`. The section declines
the one component that answers the question, for a reason that does not apply.

**A latent work-loss path.** `plot-reap.sh:596` calls `firstReapRefusal` →
`reapProblems`, which carries **no `unpushedCommits` refusal** (verified: the
function's four pushes are `live-worker`, `blocked-marker`,
`uncommitted-changes`, `on-default-branch`) and the reaper supplies no `ahead`
reading. Only `finishedWith` has that guard, and the reaper never calls it.
**So `reapable.ts:441` is not on the reaper's path at all** — round 1 exonerated
a line the subject does not execute. Any widening of *not live* must not reap a
desk holding the only copy of unpushed commits; MEMORY records that loss shape
twice.

**And `plot-worker-state.sh` is not simply "correct".** On a manifest-less desk
its staleness check has no `startedAt`, and `:788-793` says *"the old behaviour
applies — `kill -0` is trusted."* If recycling matters anywhere, both readers
have that window.

## Verdict

**amend, round 2.** The defect is real, the deadlock is real, and #1004, #1007
and #1014 are all confirmed MERGED on 2026-09-26. What the plan still lacks is a
mechanism that produces the estate's own transcript.

Seven amendments are owed and the juror lists them; the load-bearing four:

1. **Correct the `:888` claim** — the exit record is read only when `kill -0`
   fails.
2. **Re-diagnose from `plot_worker_agent_alive` (`:580`) and
   `plot_worker_task_state` (`:714`)** — a live wrapper with a dead agent.
3. **Do the #1004/#1007/#1014 re-check BEFORE the slice.** It is a precondition
   of the diagnosis, not a follow-up; the plan is built on the claim it defers.
4. **Withdraw the domain-purity objection** and reject the eight-state
   classifier, if at all, on the `waiting`/`stalled` ambiguity alone.

Plus: name the unpushed-commits guard in Done when, say whether the
manifest-less window is in scope, and stop citing `:441` as the subject's line.

Kept as sound: *both sites or neither*, readings-not-the-rule,
`reapable.ts` unchanged, and the one-fixture agreement test.
