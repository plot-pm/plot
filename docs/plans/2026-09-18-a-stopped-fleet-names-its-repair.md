# A stopped fleet names its repair

> `--status` tells five states apart in prose and hands the board one bit, so a supervisor that died on its own is reported as a machine that never had one.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Rounds:** 1
- **Impl:** own branches

## Changelog

- The board says which kind of stopped a fleet is. A supervisor that died unattended is reported as such rather than as a machine with no unit at all, and it is announced loudly while agents are still running.

<!-- Board impact: a domain rule gains a state, the wire schema's enum gains a
     member, and a DOM attribute gains a value. No plan format, no template. -->

## Design

**This is a follow-on, and the gap was diagnosed eight days ago.** Commit
`6dcb3f6b5` (2026-09-10) named it in a brief, with these line numbers:

> *"The board cannot tell NOT LOADED from not installed: #869 split the two in
> `plot-fleetctl.sh --status` at :319 and :328, but `supervisor-reading.ts`"*…
> **"A gap the merged slice opened, and it is NOT yours to close."**

The brief told its worker to file an amendment. **Nobody did**, and the defect
sat for eight days. That routing failure is worth recording: a diagnosis made
inside a brief reaches one agent and no index.

### The script knows five answers; the board receives one bit

`--status` prints five different things, and `supervisor_loaded` at `:364`
decides the exit code for all of them:

| state | what `--status` prints | is the board's `--start` right? |
|---|---|---|
| running | `supervisor: running (pid N)` | — (exit 0) |
| interrupted | `NOT LOADED — the unit is installed and launchd does not know it` | **yes** |
| installed | falls into `*)` — **reported as "not installed"** | yes, but it hides a crash |
| not-installed | `not installed — no unit on this machine` | yes |
| **platform: none** | `no init system here — neither launchd nor systemd` | **no — `:406` refuses** |

The status arm ends `supervisor_loaded; exit $?` — **one bit**. So four
different machines all reach `supervisorState` as `down`.

### `installed` is the one that lies, and this plan's subject

**An earlier draft of this plan led with `interrupted` and claimed the board
prints "the repair that cannot fix it". That is false.** `--start`'s refusal 4
fires only when the supervisor is **already loaded** (`:416`), which
`interrupted` by definition is not — so `--start` proceeds, rewrites the unit,
and runs `launchctl bootstrap` itself (`:493`). The script says so three lines
below the passage that draft quoted:

```
echo "  Nothing needs re-cutting: /plot-fleet --start also does this, and starts agents too."
```

The comment's *"pays for the wrong repair"* means *pays more than necessary*,
not *cannot work*. **The draft read one line short and built two slices on it.**

What survives is narrower and worse. `installed` means the start marker exists
and the supervisor is not loaded — `--stop` removes the marker only after a
successful unload (`:640`), so this state is reached when a completed `--start`
was followed by the supervisor **dying or being booted out on its own**: a
crash, a logout, an OS update.

That machine reads *"not installed — no unit on this machine"*, which is false
about the machine and hides an unexplained death. An operator told *not
installed* does not think to open `.plot/logs/registryd.log`, and a
crash-looping supervisor will crash again after `--start`.

### `platform: none` prints a repair that is refused

The `none` arm at `:297` returns before `fleet_install_state`'s `case`, so the
state machine never sees it, and `supervisor_loaded` falls through to
`return 1`. The board then prints `/plot-fleet --start` on a machine where
`:406` refuses by design — *"REFUSAL 3 — no init system to hand the daemon
to."* **That is the "wrong repair" the earlier draft claimed for `interrupted`,
in the one state where it is real.** No test covers it, and it is reachable by
construction rather than measured here.

### What this is NOT, and the retraction the panel corrected

**Not only a timeout — but a timeout DOES produce `down`.** An earlier draft
claimed every timeout reaches `unknown` because the adapter rejects, citing
`scripts-shell.ts:147`. **Both halves are wrong.** That line is inside `stream`,
which `readSupervisor` never calls; `readSupervisor` uses `awaited` →
`runProcess` (`run-script.ts:60`), which binds **only `resolve`** and states
*"Never throws for a non-zero exit."*

