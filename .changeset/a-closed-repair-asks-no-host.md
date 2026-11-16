---
'plot': patch
---

fleetd's repair pass asks no host, CI or ref while the repair record reads `done` or `exhausted`. It asked for the PR state of the last attempt's branch on every tick, about 12 times a minute, after the episode had closed.
