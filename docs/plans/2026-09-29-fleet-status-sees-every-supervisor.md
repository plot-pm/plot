# Fleet status sees every Plot process on the machine

> `--status` asks about one supervisor. The scans that starve the board are spawned by BOARDS, three of them from three installations, and nothing on the estate asks what else is running here.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Issue:** #1080
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- `/plot-fleet --status` names every Plot supervisor AND every Plot board running on this machine, with the checkout each one serves and how many scans each has in flight.

Board impact: none. This is fleet control's status output.

## Motivation

Measured 2026-09-29, while an operator reported the board dead. This checkout's `--status`:

```
supervisor: running (pid 8411) — com.plot-pm.registryd
  serves:  THIS repository (/Users/jwloka/Quatico/Agentic-Tools/plot)
summary: agents_running=1 agents_other=3 supervisor=up
```

and the machine:

| reading | value |
|---|---|
| `plot-fleet-scan.sh` processes | **17**, from five installations |
| `plot-host.sh pr-list` processes | **27** |
| load average | **11.48**, later 17.14 |
| `/api/board` | 4.5 s |
| `/api/fleet` | timed out at 90 s; the board served a stale pulse |

A board serving its last good pulse reads to an operator exactly like a board that has died.

### The scans come from BOARDS, and this plan was first written about supervisors

**Round 1 refuted the plan's causal claim by tracing process ancestry.** The plan said the load was the second supervisor's and that *"17 scans from five installations is a symptom of the supervisors."*

```
40506<-77823<-66504     66504 = board-server.mjs  (plugin marketplace)
41402<-82707<-46011     46011 = board-server.mjs  (plugin cache 2.21.0)
```

**No scan descends from any supervisor.** Both supervisors have **zero children**. Three `board-server.mjs` processes are running, from three installations:

| pid | installation |
|---|---|
| 43308 | `.worktrees/free-28240a09/` |
| 46011 | `~/.claude/plugins/cache/plot-marketplace/plot/2.21.0/` |
| 66504 | `~/.claude/plugins/marketplaces/plot-marketplace/` |

**The supervisors were visible and plausible and they are not the spender.** The plan's own line — *"counting processes would be a second, noisier reading of the same fact"* — was wrong twice: it is not the same fact, and it is the fact.

**So the subject is every Plot process, not every supervisor.** A status naming two supervisors and omitting three boards would have sent an operator to stop the wrong thing.

### The existing readings are each correct and each scoped to one label

**#1051** gave each checkout its own launchd label; **#1048** made `--status` name the checkout a supervisor serves; **#1053** (merged during this panel) made the systemd unit name follow the label, so `UNIT_NAME` now exists and the nine hardcoded `plot-registryd` sites are gone.

All three answer *about my supervisor*. `serves_line` is called at `:456` and `:478`, both for `$LABEL`. **None is defective and none is machine-scoped.**

### The prefix is not a convention, and enumerating by it re-hides the thing

The plan first proposed enumerating labels by the default prefix, calling a non-prefix label *"a stated limit rather than a silent one"*.

`plot-fleetctl.sh:84` is `LABEL="${PLOT_FLEET_LABEL:-com.plot-pm.registryd}"` — **any string, no validation, no warning.** The "convention" is one worked example in `units/README.md:69-72` (the plan cited `:67`, which is a closing code fence). An operator who types `com.quatico.ewz.registryd` — this operator's own namespace everywhere else — gets a second supervisor that is invisible **again**, now with a status line claiming it looked.

**So enumeration is by PROCESS, not by label.** `pgrep -f` over the two artifact names finds every Plot process whatever it was labelled, and a label is then read from the process rather than guessed at.

## Design

### The rule

**`--status` reports every Plot process on the machine — supervisors and boards — and marks which are this checkout's.**

The existing block is unchanged and stays first. A second block follows only when a Plot process other than this checkout's supervisor is running.

```
supervisor: running (pid 8411) — com.plot-pm.registryd
  serves:  THIS repository (/Users/jwloka/Quatico/Agentic-Tools/plot)
  …

others on this machine:
  supervisor  com.plot-pm.registryd.ewz-kus-portal  (pid 27932)  /Users/jwloka/Quatico/ewz/ewz-kus-portal
  board       (pid 66504)  ~/.claude/plugins/marketplaces/plot-marketplace   scans in flight: 5
  board       (pid 46011)  ~/.claude/plugins/cache/plot-marketplace/2.21.0   scans in flight: 4
  board       (pid 43308)  .worktrees/free-28240a09                          scans in flight: 0
```

**Silent when this checkout's supervisor is the only Plot process.** A line reading `others: none` on every single-checkout machine is noise on the common case.

### Scans in flight is the number that explains the load

A board with 5 scans in flight is the finding; a board with 0 is background. **This is the reading the first draft explicitly refused** as *"a second, noisier reading"*, and the ancestry measurement is why it is now the point: without it the output names three boards and does not say which is costing anything.

