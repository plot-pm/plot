---
'plot': patch
---

The plot-follow mod reconnects to the fleet channel after a reload and marks held findings out of date until it answers, drops a held turn line when a `clear` retracts it, and keeps its turn gate per repository. Each reading starts a turn in one session of a repository only: the follower claims it with a lease file under `.plot/state/follow-leases/`, because the mod's store has no compare-and-set. The gate remembers the reading last announced per slot, so a fleetd restart starts no turn for an unchanged finding, and a finding heard only in a welcome toasts and can start a turn. The mod closes its follower when a line fails to parse.

<!--
plan: docs/plans/2026-10-10-the-channel-closes-its-review-findings.md
bumps:
  skills:
    plot: patch
-->
