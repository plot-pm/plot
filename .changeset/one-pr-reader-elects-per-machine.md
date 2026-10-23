---
'@plot-pm/board': patch
'@plot-pm/fleet': patch
---

A fleet-less board now elects itself the one PR reader for its `(host backend, account, repository)` on the machine through a filesystem lock, folding the host's answer into the shared PR index store instead of a private in-memory overlay; a losing board reads that store instead of asking the host again, and an unreadable lock falls back to the prior per-process behaviour rather than blocking.

<!--
plan: docs/plans/2026-10-23-one-pr-reader-per-machine-and.md
bumps:
  skills:
    plot: patch
-->
