---
'@plot-pm/board': patch
---

The board's PR stale banner judges the data against the reader's scheduled next read. A read that the reader stretched for the account's spend shows no banner while it is on schedule. The banner shows when the scheduled read is late by more than one refresh interval, and names how late. With no schedule known, or during a host backoff, the banner keeps the rule of twice the refresh interval. The `/api/fleet` payload carries the new `prOverdueSeconds` field.
