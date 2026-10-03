---
'plot': patch
'@plot-pm/board': patch
---

Immediately before each hand-over, `startAgents` asks the branch's remote ref and whether its work landed again, and withholds the write unless both readings are fresh and clear. `handOverCheck` (`packages/domain/src/rules/queue.ts`) answers `stale` for a reading older than 300 000 ms (five tick intervals), `landed` or `unknown` from the fresh readings, `claimed` for a ref that still exists, and `hand-over` otherwise — every answer but the last withholds and reports why, and the next tick re-derives the queue.

Measured 2026-10-01 (#1149): a Bitbucket tick of 78 minutes handed `feature/ewzkus-3845-ueberwachung` to an agent after its PR had merged and its remote ref was gone. The agent's claim push was rejected three times and the loop logged `REGISTRY LOCK VIOLATION` about a second agent that did not exist. `plot-worker-loop.sh`'s claim push now keeps git's stderr and asks `git ls-remote --heads origin <branch>` on a rejection: an absent ref prints "origin has no such branch", and a present ref keeps the lock-violation line unchanged.

The refs port gains `remoteHead(branch)` — a git call, not a host call, so the check spends no host rate limit.

<!--
plan: docs/plans/2026-10-01-the-queue-reads-the-order-the-scan-reads.md
bumps:
  skills:
    plot: patch
-->
