---
'@plot-pm/board': patch
---

Deliverability resolves a slug's real dated plan file through its active or
delivered symlink, and reads that file's phase at the pulse's own read ref
rather than the working tree, so a plan reached through `docs/plans/active/`
is no longer refused as `not-merged`, and a checkout behind `origin` answers
`already-delivered` once origin has delivered it.

<!--
plan: docs/plans/2026-10-07-delivery-reads-one-source.md
-->
