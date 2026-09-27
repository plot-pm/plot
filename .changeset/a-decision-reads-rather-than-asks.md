---
'plot': patch
---

`plot-reconcile-scan.sh` asks `PrIndexStore` before the host for its merged-PR list, through `board/plot-pr-index-lookup.mjs` — the store's second shell consumer after `plot-impl-status.sh`. Sections 2, 3, 19, 20 and 21 read that list, and the scan now skips its `pr-list --state merged` call when every branch those sections ask about has a MERGED row in the store. One unanswered branch costs the same single call as before. Where both answer, the list is their union with the host's lines first, so a merged PR older than the host's 500-PR page is found and no existing finding changes. Only MERGED rows are taken. A missing, unparseable or wrong-version store, a missing bundle, `--offline` and a failed open-PR list give the report a run with no store gives. The scan reads the store and never writes it.

<!--
plan: docs/plans/2026-09-26-a-decision-reads-the-index.md
bumps:
  skills:
    plot: patch
-->
