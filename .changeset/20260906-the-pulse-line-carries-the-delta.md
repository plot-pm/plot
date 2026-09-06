---
'plot': minor
'@plot-pm/board': minor
---

A pulse says what changed. `/plot-pulse` leads with the delta and prints the
full picture below it, and the fleet scan's pulse line carries the same answer —
the delta is what a returning reader wants, the picture is what a new one does,
and neither is made to scroll past the other's.

No comparison is written here. `pulseDelta` has been in the domain since the
rule slice, with its own tests, and until now it had no production caller; this
is the reporting half and nothing else. A diff written beside it would be the
second implementation this repo keeps measuring.

The four outcomes stay four, and the pair that must never collapse is
`unchanged` and `unusable`. A quiet estate says nothing changed. A first run
says nobody has pulsed on this machine yet — where every new adopter starts, and
not a failure. A bridge older than fifteen minutes, or one written by another
version, says it **cannot say**: there was history and it could not be used. A
reader shown *nothing changed* for either of the last two would be told the
estate is quiet when nothing was compared at all.

What changed is NAMED rather than counted, the rule `readingLoss` states:
branches whose PR landed, workers that stopped, plans that became deliverable,
and plans or branches the scan used to see and does not now — each with the
plan it belongs to.

`plot-delta.mjs` is a tenth bundled artifact, for the reason the third through
ninth give: `plot-ask.mjs` answers by running `plot-fleet-scan.sh`, so a scan
asking it for its own delta would be an artifact calling the script that called
it. This one spawns nothing and reads nothing — both readings arrive on stdin.

The previous pulse is read before `write_bridge` replaces it, and every failure
is silent: a missing artifact, an unreadable file, a `node` that will not start
each cost the delta and leave the report exactly as it was. Only the two callers
that produce a pulse for somebody to read print one — a `--next` query asking
what to work on is told nothing new.

<!--
plan: docs/plans/2026-09-05-a-pulse-says-what-changed.md
bumps:
  skills:
    plot: minor
    plot-pulse: minor
-->
