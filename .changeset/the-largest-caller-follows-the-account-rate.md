---
'plot': patch
'@plot-pm/board': patch
---

The board's fleet scan asks a domain rule before it spends a pull-request listing, and reuses its last listing while the account is over its share. Measured 2026-10-02 on the Bitbucket workspace `quatico`, two checkouts of one repository over one hour: the scan spent 2949 of the account's 3150 calls — 93.6% of all calls and 97.1% of network calls — while the board's PR refresh, which already follows the cadence, spent 17. The scan runs on the 5 s pulse and its open listing sweeps one REST request per tracked branch per state, so 1764 of those calls were that sweep alone; the listing endpoint answered 429 for about 100 minutes on 2026-10-01. `listingSpend` composes `refreshIntervalMs`, so `MAX_CADENCE_STRETCH` and `CADENCE_DAMPING` are the cadence's and the caller holds no second copy of the arithmetic. A deferred scan receives the previous listing through `PLOT_PR_LISTING` — the seam `PLOT_TERMINAL_CACHE` already uses — with its age reported by the board, never as a fresh listing and never as an empty one; an empty listing reads as "no PRs" and refused four fully-merged plans on 2026-08-27. The first reading has no listing to reuse and is always allowed, an absent rate allows the call because silence is not evidence of a busy account, and GitHub's multiplier is 1 so its listing cadence is the pulse it has always been. The pulse and the git work stay on the 5 s beat; only the host listing slows.

<!--
plan: docs/plans/2026-10-01-a-shared-account-names-what-spends-it.md
bumps:
  skills:
    plot: patch
-->
