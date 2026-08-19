---
"plot": minor
---

The board renders what has arrived

The board asked every 5 s for something that took 18.3 s. Measured on this repo
2026-08-19 after the `pr-list` join landed: a full scan is 18.3 s against a
`REFRESH_MS` of 5 s, and git alone on 84 branches is 12.7 s. So the wait is
structural — even a perfect host fix leaves twelve seconds of it — and the only
thing that removes it is not waiting for the whole document.

`plot-fleet-scan.sh --stream` emits the same derivation as it resolves: one
`{"kind":"plan"}` line the moment a plan is fully derived, then one
`{"kind":"pulse"}` line carrying the identical document `--json` prints whole.
Measured on this repo, the first plan lands roughly nine seconds before the
last. The plan object is COMPOSED ONCE and sent to both destinations rather than
printed twice — a second `printf` of the same shape is a second implementation
of it, and the first field added to one and not the other is a streamed board
that quietly renders less than a batch one.

**The terminal line is what says the scan finished**, and a closed pipe is not.
A killed scan closes the pipe too, so a consumer that inferred completion from
the stream ending would read every interrupted scan as a complete answer about a
smaller fleet. A scan that exits 0 without its terminal line is therefore treated
as a failure rather than as an empty fleet.

**A badge whose source has not arrived is absent, never zero and never guessed.**
This is the rule the whole board is built on and streaming makes it load-bearing
rather than occasional: for most of an 18 s scan, most rows are genuinely
partial. `summariseFromPulse` already omitted `claimed`/`eligible` on a cold
cache; the case it missed is a pulse that is real and has simply not reached this
plan yet. Rendering that as `claimed: 0` is a fresh, confident, wrong answer —
worse than the cold-cache one, which at least looked empty.

**A scan that fails midway keeps what arrived and says the rest is unknown.**
Discarding a partial result throws away facts that were correctly measured. The
plans that landed stay; `complete: false` says the rest did not. That field is a
third state `ready` cannot express — `ready` asks *has anything arrived*, this
asks *has everything* — and it sits beside it for the same reason `shrink` sits
beside `error`.

**A partial summary is recounted from the plans in hand, never carried over.** A
summary describing 24 plans beside a `plans` array holding 3 is a measurement of
one document presented as a measurement of another. The rows themselves are not
qualified and must not be: each is fully derived from its plan and its refs, and
is exactly as true mid-scan as it will be at the end. Only the TOTAL is
provisional, so only the total says so.

The cache's one-directional rule survives the change but had to be restated for
it. Plans now land *during* a scan, so `pulseShrink` is compared against the last
COMPLETE answer rather than against `entry.pulse` — which this scan's own partial
writes have been overwriting for the last eighteen seconds, and comparing a
finished scan to the partial view of itself reports every shrink as zero.

<!--
bumps:
  skills:
    plot: minor
    plot-fleet: patch
-->
