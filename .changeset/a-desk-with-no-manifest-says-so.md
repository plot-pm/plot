---
'@plot-pm/board': patch
---

A desk no manifest names no longer renders as an agent working the branch its worktree happens to have checked out. `synthesizeEntry` now sets `branch: ''` and carries the checkout in a new, display-only `checkout` field, so `isAgentFree`, `handedTo` and `liveAgentBranches` stop reading the desk as holding or free to take that branch's work. The registry row prints the domain's new `unnamedDeskLabel` instead — naming the absence and the process state, with the checkout as its own labelled detail rather than the row's name, link or id. `freeAgents` now excludes every undeclared entry outright, closing the dispatch hazard where a desk nobody registered could be counted as available for the next slice.

<!--
plan: docs/plans/2026-10-01-a-desk-and-its-manifest-name-each-other.md
-->
