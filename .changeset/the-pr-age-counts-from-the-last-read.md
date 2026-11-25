---
'plot': patch
---

The board's PR age counts from the last successful PR read. With a fleet running, the board took the age from the snapshot's `prs` reading, whose `readAt` moves only when a row changes, so a quiet estate showed "stale · PR data 239 min old" while fleetd read every few minutes. The reader state now carries `prAt`, the time the reader's last read answered, and the board serving a snapshot takes the later of the two. A failed read leaves `prAt` unchanged, so the age still grows during an outage.
