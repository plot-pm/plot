## Implementation brief — the-supervisor-is-loaded-or-it-is-reported (Finishing slice)

- **Plan (canonical):** `docs/plans/2026-09-09-the-supervisor-is-loaded-or-it-is-reported.md` on `main`
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #864 merged
- **Branch:** `bug/a-fleet-start-records-that-it-finished` (base: `main`)
- **Ends as:** one PR to `main`

**Two slices wait on you:** `bug/the-board-says-the-fleet-is-stopped` and `feature/the-working-header-separates-doing-from-reading`. Both render states this slice defines.

### What to build

`--start` records that it finished, and `--status` names three states instead of two.

**The measured failure:** the fleet was stopped for hours on 2026-09-09 and nothing said so. `launchctl list` showed no `com.plot-pm.registryd` while `~/Library/LaunchAgents/com.plot-pm.registryd.plist` sat on disk, correct and 5344 bytes. One command restored it:

```
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.plot-pm.registryd.plist
→ 81406  0  com.plot-pm.registryd
```

### The decisions the plan settles — do not re-derive them

**IT DID NOT CRASH, and the unit is not at fault.** `KeepAlive` is unconditional and launchd honours it — a crashed supervisor returns in 60 s (`ThrottleInterval`). **Do not touch the unit template.** Every finding here is about the window *before* launchd is told.

**The cause is a non-atomic `--start`.** It fills the unit, verifies it, bootstraps at `plot-fleetctl.sh:361`, then starts agents at `:382`. **Cutting agent desks is the slow part** — each is a `git worktree add` — and a run interrupted there leaves a state with no name: unit present, launchd unaware, agents partly started. Measured twice in one session.

**The bootstrap-before-agents order is RIGHT.** Do not reorder it: a supervisor with no agents does nothing, but agents with no supervisor are worse, and `--stop` unloads the supervisor LAST for the same reason. What is missing is a record that the run finished.

**A completion marker, not a lock file.** A lock says *a run is in progress* and answers wrongly for a run that died. The question is *did the last run finish*. `plot-estate-changed.sh` makes the same distinction — *"a clock would answer 'was it recent?' when the question is 'did it change?'"*. **Absent is the signal**: no timer, no heuristic, and no need to tell a kill from a crash.

**Read the marker TOGETHER with the unit file — that resolves the fresh-clone case.** `.plot/state/` is machine-local and gitignored, so a machine that never ran `--start` has no marker either:

| unit file | marker | state |
|---|---|---|
| absent | absent | **not installed** → `/plot-fleet --start` |
| present | absent | **interrupted** → one `launchctl bootstrap` |
| present | present | installed |
| loaded | — | running |

Two readings, four states, nothing to guess.

**`--status` prints the repair.** The two failures are indistinguishable to a reader and different in cost — an operator who reads *not loaded* and runs `--start` pays for the wrong repair, and on a machine already running agents may add more. `plot-fleetctl.sh`'s four existing refusals each name their own repair; this extends that to the state it currently collapses.

**`--status` STILL STARTS NOTHING, in all four states.** *"A status that started what it was asked about could never report an absence."* Do not add a bootstrap to it.

**`--start` on an unloaded, verified unit bootstraps rather than re-cutting desks** — but **never bootstraps a unit it did not verify this run**. A plist of unknown provenance is what `plutil -lint` and the `__PLACEHOLDER__` check exist to refuse, and *"an installed unit does not update itself"* — a stale unit baked with the wrong `$NODE` fails long after anyone is watching.

**Not chosen: a watchdog process.** It has the same failure mode one level up, and the machine already has a supervisor-of-last-resort — launchd, with `KeepAlive` — which works whenever it has been told. The defect is never telling it.

### Done when

- **A `--start` interrupted during agent creation leaves no completion marker** — the measured failure, reproduced.
- **`--status` says NOT LOADED and prints the one-line bootstrap** when a unit exists and launchd does not know it — the state that read as *not installed* for hours.
- **`--status` starts nothing**, in every state.
- **`--start` on an unloaded verified unit bootstraps rather than re-cutting desks**, and refuses a unit it did not fill this run.
- **A machine with no unit and no marker reads *not installed*, not *interrupted*** — the fresh-clone case.

Plus the repo gates: `nvm use` (Node 24), `corepack pnpm install`, `corepack pnpm test`, `corepack pnpm run test:reconcile`. Add a changeset (`'plot': patch`, description FIRST, `bumps:` block LAST, with a `plan:` line). **Do not run `pnpm run test:e2e`** — CI's gate.

**Careful with the live fleet.** A supervisor is loaded on this machine right now. Test against a filled-but-unloaded unit under a **different label**, never by unloading the running one — `--stop` ends work in flight and is a person's call.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main` — check `git branch --show-current` is `main` first. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-fleetctl.sh` — the `--start` completion marker and the `--status` states.

**Do not touch:** `skills/plot/units/` (the templates are correct), the board's rendering (that is `bug/the-board-says-the-fleet-is-stopped`), or the WORKING header (that is the third slice).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
