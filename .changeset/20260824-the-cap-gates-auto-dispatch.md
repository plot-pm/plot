---
'@plot-pm/board': patch
---

infra: the cap gates auto-dispatch and names the branches holding the slots

**maybeAutoDispatch refuses at the cap and names the branches.** When auto-dispatch
is on and the budget is zero or negative (parallelAgents - liveCount - inFlight <= 0),
the board logs:
```
auto-dispatch: at cap (N), refusing new dispatch. Slots held by: branch1, branch2, ...
```
This makes the refusal visible rather than silently withholding work.

**liveAgentBranches helper.** Returns the branch names of registry entries that
occupy concurrency slots (running or waiting, with branch not yet merged or
deferred in the pulse).

**plot-dispatch.sh warns and proceeds when the resulting count exceeds the cap.**
After spawning workers, if the live count exceeds the stored cap, the script logs
a warning and raises the cap to match:
```
WARNING: n_running (X) exceeds configured cap (Y). Raising cap to X and proceeding.
```
This is the deliberate choice: never kill a running worker, only withhold the next
dispatch.

<!--
bumps:
  skills:
    plot-dispatch: patch
-->
