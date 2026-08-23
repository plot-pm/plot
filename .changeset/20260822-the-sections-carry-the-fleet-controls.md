---
"@plot-pm/board": minor
---

board: the sections carry the fleet controls

The board's two fleet controls now live on the section headers they describe. A
checkbox in the **NOT STARTED** header asks *is the queue being served?*; a `−
N +` stepper in the **WORKING** header asks *how many agents at once?* Each
control sits on the section it is ABOUT — NOT STARTED holds work nobody has
taken, so the switch that serves the queue goes there; WORKING holds the running
agents, so the cap on how many run at once is a statement about that section's
contents. Read together they are the model: *serve the queue / this many at a
time.*

**The state is SHARED, not per-viewer** — the wave's one departure from the
board's convention. View state normally lives in the URL and per-viewer
convenience in `localStorage`; the collapse state's own comment draws the line
(*collapse is convenience, not subject matter*). Auto-dispatch fails that test
in the opposite direction — it spawns agents that write code and open PRs — so
two people reading one board must not disagree about whether the fleet is
running. The state is one file, `.plot/state/fleet-controls.json`, read by every
board process on every render and written back through a new
`POST /api/fleet-controls`. A `localStorage` implementation would let two tabs
hold two answers, which is exactly the failure that makes this subject matter.

It lives in `.plot/state/`, beside the pulse the scan already writes there and
gitignored for the same reason — **not** in `CLAUDE.md`, since teaching the
board to edit a human-authored file would make a checkbox arrive in a commit.
`## Plot Config` supplies the DEFAULT at startup and nothing more: the switch
defaults **off** (`Auto-dispatch`) and the cap **3** (`Parallel agents`).

The stepper is a real `spinbutton`, not two buttons beside a label, and it
**refuses to go below 1** — a cap of zero is a stopped fleet expressed as a
number, which the switch already says better. Both controls are keyboard
reachable with their state announced; the spinbutton adjusts on ArrowUp /
ArrowDown and reads its value and bounds through `aria-valuenow` /
`aria-valuemin` / `aria-valuetext`. The floor is enforced at the server write as
well as in the UI, so a value reaching the endpoint by any door still lands
legal.

The endpoint refuses a cross-origin write exactly as `/api/dispatch` does — the
loopback gate applied in the router and the same-origin check IMPORTED from
`dispatch.ts` rather than restated, so a second copy of a security decision is
not a second place for it to be weakened. It is a partial write returning the
resulting state: the switch and the stepper POST independently, each naming only
the field it changes, and the response is the resulting controls — the
`/api/claim` contract, never a bare acknowledgement.

**Nothing dispatches.** A switch that is on starts no agent in this wave; it
records an intention wave 3 (*an eligible wave starts itself*) reads. Turning
either control off is a promise about the FUTURE only — it never signals a
running worker, whose home is the agent panel. A test pins that the switch
reaches `/api/fleet-controls` and never `/api/dispatch`.

Scope: this is wave 2 of *approval hands the work to agents*. It builds the two
controls and their shared state on top of wave 1's live registry, and it
dispatches nothing — the dispatch loop is wave 3.

<!--
bumps:
  skills:
    plot: minor
-->
