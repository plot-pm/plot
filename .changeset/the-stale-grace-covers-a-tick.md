---
'@plot-pm/board': patch
---

The board calls PR data stale only when the scheduled read is more than 155 s late: two 60 s reader beats and one 35 s pass. A healthy read lands up to about 110 s late, and the old 60 s grace showed a stale warning for up to a minute of each cycle.
