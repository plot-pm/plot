---
'@plot-pm/board': patch
---

The board's ready line (`Plot board: http://localhost:<port>`) now prints only after every address in `BIND_ADDRESSES` has been tried, not from the first bind's callback — fixing an intermittent `ECONNREFUSED 127.0.0.1` where a client read the line and connected over IPv4 before the second bind had completed. The bind chain is extracted into `packages/board/src/server/bind-chain.ts` with an injectable `listen`, so a unit test can drive it with a fake one and assert the ready line waits for the chain's terminal case.

<!--
plan: docs/plans/2026-10-17-the-ready-line-waits-for-every.md
bumps:
  skills:
    plot: patch
-->
