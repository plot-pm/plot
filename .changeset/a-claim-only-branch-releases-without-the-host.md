---
'plot': minor
'@plot-pm/board': patch
---

The supervisor tick releases a `nothing-done` claim-only branch even when the host cannot answer the PR question (429 or no answer), using the desk's zero commits beyond the claim as local evidence. `plot-dispatch.sh --release <branch> --claim-only` skips the host's PR question and keeps every other refusal, including a file-changing commit on the remote or in the desk. An answered open or merged PR still refuses, and a `permission-denied` ending stays held for a person.

<!--
plan: docs/plans/2026-10-24-an-agent-refused-every-write-ends.md
bumps:
  skills:
    plot-dispatch: minor
-->
