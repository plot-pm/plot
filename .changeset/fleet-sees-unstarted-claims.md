---
"plot": minor
---

The fleet pulse now says whether a claimed branch actually has a **worker**, and the row says so. A claim is a push — it means a dispatcher *took* the branch, and nothing more. On 2026-08-17 three rows sat in **WORKING** with a pulsing green dot while nobody was working on any of them: the claim was real, the worker was never started, and the row had no word for the difference.

**The states already existed and nothing read them.** `worker_state()` in `plot-dispatch.sh` has distinguished **five** outcomes since the day it was written — `running <pid>`, `finished <pid>`, `failed <pid> (exit N)`, `ended <pid> (status unknown)` and `no worker` — and it already handles the traps, including rejecting a pid of `0` explicitly. Measured against the board: `grep -rn "plot-worker.pid" packages/board/src` returned **nothing**. The information was richer than the board assumed and reached no screen. So this adds no liveness check; it reports the one that exists.

**All five travel, because collapsing them re-creates the very defect being fixed.** `failed (exit 1)` and `finished` are **opposite actions** — a crashed worker needs restarting, a finished one needs reviewing — and a row that says "ended" for both leaves the reader to open a log to find out which. That is the same one-label-two-states shape as `no commits yet` covering both an idle branch and a finished-but-unpushed one. A failed worker is also not a *working* row: it goes where its action is, `waiting-on-you`, because a person has to decide whether to restart it. A crashed worker wearing a pulsing dot is the exact misreport this removes.

**A missing pid means *unknown*, not *nobody*.** `plot-dispatch` writes `.plot-worker.pid` only where it started the worker itself, so a hand-started agent leaves none — and hand-starting is the normal case for as long as `Worker command` is unset. **Five agents were started that way in one session**; reading a missing pid as "nobody is working" would have reported every one of them dead. So the group does not move, and only the sentence changes: the row says *claimed, no known worker* instead of promising commits are on the way. Absent is not false, the rule the scan already applies to every other missing signal.

**A branch with no worktree here is a third state, not the second one.** The pid lives *in* the worktree, so a branch claimed and started on another machine has no path to look at — this machine cannot answer the question at all, which differs from looking and finding nothing:

| claim | worktree | pid | row says |
|---|---|---|---|
| ✓ | ✓ | ✓ | `worker running (pid N)` — or the finished/failed/ended variant |
| ✓ | ✓ | — | `claimed, no known worker` |
| ✓ | — | n/a | `claimed elsewhere` |

The actions differ, which is what earns the third string: *look in this checkout* versus *ask the machine that took it*. Same split as `local_dirty` and `local_ahead` — two questions answered from the sources that hold the answers, rather than one signal stretched across both.

**A pid of `0` never reads as running.** `kill -0 0` signals the whole process **group** and succeeds, so a naive liveness check reports it alive forever. The scan rejects it exactly as `worker_state()` does, and the verdict travels to the board as a value rather than being re-derived there — re-deriving liveness on the far side would spring the same trap a second time. Its test spawns a **real** process for the running case, because `kill -0` is a real syscall and a fabricated pid would agree with a broken implementation by luck.

**The read costs one file check at a stop the scan already makes.** `worktree_rows()` visits every worktree and already knows which branch each holds, so there is no new traversal and the no-worktree case falls out of the existing structure rather than needing a guard. It obeys the same rules as the local signals it joins: git-only (no host call, so the board can keep polling every 5 s), one-directional — a stopped worker may lift a row up to `waiting-on-you`, and `none`/`elsewhere` move no group at all — and the human report is left byte-identical, because the worker fact belongs to `--json` and the row it feeds.

<!--
bumps:
  skills:
    plot: minor
-->
