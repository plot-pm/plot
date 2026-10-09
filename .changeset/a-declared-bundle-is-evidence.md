---
'plot': patch
---

The decision gate accepts a bundle that `packages/board/build.mjs` declares, with its entry source present, as evidence for a *launcher* or *readings* row. A conversion PR can now change its row in the same change that adds the bundle, because main builds bundles only after the merge.

<!--
plan: docs/plans/2026-10-09-the-shell-sheds-its-decisions.md
-->
