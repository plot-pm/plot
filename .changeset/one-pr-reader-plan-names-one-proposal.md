---
"plot": patch
---

The `one-pr-reader-per-machine-and` plan's Motivation, Approach and Open Questions now match what `feature/one-pr-reader-per-machine-and` (PR #2436) shipped: proposal 1 (one locked reader per machine, account and repository) is named as the adopted design rather than one of four candidates still awaiting a Design decision, proposals 2–4 are named unscheduled rather than left open, two Open Questions the implementation already answers are rewritten as answers, and the account/lock-scope wording matches the Approach section's "per host account and repository" instead of a narrower "per account" framing. The spender count is marked "about 44" rather than stated as exact, since issue #2386 itself gives the same 2-boards-plus-"about 38"-processes breakdown that does not sum to a round 44.

<!--
plan: docs/plans/2026-10-24-bitbucket-pr-rows-run-per-row.md
bumps:
  skills: {}
-->
