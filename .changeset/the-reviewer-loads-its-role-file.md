---
'plot': patch
---

The reviewer loads its definition from `.claude/agents/reviewer.md` on a freshly fetched `origin/<default>`, so a PR head or a dirty checkout cannot change it. The model, effort and turn limit come from that file. A definition that adds a tool outside `Read`, `Grep` and `Glob`, or sets `permissionMode`, `mcpServers` or a narrower `disallowedTools`, refuses `reviewer-role-widens` naming the key. `.plot/charters/reviewer.json` is deleted.

<!--
plan: docs/plans/2026-11-03-who-may-approve-a-release-and.md
-->
