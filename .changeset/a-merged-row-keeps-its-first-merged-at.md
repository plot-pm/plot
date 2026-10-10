---
'plot': patch
---

The PR index keeps the first `mergedAt` of a merged row, so a Bitbucket comment on a merged PR no longer moves it and republishes `pr merged`. The IndexMonitor reports itself alive after every fold that read the PR index, also in a repository whose plans name no slice branch. An in-process `publish` on the channel no longer moves the monitor's `lastSeen`: only `seen` after a successful index read does, so a fold that could not read the index but published `default branch red` no longer reads as a live monitor. A publish received over the socket still moves its monitor's `lastSeen`.

<!--
bumps:
  skills:
    plot: patch
-->
