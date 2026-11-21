---
'@plot-pm/board': patch
---

Every artifact on the Delivery tab draws as a bordered link tuple from one view function, `artifactTuple`: the Work items and Fleet cells, the section header links, the Tickets rows, the release card, and a release delivery plan row with its PR and slice lines. A tuple segment is at least 24 px tall, and an artifact with no address in the payload, such as the release, draws as a text segment.

<!--
plan: docs/plans/2026-11-20-delivery-link-tuples-everywhere.md
-->