Count by parentage — `pgrep -P <board pid>` and its descendants — never by a global `pgrep -f plot-fleet-scan`, which cannot attribute.

### Enumeration is by process, not by label

```
pgrep -f 'board/plot-registryd\.mjs'   → every supervisor, whatever its label
pgrep -f 'board/board-server\.mjs'     → every board
```

Then per process: its `cwd` through `lsof -a -p <pid> -d cwd` (macOS) or `/proc/<pid>/cwd` (Linux), which is the checkout it serves and needs no label at all.

**A supervisor's label is still reported where it can be read**, from `launchctl list` matched by pid rather than by prefix — so `com.quatico.ewz.registryd` is named like any other. The label is a detail *about* a found process, never the way one is found.

**`lsof` may be absent or refuse**, and a process whose cwd cannot be read is named with that as its answer rather than omitted.

### The platform difference shrank while this plan was being judged

The first draft specified a launchd label enumeration and a systemd unit-name glob, and a juror found the systemd half rested on a broken premise: `$LABEL` reached none of the nine hardcoded `plot-registryd` sites.

**#1053 merged during the panel and removed them** — `UNIT_NAME` now derives from the label on both platforms.

**Enumerating by process makes the point moot anyway.** `pgrep -f` over the two artifact names is the same command on both platforms; only the cwd reading differs (`lsof` against `/proc`). That is one documented branch instead of two enumeration strategies, and the Linux arm is the one CI can actually assert.

### What this does NOT do

- **It does not coordinate spend.** Two supervisors sharing a budget is #1069's territory and a larger question; this makes the situation visible, which is the precondition for it and not a substitute.
- **It does not change `--start`'s refusal.** That already names an already-loaded label and its checkout (`plot-fleetctl.sh:681-696`), correctly, for `$LABEL`.
- **It does not touch `--stop`.** One stop rule, one label.
- **It does not count scans or processes.** 17 scans from five installations is a symptom of the supervisors; enumerating processes would be a second, noisier reading of the same fact.

## Done when

- **With three boards and two supervisors running, `--status` names all five**, asserted against stubbed process listings. Measured on this machine: the shipped `--status` names one of the five.
- **Each named process carries its checkout**, read from its cwd and not from a label. A process whose cwd cannot be read is named with that as its answer, never omitted.
- **Each board carries its scans in flight, counted by parentage.** A global `pgrep -f plot-fleet-scan` cannot attribute and must not be used — that number is what separates the board causing the load from the two that are idle.
- **A supervisor whose label shares no prefix with the default is still found.** `com.quatico.ewz.registryd` is the case: `plot-fleetctl.sh:84` validates nothing, so a prefix enumeration re-hides exactly what this plan exists to show, while printing a status line that claims it looked.
- **With only this checkout's supervisor running, the output is byte-identical to today's**, asserted. The common case must not get longer.
- **The Linux cwd arm reads `/proc/<pid>/cwd` and is asserted on the ubuntu runner**, where the `lsof` arm cannot be. The enumeration itself is one `pgrep` on both.
- `node --test test/reconcile/fleetctl.test.mjs` stays green — 67 tests as of #1078. Any assertion that changes is named rather than renumbered.

## Slices

### Fleet status sees every Plot process on the machine (Branch: bug/fleet-status-sees-every-supervisor)

Enumerate supervisors and boards by process, resolve each checkout from its cwd, count each board's scans by parentage, print a second block only when there is something to report.

## Notes

**This is what #1048 could not become.** That plan's design section argued correctly that nothing needs adding to the unit — only reading from it — and built the per-label reading this reuses whole. What it could not do is find a label nobody told it about, and that limit was not visible until two supervisors ran at once on one machine.

**The operator found the fault before the tooling did.** The report was *"board seems again dead"*, and the board was answering in 4.5 s. Every component was behaving correctly and the machine was saturated; the missing thing was a reading whose scope matched the problem's.

### Round 1, 2026-09-29

One juror, **amend**, **executed**. Verdict: `.plot/panels/2026-09-29-fleet-status-sees-every-supervisor/premise.md`.

**The causal claim was refuted by process ancestry.** The plan blamed a second supervisor; no scan descends from either supervisor, both have zero children, and the scans are spawned by **three boards** from three installations. The symptom was measured correctly and the mechanism was inferred from co-occurrence — the estate's named failure mode, reproduced by the plan's own author.

The subject is therefore every Plot process rather than every supervisor, and **scans in flight** — the reading the first draft refused as noise — is the number that identifies the spender.

**The prefix enumeration was refused too.** `plot-fleetctl.sh:84` validates no label, and the "convention" is one example in a README paragraph (cited at `:67`, which is a code fence; the example is at `:69-72`). An operator typing `com.quatico.ewz.registryd` would be invisible again, under a status line claiming it looked. Enumeration is now by process.

**One finding was overtaken during the panel.** The juror showed the systemd arm rested on nine hardcoded `plot-registryd` sites that `$LABEL` never reached. #1053 merged while the panel ran and `UNIT_NAME` now derives from the label on both platforms. The finding was correct when written.
