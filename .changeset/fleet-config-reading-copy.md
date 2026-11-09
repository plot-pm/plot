---
'@plot-pm/board': patch
---

The fleet scan records its `config` reading as a copy taken after it has read every key, so the snapshot a subscriber holds equals the daemon's, including the `State branch` key.
