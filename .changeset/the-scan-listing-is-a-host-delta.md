---
'plot': patch
---

On GitHub, fleetd reads the scan's PR listing as its last whole listing plus `pr-list --state open --rich` and `pr-list --state all --since <watermark − 60 s>`, with a full read every 24 hours, instead of the whole `--state all` listing on every listing; CLAUDE.md *A Decision Reads The Index* names this consumer.

<!--
plan: docs/plans/2026-10-26-the-fleet-scan-re-reads-all.md
bumps:
  skills:
    plot: patch
-->
