---
'plot': patch
---

A branch whose ref is behind the default branch and carries no commit of its own now reads `unknown` rather than `merged`, unless the host reports its pull request merged. The shape has three sources — landed work, a ref cut from an older main, and a claim whose commit was lost — and only the first is finished work. Measured 2026-09-26, three approved slices read `merged` with no commits, no PR and no desk, and dispatch reported `dispatched=0 skipped=0`, the same output as a finished plan. `unknown` holds the slice's wave with the existing `merge-unknown` reason, so the slice stays visible instead of settling a wave nobody finished.

<!--
plan: docs/plans/2026-09-26-a-branch-behind-main-holds-nothing.md
-->
