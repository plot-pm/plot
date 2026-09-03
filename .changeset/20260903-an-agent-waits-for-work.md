---
"plot": minor
---

An agent that finds no claimable slice now waits instead of ending itself. `plot-worker-loop.sh` polled `--next`, and a silent answer was `|| break` — so the loop terminated on the same condition that would have reported the agent free. Measured 2026-09-03 on this estate: 0 live workers, 0 manifests, 4 desks standing, and eligible work on the board. The wait is bounded by `Worker bound`, names on stderr what it is waiting for and how to stop it, and is interruptible because its sleep is a backgrounded child the loop waits on. `plot-fleet-scan.sh --why-nothing` answers on the plan path as well as the empty estate, which is what tells a blocked next slice from no next slice.

<!--
bumps:
  skills:
    plot: minor
-->
