---
"plot": patch
---

Fleet scan resolves branch PR state from one `pr-list` response joined locally,
instead of one `pr-state` lookup per branch.

Measured 2026-08-18: 84 branches x 438 ms was 34 s, past the board's own 30 s
`run()` timeout (`fleet.ts:260`) — so the board served a pulse 644 s old while
reporting `Command failed`. On Bitbucket (issue #228) 14 branches cost 39 `bb`
calls and the scan did not finish inside 110 s. On this repo the scan now makes
20 host calls for 86 branches instead of 87.

PR #216's no-ref lookup stays: it asks about a branch a repo-wide list may
legitimately not contain, and is bounded by absent branches rather than by all
of them. A list that failed still reads as unanswerable, never as "no PR".

<!--
bumps:
  skills:
    plot: patch
-->