Reproduced 2026-09-18 with `execFile`'s own derivation:

```
{"derivedCode":1,"killed":true,"signal":"SIGTERM","summarised":true}
-> supervisorState => down
```

So what keeps a timeout out of `down` is **`summarised`**, not a rejection: the
`summary:` line is the script's last, so a killed run has usually not printed
it. *Usually* — a kill after that line flushes gives `code:1, summarised:true`,
which is `down`.

The latency was measured twice: **4726–9770 ms with three agents, 820–3173 ms
with one**, against a 5,000 ms budget. **The budget is not this plan's** — one
plan per defect — but the timeout path is no longer claimed to be harmless.

**Not a banner rewrite.** `supervisorVerdict` deliberately says *fleet* and
never `supervisor`, `registryd` or the launchd label, because *"the board is the
one surface where a reader should meet none of them."* **An earlier draft
proposed printing `launchctl bootstrap`, which is all three forbidden
vocabularies at once.** The board prints `/plot-fleet --status`, which is a
command a reader can address; machine vocabulary stays where a machine reads it.

## Slices

### The reading carries which stopped (Branch: bug/the-reading-carries-which-stopped)

- `bug/the-reading-carries-which-stopped` — `--status` reports its install state on the `summary:` line, `SupervisorRun` carries it, and `supervisorState` answers a fourth value

**Done when** `--status` emits the install state **on** the `summary:` line —
not beside it and not before it, because that line's *presence* is what
`readSupervisor` tests for `summarised` and moving the field would weaken the
`unknown`/`down` split; the appended `key=value` cannot break
`stdout.includes('summary:')`, which is a substring test; **the exit code is
unchanged**, 0 loaded and 1 not, since `supervisorState` gates on exactly those
two values; `installed` gains its own prose arm and stops being reported as *"no
unit on this machine"*; the `platform: none` arm reports its state too, or the
slice names why not; `SupervisorRun` carries the state as an **optional** field
so a board reading an older script behaves exactly as today; `supervisorState`
answers `down` when the field is absent, pinned; and `pnpm run test:contracts`
passes.

### The banner names what died (Branch: bug/the-banner-names-what-died)

- `bug/the-banner-names-what-died` — `supervisorVerdict` and `supervisorProminence` gain the case, the wire schema and the DOM attribute gain the value

**Done when** a fleet whose supervisor died unattended renders a banner saying
so and pointing at `/plot-fleet --status`, naming **no** launchd vocabulary;
**`supervisorProminence` returns `alert` for the new state when agents are
running** — the same rule `down` already has, because `quiet` renders grey with
no `role="alert"` and **does not render the detail sentence at all**
(`FleetControls.tsx:387`), which is the exact failure that cost an hour on
2026-09-09; `SupervisorSchema`'s `z.enum(['up','down','unknown'])`
(`schema.ts:3519`) gains the member, **without which the server's own parse
fails** — the client casts, so this enum is the only guard and it is on the
server side; the `data-fleet-supervisor-state` attribute
(`FleetControls.tsx:360`) carries the new value, and any test or selector keyed
on `"down"` is checked against it; the `down` and `unknown` banners are
**byte-identical** to today, pinned; and the board suite passes.

## Notes

**Three lenses, three `amend`, and the plan was rewritten rather than patched.**
Record at `.plot/panels/2026-09-18-a-stopped-fleet-names-its-repair/`. The
operator lens refuted the subtitle, the cause lens refuted the retraction, and
the contract lens found four touchpoints neither slice named. Each was verified
against the source before it was written in.

**Two wrong diagnoses are recorded here because both were mine.** The first
blamed the timeout budget; the second retracted it with a mechanism that does
not exist on this code path. The truth is both paths reach `down`, and only
reading `runProcess`'s promise constructor settles it.

**One machine reader of the exit code, not three.** An earlier draft said
*"three callers read it"*. `readSupervisor` (`supervisor-reading.ts:88`) is the
only code that branches on it; `plot-fleet/SKILL.md:97` invokes `--status` for a
person. The decision to keep the code unchanged is right regardless.
