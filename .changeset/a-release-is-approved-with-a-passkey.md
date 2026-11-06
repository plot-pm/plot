---
'plot': minor
'@plot-pm/board': minor
---

A release approval needs a user-verified WebAuthn assertion from the registered platform authenticator. The board serves `POST /api/release-approve`, a challenge route and a registration route, and shows a passkey panel; a challenge is single-use, bound to the pull request and head sha, and valid for 120 s. `plot-ask.mjs release-approve` carries no assertion and refuses `person-unproven` for every caller. `POST /api/release` and `POST /api/restart` accept an optional assertion that reads `person`.

<!--
plan: docs/plans/2026-11-03-who-may-approve-a-release-and.md
bumps:
  skills:
    plot-release: minor
    plot: patch
-->
