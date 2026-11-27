---
'plot': minor
---

`plot-supersede.mjs --by owner/repo:slug` marks a plan Superseded by a plan in another repository on the same host. The command does not read that plan: the record reads `Superseded: <date>, by \`owner/repo:slug\` (unverified)`, and the summary line ends `successor=unverified`. A reference naming this repository's own `owner/repo`, read from `origin`, is checked as a bare slug. A reference that parses as neither a slug nor `owner/repo:slug` refuses `successor-unparsed` and writes nothing.

<!--
plan: docs/plans/2026-11-27-supersede-names-a-plan-in-another-repository.md
bumps:
  skills:
    plot: minor
-->
