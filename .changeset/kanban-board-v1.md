---
"plot": minor
---

Graduate the local Kanban board to a first-class Plot component. The board is now its own TypeScript package (`@plot-pm/board`, vite + react + shadcn + zod) built into a single self-contained artifact the plugin ships; `pnpm board` runs it with no install step. It reads plans through `plot-plan-meta.sh` (so front-matter plans render too), adds multi-select sprint **and** story filters, and its health is part of the Definition of Done, gated in CI.

<!--
bumps:
  skills:
    plot: minor
-->
