---
'plot': minor
---

`plot-fleet-scan.sh` writes `.plot/state/last-pulse.json`, so the component that produces a pulse is the one that records it. Until now `fleet.ts:2804` was the only writer and the scan named the file zero times, which meant `/plot-pulse` in a repository with no board had nothing to diff against and every pulse read as the first one — while `DESIGN-process.md` §1 requires the fleet to work with no board at all.

**The board's write is not removed and becomes redundant.** The board spawns this script to produce the pulse it renders, so a scan that writes the bridge writes it on the board's path too, from inside the same run. What changes is which process does it, not whether it happens.

**The write stays inside the success path**, which is the property that had to survive the move. `fleet.ts:2800` states it: *"a scan that failed must not overwrite the last good answer — the only thing standing between a `--watch` restart and an empty board."* So the call sits at each terminal point — the `--json` document, and the prose report's `Pulse complete` line — never in a trap and never at exit. A scan killed mid-run leaves the previous file byte-identical, asserted by killing a real one rather than by reading where the call sits.

**The format is `pulse-bridge.ts`'s and every field is its requirement:** version 1, `at` in epoch milliseconds, a temp file carrying the pid then `rename`, every failure swallowed. `ages`, `approvedAt`, `ideaPlans` and `branchUrlBase` come from the board's own timers and are written empty, which `readBridge` already degrades to unknown ages and no branch links — then overwrites seconds later on the refresh it always issues.

**Assembling the document is now a separate question from printing it.** `as_json` meant both, and the bridge needs the second without the first. Measured 2026-09-06 on this estate: assembly costs 14.7 s against 5.9 s for prose alone, because the branch objects carry a `merge-tree` conflict set per unlanded branch. So a plain scan pays neither, and `--log-pulse` — the flag `/plot-pulse` already passes on every run, and which already means *this pulse records itself* — turns assembly on for the boardless case the plan leads with.

Six tests run the real scan against a real repository and hand what it wrote to the real reader, because the failure is silent: a version mismatch returns null and renders an empty board with no error anywhere.

<!--
bumps:
  skills:
    plot: minor
-->
