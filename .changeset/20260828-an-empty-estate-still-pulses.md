---
'plot': patch
---

<!--
bumps:
  skills:
    plot: patch
-->

An empty estate is a complete answer, not a partial one.

`plot-fleet-scan.sh` handled the no-plans case by printing a sentence and a
summary line, then exiting — **before the emitter**. So `--json` and `--stream`
were ignored entirely there: a machine consumer got human prose on stdout, and
under `--stream` no terminal `pulse` line at all.

The board's contract makes that decisive. Its own comment: *"a consumer that has
seen `plan` lines and no `pulse` line has a PARTIAL answer and must say so."*
The board was right; the scan was breaking the contract. A complete answer read
as a scan failure — every pulse, forever, because the next scan said the same.

**Every new user has zero plans**, so this was the first thing a board installed
from npm did: `ready:false` and *"fleet scan ended without a terminal pulse
line"*, indefinitely.

The machine paths now fall through to the emitter, which already renders
`"plans":[]` with a zeroed summary — the same document shape a populated estate
produces. One emitter, one shape, no second place to drift. `--next` still exits
1 and the human sentence is unchanged: a person reading an empty estate wants
the sentence, not an empty JSON document.
