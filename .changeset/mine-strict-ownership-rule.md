---
'plot': patch
---

Adds `isMineStrict` beside `isMine` (`packages/domain/src/rules/ownership.ts`) — true only where `ownership` answers `mine`, the rule the stricter «Mine» mode will filter by — and `mineMode` (`packages/domain/src/rules/mine-mode.ts`), which computes the effective `all` / `mine-and-unknown` / `mine` mode from the reader and the two stored keys, gated on `comparableLogin` rather than `readerIsKnown`. `agentOwnership` now answers `mine` for a synthesized desk whose state shows it is on this machine, the same as a manifest agent. No caller moves yet; `isMine` and its existing tests are unchanged.

<!--
plan: docs/plans/2026-10-28-mine-hides-rows-with-no-known.md
bumps:
-->
