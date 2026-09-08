---
'@plot-pm/board': minor
---

A pull request's checks reach the plan card, and `none` no longer renders like `unknown`. `CardPrSchema` carried `number` and `url` alone, so a build state computed at four layers — the domain's five-state enum, `plot-host.sh pr-list --rich`, `fleet.ts`'s `PrRecord`, and a rendering rule already written in the schema's own comment — was dropped at the wire. A PR with no CI configured and a PR whose CI could not be reached both rendered blank, which on a Jenkins team is every pull request. `rules/checks-reading.ts` decides what a reader sees and `checksUnaskable` says once, rather than per row, that the connector itself could not be asked.

<!--
plan: docs/plans/2026-09-07-the-board-says-what-it-could-not-ask.md
-->
