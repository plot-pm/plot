---
"@plot-pm/board": minor
---

The components leave AgentList.tsx into rows, menus, and marks

Wave 2 of the AgentList refactor: moves 17 React components from AgentList.tsx
(~5351 lines) into three subject modules under `packages/board/src/app/lib/agent-rows/`:

- **rows.tsx**: HeaderRow, PlanRow, WaveRow, Row, IssueRowView, PlanLink
- **menus.tsx**: RowActions, WaveActions, PlanActions, ResliceMenu, BranchMenu, IssueRowActions
- **marks.tsx**: ActivityMark, UnpushedMark, ChangeMark, StuckCell, BlockedByMark

AgentList.tsx is now a ~1625-line shell containing imports, hooks, and the
rendering body that composes sections.

<!--
bumps:
  packages:
    @plot-pm/board: minor
-->
