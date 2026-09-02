---
'@plot-pm/board': patch
---

The corpus vacuity guard counts waves rather than unfinished plans. The scan reads only unfinished plans, so that count is the backlog and falls whenever work is delivered — a night of deliveries took it from over 20 to 19 and failed four PRs that had not touched the scan. Waves stay well clear of zero (74 against those 19 plans) and are still zero exactly when the scan read nothing.
