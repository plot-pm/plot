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
- **Rounds:** 1

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

### Rotation is possible, and an earlier draft said it was not

`com.plot-pm.registryd.plist:71-72` does set `StandardOutPath` — **but that is
the unit template, and it is not what is writing this file.** Measured
2026-09-15: the running daemon reaches the log by another route, so *"launchd
owns the write, therefore nothing can rotate it"* is **false**, and this plan no
longer rests on it.

**The fix is still at the source, for a better reason:** a rotation keeps a
file's size down while the daemon goes on emitting lines nobody reads, and then
needs its own maintenance. **A quieter tick needs no second mechanism.** Rotation
remains available as a complement and this plan does not add one.

### The volume is TWO re-emissions, not one

**Measured over all 1,585,949 lines, classified by shape:**

| Class | Lines | Bytes | Share |
|---|---:|---:|---:|
| held-slice enumeration | — | — | the bulk |
| **`unclaimedLines` desk report** | 38,174 | 7,132,536 | **10.26%** |

**An earlier draft named only the first.** `unclaimedLines`
(`registryd.ts:376-391`, printed at `registryd-main.ts:843`) re-emits worktree
paths every tick: `/private/tmp/plot-baseline` **2,539×**, `.worktrees/free-b2023483`
**6,413×**. Its own comment at `:836-839` justifies the volume — *"the unclaimed
trees were twelve at their worst … so a looping daemon can name each one without
ever writing a line nobody wants"* — and **7.1 MB falsifies that justification**.

**So the plan fixes both, or it ships a ceiling that leaks.** Gating only the
held block drops the log to ~9.5 MB and leaves the second source re-emitting nine
scratchpad paths a minute under a comment promising it does not.

### Not all five hold classes are noise, and the plan must not delete them alike

**`not-claimable` is a hold over the WHOLE estate's backlog** — every branch no
plan makes claimable, 165→~200 branches, re-enumerated **7,333 times**. That one
class is the volume.

**The other four are holds over the QUEUE** — small, churning, and exactly what a
debugger wants at 3am. **An earlier draft proposed deleting all five to fix one.**

**The counted summary keeps every key**, so a reader still learns that 233 slices
were held and why. What goes is the per-branch enumeration of the estate-wide
class, not the queue's own holds.

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

**Done when** a looping tick's output is **bounded rather than proportional to
the estate**, pinned by a test that grows the held-branch count and asserts the
line count does not follow; **`unclaimedLines` is bounded by the same rule**,
pinned separately — it is 10.26% of the bytes and an earlier draft missed it, so
gating only the held block ships a ceiling that leaks; **the four queue-level
hold classes still name their branches**, pinned explicitly, because they are
small, they churn, and they are what a debugger reads — only the estate-wide
`not-claimable` enumeration goes; **`--once` output is byte-identical**, pinned,
since that is the path a person runs deliberately; the counted summary **keeps
every key it has today**, pinned by a key-set assertion, since a `no-brief=0` is
a measurement and a missing key is not; a tick that **cannot complete** still
reports its reason, unchanged; and `pnpm run test:contracts` passes.

**Not in the gates:** the existing 69 MB file. Its removal is an operator action
on their own disk and this plan names the command rather than running it.

## Notes

**Filed as #916 with the measurements**, re-verified while drafting — the file
had grown another 5 MB.

**The ticket's second half is deliberately out of scope.** *"`--stop` cannot
reach a detached supervisor"* is a process-control defect; I hit it today, and it
deserves its own plan rather than a ride on a log fix.

**Amended 2026-09-15 after a two-lens panel**
(`.plot/panels/2026-09-15-the-supervisor-log-has-a-ceiling/`), unanimous `amend`.
The measurements held and two arguments did not: **launchd is not writing this
file**, so rotation was never impossible, and **the volume is two re-emissions
rather than one** — `unclaimedLines` is 10.26% of the bytes, with one worktree
path repeated 6,413 times under a comment claiming it never writes a line nobody
wants. The plan also proposed deleting five hold classes to fix one; only the
estate-wide `not-claimable` enumeration is the volume.

**`board.log` at 16 KB is the strongest evidence.** Two long-lived daemons, one
machine, one week: the difference is what they print, not what they do.
