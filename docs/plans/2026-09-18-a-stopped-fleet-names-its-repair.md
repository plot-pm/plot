# A stopped fleet names its repair

> `--status` tells three states apart in prose and hands the board one bit, so a unit launchd was never told about is reported as no unit at all — and the board prints the repair that cannot fix it.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The board says which kind of stopped a fleet is. A unit that was filled and never loaded is reported as interrupted, with `launchctl bootstrap` beside it, rather than as a machine with no unit at all.

<!-- Board impact: one domain rule gains a state, its verdict gains a case, and
     the banner renders what it already renders. No plan format, no template,
     no layout. -->

## Design

**This is a follow-on, not a regression report.** `the-supervisor-is-loaded-or-it-is-reported`
shipped in **v2.16.0** and its slice `bug/the-board-says-the-fleet-is-stopped`
is why the banner says `FLEET STOPPED` at all — replacing a `supervisor unknown`
chip that hid a real outage for hours on 2026-09-09. The banner is working as
designed. What is missing is the state that plan's own `--status` slice added
and the board never learned.

### The script knows three answers; the board receives one bit

`plot-fleetctl.sh --status` prints three different things for a supervisor that
is not running:

| `fleet_install_state` | what `--status` prints | the repair |
|---|---|---|
| `running` | `supervisor: running (pid N)` | — |
| `interrupted` | `NOT LOADED — the unit is installed and launchd does not know it` | `launchctl bootstrap gui/$(id -u) <unit>` |
| `installed` | falls into `*)` — **reported as "not installed"** | — |
| `not-installed` | `not installed — no unit on this machine` | `/plot-fleet --start` |

The status arm ends `supervisor_loaded; exit $?` — **one bit**. So the board
receives `exitCode: 1` for all three non-running cases and
`supervisorState` (`rules/supervisor-reading.ts`) answers `down` for each.

The banner then reads *"The fleet is stopped … Start it: /plot-fleet --start"*.
For `interrupted` that is **the wrong repair**, and the script's own comment
says so five lines above the exit:

> *"an operator who reads *not loaded* and runs `--start` on a machine whose
> unit is already filled pays for the wrong repair, and on one already running
> agents may add more."*

### The gap was named in the source and never built

The same comment ends:

> *"THE EXIT CODE AND THE `summary:` LINE ARE UNCHANGED … this widens the PROSE
> and nothing a machine reads. What renders the third state on the board belongs
> to `bug/the-board-says-the-fleet-is-stopped`."*

That branch shipped — and it shipped the **banner**, not the third state. No ref
by that name survives and no plan carries it as unfinished. **This plan is the
part the sentence promised.**

### `installed` is a fourth answer with no arm of its own

`fleet_install_state` returns four values. `--status` has a `case` with two arms:
`interrupted)` and `*)`. So `installed` — a filled unit whose start marker
exists, meaning a `--start` that did finish — prints *"not installed … no unit
on this machine"*, which is false on its face.

This is a smaller defect than the missing bit and it is in the same three lines,
so it is fixed here rather than filed separately.

### What this is NOT

**Not a timeout.** `readSupervisor` (`board/src/server/supervisor-reading.ts:90`)
budgets `SUPERVISOR_TIMEOUT_MS = 5_000` and the adapter **rejects** on expiry
(`scripts-shell.ts:147`), so the catch returns `{asked: false}` → state
`unknown` → *"fleet status unknown … This is not the same fact as it being
stopped."* That path is correct and is not what produced the wrong banner.

The latency was measured twice on one machine: **4726–9770 ms with three agents
running, 820–3173 ms with one.** The budget is exceeded under load, and when it
is the board says `unknown`, which is the honest answer. **A budget that load can
exceed is worth revisiting and it is not this plan** — one plan per defect, and
conflating them would let a latency argument decide a correctness fix.

**Not the banner's wording.** `supervisorVerdict` deliberately says *fleet* and
never `supervisor`, `registryd` or the launchd label, because
*"the board is the one surface where a reader should meet none of them."* A
third state keeps that rule: it names a consequence and a repair, not a
component.

## Slices

### The reading carries which stopped (Branch: bug/the-reading-carries-which-stopped)

- `bug/the-reading-carries-which-stopped` — `--status` reports its install state on a line a machine reads, `SupervisorRun` carries it, and `supervisorState` answers a fourth value

**Done when** `--status` emits the install state in its `summary:` line — the
line whose presence `readSupervisor` already tests — so the board learns it
without a second call; **the exit code is unchanged**, 0 loaded and 1 not, since
it is the board's contract and three callers read it; `installed` gains its own
prose arm and stops being reported as *"no unit on this machine"*; `SupervisorRun`
carries the state as an **optional** field, so a board reading an older script
behaves exactly as today; `supervisorState` answers `down` when the field is
absent, pinned by a test; and `pnpm run test:contracts` passes.

### The banner names the repair (Branch: bug/the-banner-names-the-repair)

- `bug/the-banner-names-the-repair` — `supervisorVerdict` gains the interrupted case, and the board renders its own repair

**Done when** an interrupted fleet renders a banner naming `launchctl bootstrap`
— or the platform's equivalent — rather than `/plot-fleet --start`, pinned by a
unit test on `supervisorVerdict` and one browser test that the badge shows it;
the `down` and `unknown` banners are **byte-identical** to today, pinned, since
this adds a case and changes none; the new sentence names a consequence and a
repair and mentions no component, the rule `supervisor-reading.ts` states for
every other label; the agent count is carried into it as the existing `down`
sentence does; and the board suite passes.

## Notes

**My first diagnosis was wrong and is recorded because it cost an hour.** I read
the 5,000 ms budget against a 9.8 s measurement and concluded the banner came
from a timeout. Every timeout path leads to `unknown`, not `down` — the adapter
rejects, the catch fires, the third state exists precisely for this. The cause
was the exit code on a **completed** run, which only appeared after reading the
status arm's last two lines: `supervisor_loaded; exit $?`.

**The latency reading halved within the hour** as agents finished. A plan resting
on it would have repeated `a-connector-declares-its-ceiling`'s rejection, where
three versions rested on one sample of a self-evicting field.

**`plot-fleetctl.sh:375` and `:388` also `exit 1`**, from `--once` and `--start`.
Neither is reached by `--status`, and the board asks only `--status`.
