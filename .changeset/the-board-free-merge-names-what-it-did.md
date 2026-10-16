---
'plot': patch
'@plot-pm/board': patch
---

The board-free merge names the right refusal reason for an uppercase sha and says when a merge was not pinned.

A PR's head sha and the caller's sha now compare case-insensitively, so a sha typed in uppercase that names the same commit the host sees merges instead of refusing as `head-moved` with a message claiming the head had moved. The `unaskable` refusal's detail text no longer says "Absent is not green" for a failed read — a failed read and an absent reading are different facts, and the text now says "A failed read is not an absent reading." The merge JSON answer carries a new `unpinned` field, true specifically where the host cannot pin a merge to a commit (Bitbucket today). The controller gate's unpinned-merge refusal for `gh` now names the reason a Bitbucket repository has no path through it: `gh` is a GitHub CLI and cannot reach Bitbucket at all.

<!--
plan: docs/plans/2026-10-16-bitbucket-parity-and-app-identities.md
bumps:
  skills:
    plot: patch
-->
