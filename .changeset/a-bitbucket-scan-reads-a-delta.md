---
'plot': patch
---

A Bitbucket fleet scan now reads a delta after its first full sweep, the same shape GitHub's scan already had, instead of re-sweeping every tracked branch on each due listing. `readBitbucketListing` asks one unbranched open page (capped at 49, one below the host's own page length so a full page carries no whole-page claim) plus one `--since`-windowed rest call, and falls back to a full branch sweep when the host cannot prove either half whole or a carried OPEN row vanishes from both answers.

<!--
plan: docs/plans/2026-10-28-supervisor-tick-s-fleet-scan-reads.md
bumps:
-->
