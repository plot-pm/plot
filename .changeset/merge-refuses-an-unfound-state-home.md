---
'@plot-pm/board': patch
---

`plot-ask.mjs merge`, `release-approve` and `repair-pr` refuse `state-home-unread` where git cannot name the main checkout. A merge into the default branch or a `sprint/*` base refuses after `prState` and reads no state file, no review and no conversation; `repair-pr` refuses before it reads the PR or the record and writes nothing. A PR into another base merges as before. These commands answered `unaskable` here before, the same word as a failed read.

<!--
plan: docs/plans/2026-11-21-fleet-state-is-read-whole-and-from-one-home.md
bumps:
  skills: {}
-->
