---
'@plot-pm/board': patch
---

The board's event throttle sends one trailing event, and the page one trailing refetch, when a window closes after a dropped arrival (`ruleEventWindow` reports `trailingAt`), so a finding published late in a window no longer waits for the 30 s poll. Tabs of one browser share one `EventSource` through a Web Lock and a `BroadcastChannel`, so a seventh tab connects. The first `welcome` after a page's own load refetches nothing (`ruleWelcome`). The local `window` in `channel-events.ts` and `event-listener.ts` is renamed `eventWindow`.

<!--
plan: docs/plans/2026-10-10-the-channel-closes-its-review-findings.md
bumps:
  skills: {}
-->
