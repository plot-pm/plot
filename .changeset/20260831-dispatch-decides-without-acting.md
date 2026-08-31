---
'plot': patch
---

Dispatch is expressed as readings → `Decision | Refusal`, and every refusal is assertable without spawning anything.

`plot-dispatch.sh` decides and acts in the same breath, so its refusals could
only be observed by running it against a real repo with real worktrees and real
processes. They are now domain functions over values: `dispatch` for the fan-out,
and the three verbs that run BEFORE the phase gate — `stopWorker`,
`restartWorker`, `migrateWorktrees` — beside it.

The verbs sit apart for the reason they sit apart in the script: each reads a
different thing. A fan-out reads a plan and a fleet; these read one worktree, or
every worktree, and nothing else. They run before the phase gate because they
act on work already in flight, and a plan's phase says nothing about whether a
stopped worker should be replaced.

**The orderings the tests pin, because losing them costs real work:**

- `--restart` asks the **PR first, before the state word**. Five of five
  `failed` worktrees measured on this estate held a PR, so a gate on the state
  alone would restart all five and destroy what the `finished` refusal protects.
- `--migrate` refuses on liveness and unlanded work **separately**. The worker
  state alone misses a hand-made dirty worktree no worker ever ran in.
- a dry run is the default and emits **no** write, which is the domain's
  contract: it describes writes and performs none.

Coverage is the gate rather than the claim. With these tests the domain package
is at 100% against its threshold; without them it is 92% and the build fails —
verified by removing the file and watching it break.

<!--
bumps:
  skills:
    plot: patch
-->
