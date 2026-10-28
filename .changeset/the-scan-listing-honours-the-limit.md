---
'plot': patch
---

The fleet scan's listing stretch now reads the account's own rate limit. Once the observed rate reaches a `predicted` or `actual` limit, the listing stops stretching by the damped 8x ceiling and waits past the reported reset instead (or a bounded maximum where no reset is stated) — before this, an account past its limit still only stretched 8x, spending 90–135 requests an hour against the 60/hr idle share. The listing's own unstretched base also moves from 5 s (the scan's poll cadence) to its own 60 s constant, dropping an idle account's unstretched spend from 720 requests an hour to 60.

<!--
plan: docs/plans/2026-10-28-supervisor-tick-s-fleet-scan-reads.md
bumps:
-->
