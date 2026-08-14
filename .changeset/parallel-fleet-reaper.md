---
"plot": minor
---

The reaper: `/plot-reconcile` now tells an abandoned claim from a dead worker.

Claim-by-ref means a worker takes a branch by pushing an empty ref. Two very different situations then leave an **identical** artifact in git — the worker deliberately gave the branch up, or the worker died. Before this change both fell into the stale-branch sweep's "ahead of main → orphan" verdict, which was doubly wrong: an empty claim is not ahead of anything, and calling it an orphan hides that someone may still be working there.

Empty claims are now classified before that verdict, using the plan annotation as the only available signal:

- **`deferred:` / `moved:` present** → the branch was given up on purpose. Reported as a deletion candidate, with the command.
- **a bare `claimed:`, or nothing** → the worker may be thinking, or may be dead. Reported as needing judgment, and **no deletion command is offered** — a slow worker looks exactly like a dead one, and deleting its branch destroys work in progress.

Reading the annotation here is the one deliberate exception to "git is the truth, the annotation is only a reflection". It is safe because this gate decides *cleanup*, not *work*: a wrong annotation costs at most a missed cleanup, never lost or duplicated work.

The summary footer gains a `claims=N` count. Consumers that parse it (`/plot`'s hygiene line, `/plot-deliver`'s landed gate, `/plot-reconcile`'s Automation Output) see the new field in the documented position.

This closes the gap opened by Stage 3: detached workers die without telling anyone, so the reaper is load-bearing rather than a nicety.

<!--
bumps:
  skills:
    plot-reconcile: minor
    plot: patch
    plot-deliver: patch
-->
