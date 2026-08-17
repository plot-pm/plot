---
"@plot-pm/board": minor
---

**The last good pulse now survives a restart.** Until now a restarted board
served `0 branches across 0 plans` — an empty view, not a stale one.

Measured on 2026-08-17 with five agents in flight, three of them editing files
under `packages/board/`. The operator's board runs under `node --watch`, so
every save restarted the server, and the Agents tab reported *"Last scan
failed"* over zero rows. The fleet view exists to make parallel work visible,
and the more parallel work ran, the less it could show.

**The cache was never the problem.** `fleet.ts` already keeps one entry per
repo, every request reads it, and the scan refreshes it asynchronously — which
is why the tab polls at 4 s without running a scan per request. That design is
right and is unchanged. It is *process memory*, and a `--watch` restart takes it
with the process: a freshly started board has no cached pulse, so the *degrade,
do not hide* behaviour from #141 has nothing to degrade **to**. The banner
worked perfectly and named the exact failing command; there was simply no
last-good payload behind it.

So the in-memory cache gains a copy on disk at `.plot/state/last-pulse.json`,
written on each successful scan, read once at startup, and served through the
rendering that already exists — the banner, the `(frozen)` footer, the stopped
clocks from #141, the dimming from #160. No second vocabulary for *these
numbers are old*.

**The file is read AND a scan is issued at once**, because neither closes the
window alone. A scan costs 500–1050 ms (21.2 s measured on a cold boot), so
rescanning at startup narrows the empty window without closing it — and a
restart storm reopens it on every save. The file alone is the mirror failure: it
would leave the board stale until the next poll. The file covers the gap, the
scan ends it, and a completed scan overwrites every bridged field.

**A bridge, not a store, and the distinction is load-bearing.** Plot derives
state from git (Principle 1), and a JSON file that outlives its usefulness is a
second source of truth that can disagree with the repository. Past fifteen
minutes the honest answer is *no data* — which is what the board says today and
is correct once the numbers describe a repository state that has moved on. A
payload stamped in the future is refused for the same reason: a clock that ran
backwards would otherwise read as the freshest possible answer.

**One-directional, like every other signal here.** A scan that succeeds replaces
the file immediately; a scan that FAILS does not touch it. A failure must not
destroy the last good answer, which is the only thing standing between a restart
and an empty board.

The file is machine-local by construction — it describes this machine's refs and
worktrees — so `.plot/state/` is gitignored while the rest of `.plot` (briefs,
templates, the review hold) stays committed. It is re-validated through
`FleetPulseSchema` on read rather than trusted, because it may have been written
by a different build; anything unreadable, unrecognised or expired reads as no
bridge at all, which is exactly today's cold start.

Asserted across an **actual process restart**, never a cleared in-memory map:
the map is already correct, and its loss on restart is the entire defect.

<!--
bumps:
  skills: {}
-->
