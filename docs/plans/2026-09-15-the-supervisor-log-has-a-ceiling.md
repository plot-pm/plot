# The supervisor log has a ceiling

> `registryd.log` reached 69 MB and 1.5 million lines in seven days, re-emitting a branch list nothing reads, and nothing rotates it because launchd owns the write.

## Status

- **State:** Draft
- **Type:** infra
- **Issue:** #916
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The supervisor's log stops growing without bound. It reached 69 MB in seven days re-emitting a branch list the daemon rebuilds every tick, and nothing rotated it.

<!-- Board impact: none. The unit template and what the daemon prints. No plan
     format, no template, no layout. -->

## Design

**Measured 2026-09-15 on this machine**, and re-measured while drafting:

| | |
|---|---|
| Size | **69 MB** (64 MB when #916 was filed) |
| Lines | 1,527,602 |
| Oldest entry | 2026-09-08 — **7 days** |
| One branch name repeated | 7,086× |
| `board.log` beside it | **16 KB** |
| Registryd CPU over 3.5 days | 3 min 52 s |

**`board.log` is the control.** Same machine, same period, same kind of process —
16 KB against 69 MB. The daemon is not busy; it is verbose.

### The content is not state

**The registrar rebuilds the branch list every tick**, so the whole file can be
deleted without losing anything. It is a re-emission, not a record — which is
what makes a ceiling safe rather than a trade against forensics.

**And it is already invisible.** `.plot/logs/` is gitignored, so the file never
appears in `git status` and nobody finds it without going looking. **Seven days
of growth took a person noticing a disk.**

### launchd owns the write, and that is the constraint

`skills/plot/units/com.plot-pm.registryd.plist:71` sets `StandardOutPath` with
`KeepAlive: true`. **The write is launchd's, not the program's** — so nothing in
the daemon can rotate a file it does not open, and a rotation script would be
racing a writer that never closes its handle.

**So the fix is at the source rather than the sink:** the tick stops re-emitting
a list nothing reads. A quieter daemon needs no rotation, and a rotation on a
noisy one is a second mechanism maintaining the first.

**A ceiling on the file is the fallback, not the plan.** If a per-tick line is
still wanted, `plot-fleetctl.sh` already owns the unit and could truncate on
`--start` — but that repairs a symptom once per restart, and this daemon runs for
weeks.

### What a tick should say

**One line per tick already exists and is the right shape** — the counted summary
`/plot-fleet --once` prints, which names every hold and its reason. **The branch
lists under it are `--once`'s**, for a person reading one tick deliberately, and
the looping daemon prints the counts and stops there.

**That is documented behaviour the daemon is not following**, so this is a plan
about honouring an existing rule rather than inventing a quieter one.

### What this does not do

**It does not delete the existing file.** That is an operator's call on their own
disk, and a plan that deleted 69 MB of someone's log to prove a point would be
the wrong kind of fix. The repair is stated; the existing file is named.

**It does not touch `board.log`.** At 16 KB it is the control, not a problem.

**It does not change `--stop`.** The ticket's second half — *"`--stop` cannot
reach a detached supervisor"* — is a separate defect with a separate cause, and
bundling them would put a log fix and a process-control fix in one slice.

## Open Questions

- [ ] **Does the daemon keep a per-tick line at all?** The counted summary is
  useful at one per 60 s (≈1,440/day, a few hundred KB/year); the branch lists
  are what multiply it. **Does not block:** either way the lists go.

## Slices

### The supervisor log has a ceiling (Branch: infra/the-supervisor-log-has-a-ceiling)

- `infra/the-supervisor-log-has-a-ceiling` — have the looping daemon print the counted tick summary without the per-branch lists, leaving `--once`'s output unchanged

**Done when** a looping tick prints **no per-branch list**, pinned by a test
asserting the line count per tick is bounded rather than proportional to the
branches held; **`--once` output is byte-identical**, pinned explicitly, because
that is the path a person runs deliberately and its lists are the reason to run
it; the counted summary **keeps every key it has today** — `held`, `no-brief`,
`not-claimable` and the rest — pinned by a key-set assertion, since a `no-brief=0`
is a measurement and a missing key is not; a tick that **cannot complete** still
reports its reason, unchanged; and `pnpm run test:contracts` passes.

**Not in the gates:** the existing 69 MB file. Its removal is an operator action
on their own disk and this plan names the command rather than running it.

## Notes

**Filed as #916 with the measurements**, re-verified while drafting — the file
had grown another 5 MB.

**The ticket's second half is deliberately out of scope.** *"`--stop` cannot
reach a detached supervisor"* is a process-control defect; I hit it today, and it
deserves its own plan rather than a ride on a log fix.

**`board.log` at 16 KB is the strongest evidence.** Two long-lived daemons, one
machine, one week: the difference is what they print, not what they do.
