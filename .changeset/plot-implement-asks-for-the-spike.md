---
'plot': minor
---

`/plot-implement` asks `plot-ask.mjs spike <slug>` which branch a Design plan's `Spike approved:` record licenses, and branches on its exit code: 0 `licensed <branch> <date>`, 1 `unlicensed <reason> <date or ->`, 2 `unaskable <why>`. The skill no longer applies the rule by hand, and an unlicensed record's stop names `plot-approve-command.mjs --spike`.

<!--
plan: docs/plans/2026-11-21-board-readings-take-the-domain-answer.md
bumps:
  skills:
    plot-implement: minor
-->
