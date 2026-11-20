---
'plot': patch
---

The sprint-scope pulse (`Refs.pulse`) reads git only and lists no pull requests. Every auto-review, auto-merge, auto-fixer and release step asked it once per open PR per pass, and each call paged the whole PR listing to its 1000-row limit: on 2026-11-20 fleetd spent 2,425 of its 2,793 GraphQL points in one hour on that listing.
