---
'@plot-pm/board': patch
---

board: the registry names a live agent, not a dead pid or nine unknowns

Three fixes to the agent registry, each measured.

**The launch stamp updates a manifest pid, it does not only fill it.** The
stamp matched only the empty placeholder line, so it fired once per manifest and
a relaunch in an existing worktree left the previous run's dead pid on the row.
One contract, two implementations — `stampManifest` (TypeScript, for
`/api/continue`, the path the defect came from) and the dispatcher's inline
`awk` (a detached `sh -c` cannot reach the TypeScript) — with a parity test that
asserts they agree byte for byte. A relaunch now overwrites the pid, rewrites
`startedAt`, and records `previousPid` and an incremented `relaunches`; a first
dispatch is byte-identical to before.

**The registry classifies every agent whose worktree it can see.** The state
filter gated on the manifest pid, but the classifier never reads it —
`plot-worker-state.sh` is handed the worktree and reads its own pid file — so the
gate skipped nine entries whose worktree existed. The pid is dropped from the
filter and the liveness docstring, which misdescribed its own function, is
corrected.

**A worktree with no manifest is listed.** Absence of a manifest is not evidence
of absence of an agent, so a worktree the registry can see and cannot rule out is
synthesized as an entry — excluding the main repo and branchless worktrees, and
inventing no launch fact it does not have.

<!--
bumps:
  skills:
    plot-dispatch: patch
-->
