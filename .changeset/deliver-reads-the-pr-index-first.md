---
'@plot-pm/board': patch
---

`deliverabilityOf` now reads the checkout's PR index store before asking the host whether a branch merged, and asks the host only for a branch the store cannot answer from a terminal `MERGED` row. A host that could not answer refuses the delivery as `cannot-tell`, naming the confirmed count, rather than being misread as unmerged. Fixes #1165, where a 12-slice plan on Bitbucket sent roughly 60 host requests and a single rate limit wrongly refused delivery of a finished plan.

<!--
plan: docs/plans/2026-10-07-delivery-reads-one-source.md
bumps:
  skills:
    plot: patch
-->
