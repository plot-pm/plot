---
"plot": minor
---

The board serves `/api/fleet`: what agents are doing, and what they wait for.

Branch state was only ever visible as terminal output — real, but gone the moment the scrollback rolled. The endpoint turns `plot-fleet-scan.sh --json` into rows grouped by **the reason each one is waiting**, because each group implies a different action: review it, nothing, nothing, go check whether it died, decide whether to start it. Sorted that way the list is workable top to bottom, and when only *working* is populated you can walk away.

**It never runs the scan.** Measured: 0.5–1.05 s per scan against a 4 s client poll, on a single-threaded server — that would block the event loop roughly a quarter of the time. The server refreshes a cache on its own timer using the async `execFile`, and every request reads the cache plus its age. Client poll rate and scan duration are decoupled, so twenty plans give you a *staler* tab, not a *slower* board.

Two failure modes are handled as deliberate design rather than as edge cases. Until the first scan lands the endpoint reports `ready: false` — "not ready yet", never an empty fleet. And a failed refresh **never overwrites a good result**: the tab keeps the last pulse, its age, and the error. Replacing real state with emptiness because one scan failed is what makes a monitoring view untrustworthy.

The `waiting-on-machine` group is defined but empty at this step — it needs PR data. It is still rendered, because an absent group reads as "nothing is waiting on CI", a claim this step cannot make.

**Known limit, worth stating:** this is git-only, so unpushed local work is invisible. An agent editing files without pushing shows as `not-started`.
