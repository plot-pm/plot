---
"@plot-pm/fleet": patch
"@plot-pm/domain": patch
---

`continueOnDesk` restores the desk's manifest when the loop stop or the wrapper stop fails, and removes `.plot-continuation.md` on every `failed` return after it wrote the prompt. It signals the manifest's `wrapperPid` only after the process table shows that pid working in the desk's worktree; a pid that works elsewhere is refused as `loop-alive` before any signal, with the desk as found. `ProcessProbe` gains `workingDirectory(pid)`, read from `/proc/<pid>/cwd` or `lsof`.

<!--
plan: docs/plans/2026-10-24-a-desk-continuation-skips-its-run.md
bumps:
  skills:
    plot: patch
-->
