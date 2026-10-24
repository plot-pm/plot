---
"@plot-pm/fleet": patch
"@plot-pm/domain": patch
---

`continueOnDesk` restores the desk's manifest when the loop stop or the wrapper stop fails, and removes `.plot-continuation.md` on every `failed` return after it wrote the prompt. It signals the manifest's `wrapperPid` only after the process table shows that pid as an ancestor of the free-waiting loop, which also holds after a hop moved the desk to another worktree; a pid that is no ancestor of the loop is refused as `loop-alive` before any signal, with the desk as found. `ProcessProbe` gains `parentPid(pid)`, read from `ps -o ppid=`.

<!--
plan: docs/plans/2026-10-24-a-desk-continuation-skips-its-run.md
bumps:
  skills:
    plot: patch
-->
