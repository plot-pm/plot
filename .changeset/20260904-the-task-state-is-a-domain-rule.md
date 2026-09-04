---
'@plot-pm/board': patch
'plot': patch
---

The task state is decided once, in the domain.

`taskState` moves to `packages/domain/src/rules/task.ts`, and
`plot_worker_task_state` reaches it through a bundled `plot-task.mjs` entry
point instead of deciding in shell. The shell keeps all four world reads; only
the decision leaves. The unpushed reading is `boolean | null` — a branch with no
`@{upstream}` cannot be asked, and `null` must not become `stalled`, which is
the failure a fallback counting against `origin/main` produced when it reported
every clean branch stalled in a repo with no remote. A rule that cannot be asked
refuses and names `pnpm build:board`; there is no shell fallback, because a
second implementation kept "just in case" is the drift this move removes.

<!--
bumps:
  skills:
    plot: patch
-->
