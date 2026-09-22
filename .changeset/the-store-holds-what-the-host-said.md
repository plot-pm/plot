---
'@plot-pm/board': patch
---

The board keeps what its git host last said about pull requests, so a restart no longer renders nothing while it waits. `refreshPrs` reads a durable store before its host call and writes it after, keyed by PR number, with the watermark taken from the rows the host returned rather than from the local clock. The call's filter is unchanged — a full read still happens — so what this buys is that the answer survives the process: measured on this repository, one `gh pr list --state all` with the fields the board needs is 29 811 ms of a 32 105 ms scan, and the board refreshes against it every 5 s. A cold store, an unrecognised version and a failed write each fall back to today's behaviour; the outage paths leave the file untouched, because the next process inherits disk and not memory.

<!--
plan: docs/plans/2026-09-21-the-board-asks-only-what-changed.md
-->
