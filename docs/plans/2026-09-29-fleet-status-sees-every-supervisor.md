# Fleet status sees every Plot process on the machine

> `--status` asks about one supervisor. The scans that load the machine are spawned by BOARDS, a board can run from an installation other than the checkout it serves, and nothing on the estate asks what else is running here.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Issue:** #1080
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2

## Changelog

- `/plot-fleet --status` names every Plot supervisor, board and top-level scan running on this machine, with the checkout each one serves and the installation it runs from, and names scans whose board no longer owns them.

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
| processes whose argv names `plot-fleet-scan.sh` | **17**, from five installations — a process count, not a scan count (see below) |
| `plot-host.sh pr-list` processes | **27** |
| load average | **11.48**, later 17.14 |
| `/api/board` | 4.5 s |
| `/api/fleet` | timed out at 90 s; the board served a stale pulse |

A board serving its last good pulse reads to an operator exactly like a board that has died.

**The 17 is not 17 scans.** Bash subshells (`$( … )`, pipelines) carry the parent's argv, so one live scan shows as four `plot-fleet-scan.sh` processes (measured 2026-09-30 on board 35248, six samples). A scan killed on timeout leaves its subtree running under pid 1. The 17 processes are some mix of both, and the reading that separates them did not exist.

### The scans come from BOARDS

Process ancestry on 2026-09-29:

```
40506<-77823<-66504     66504 = board-server.mjs  (plugin marketplace)
41402<-82707<-46011     46011 = board-server.mjs  (plugin cache 2.21.0)
```

**No scan descended from any supervisor**, and both supervisors had zero children. Three `board-server.mjs` processes ran, from three installations (`.worktrees/free-28240a09/`, `~/.claude/plugins/cache/plot-marketplace/plot/2.21.0/`, `~/.claude/plugins/marketplaces/plot-marketplace/`).

Measured again 2026-09-30 09:58, 38 minutes after a reboot, load `7.68 10.72 56.67`:

| pid | kind | installation | serves (cwd) | children |
|---|---|---|---|---|
| 10942 | supervisor `com.plot-pm.registryd` | this checkout | this checkout | 0 |
| 10931 | supervisor `com.plot-pm.registryd.ewz-kus-portal` | `~/.claude/plugins/cache/plot-marketplace/plot/2.21.0` | `/Users/jwloka/Quatico/ewz/ewz-kus-portal` | 0 |
| 35248 | board | `~/.claude/plugins/marketplaces/plot-marketplace` | this checkout | 2, one a scan |

**The scope is supervisors AND boards, and the reboot confirms it rather than weakening it.** The three-board count was a transient. Two facts held across both readings: the supervisors spawn no scans, and every scan descends from a board or from nothing. A supervisor-only status names 2 of today's 3 Plot processes and omits the one that spawns scans. Today's board also runs from an installation other than the checkout it serves, and that pair (installation and checkout) is invisible to every existing reading.

### The upstream cause belongs to #1084

`scripts-shell.ts:127` spawns `start` with `detached: true`, and the `stream` timeout at `scripts-shell.ts:158` sends `child.kill('SIGKILL')` to the top bash only. A timed-out scan's subtree reparents to pid 1 and keeps running, and the board starts the next scan. That is the most likely origin of the pile-up. **#1084 removes it; this plan makes it visible** and does not change `scripts-shell.ts`.

### The existing readings are each correct and each scoped to one label

**#1051** gave each checkout its own launchd label; **#1048** made `--status` name the checkout a supervisor serves; **#1053** made the systemd unit name follow the label, so `UNIT_NAME` derives from the label on both platforms.

All three answer *about my supervisor*. `serves_line` is called at `plot-fleetctl.sh:476` and `:498`, both for `$LABEL`. **None is defective and none is machine-scoped.**

### A label prefix cannot find a supervisor

`plot-fleetctl.sh:84` is `LABEL="${PLOT_FLEET_LABEL:-com.plot-pm.registryd}"` — any string, no validation, no warning. The only example of a per-checkout label is `units/README.md:69-72`. An operator who sets `com.quatico.ewz.registryd` gets a supervisor that a prefix enumeration does not find, under a status line that claims it looked.

**So enumeration is by process, not by label.** The label is read from the process afterwards.

## Design

### The rule

**`--status` reports every Plot process on the machine and says which checkout each serves and which installation it runs from.** A Plot process is a supervisor, a board, or a top-level scan, as classified below.

**Nothing to report** means: every Plot process found serves THIS checkout (its cwd is this repository's root), and no scan is orphaned. In that case the output is byte-identical to today's. A normal single-checkout machine — one supervisor and one board for this checkout, the board's scans in flight — is this case.

Otherwise a second block follows the existing output, after the `summary:` line. It lists every Plot process except the supervisor the first block already names. Every row carries both paths. The mockup is today's machine (2026-09-30 09:58):

```
supervisor: running (pid 10942) — com.plot-pm.registryd
  serves:  THIS repository (/Users/jwloka/Quatico/Agentic-Tools/plot)
  …
summary: agents_running=1 agents_other=1 supervisor=up install=running tick_age=6

plot processes on this machine:
  supervisor  pid 10931  com.plot-pm.registryd.ewz-kus-portal
    serves:     /Users/jwloka/Quatico/ewz/ewz-kus-portal
    installed:  ~/.claude/plugins/cache/plot-marketplace/plot/2.21.0
  board       pid 35248
    serves:     THIS repository
    installed:  ~/.claude/plugins/marketplaces/plot-marketplace
  scans       1 in flight, 0 orphaned
    serves:     THIS repository
    installed:  ~/.claude/plugins/marketplaces/plot-marketplace
```

A process whose cwd cannot be read prints `serves:     cannot determine (owner <user>)` and is never omitted.

### One snapshot, one classifier

Enumeration is ONE call: `ps axww -o pid=,ppid=,user=,args=`. One snapshot keeps the parent relations consistent, `axww` is accepted by both BSD `ps` and procps, and it lists every user's processes. An `awk` pass classifies each row:

| kind | argv[0] basename | first non-option argument |
|---|---|---|
| supervisor | `node` | a path ending `/board/plot-registryd.mjs` |
| board | `node` | a path ending `/board/board-server.mjs` |
| scan | `bash` or `sh` | a path whose basename is `plot-fleet-scan.sh` |

**Matching the interpreter and the argument position excludes every shell that only holds the string.** `bash -c '…board/board-server.mjs…'` and `zsh -c '…'` have argv[0] `bash`/`zsh` and argv[1] `-c`; `grep board-server.mjs` has argv[0] `grep`. `pgrep -f` matches all three and is not used.

**A process is reported only at top level: its parent is not a process of the same kind.** This one rule does two jobs:

- it folds a `node --watch` board and the child it supervises into one row, and the row keeps the watcher's pid — `plot-boardctl.sh --stop` already treats the pair as one board;
- it counts one scan as one process, not as the four its subshells show.

**A scan is attributed by cwd and installation, never by parentage.** cwd is inherited and survives reparenting; the installation is the scan's argv path minus `/skills/plot/scripts/plot-fleet-scan.sh`. Scans are grouped by the pair (checkout, installation) into one `scans` row per group. **A top-level scan whose ppid is 1 is orphaned**, and the row counts it separately. A board's installation is its argv path minus `/skills/plot/scripts/board/board-server.mjs`, and a supervisor's minus `/skills/plot/scripts/board/plot-registryd.mjs`. Paths under `$HOME` print with `~`.

**An installation path can hold a space** (`~/Library/Application Support/…`), so the shipped classifier matches the artifact path against the args string after argv[0] and its options, not against one whitespace-split field. The sandbox prototype below split on whitespace and does not prove this case; a Done-when fixture does.

A scan with no board above it and a live parent (a test, a manual run) is top-level, not orphaned, and is counted in its group like any other.

### Checkout, label, and the platform arms

- **Checkout (macOS):** `lsof -a -p <pid> -d cwd -Fn`, the `n` line. **Empty output means cannot determine**, whatever the exit code: for another user's process `lsof` prints nothing and exits 1, with no error text to parse. It needs no sudo for this user's launchd jobs (measured on 10931 and 10942). 0.053 s per call.
- **Checkout (Linux):** `readlink /proc/<pid>/cwd`. A failed read means cannot determine.
- **Label (macOS):** `launchctl list`, the row whose pid column equals the supervisor's pid. A pid with no row prints no label. The label is a detail about a found process, never the way one is found.
- **Label (Linux):** the unit named in `/proc/<pid>/cgroup`; no unit prints no label. Not measured on a Linux machine yet.

### Measured in a sandbox, 2026-09-30

A scratch installation with a `board/board-server.mjs` that spawns two `plot-fleet-scan.sh` scans (each holding a nested `$( … )`), started as `node --watch`; a `board/plot-registryd.mjs`; and two decoys, `bash -c 'sleep 45; : …/board-server.mjs plot-fleet-scan.sh'` and `zsh -c 'sleep 45; : …/plot-registryd.mjs'`. One scan's top bash was then sent SIGKILL, the way `scripts-shell.ts:158` does it.

`pgrep -f …/board-server` matched 3 processes: the watcher, its child, and the `bash -c` decoy. The classifier over the same `ps` snapshot reported exactly:

```
board       4985  ppid=1             (watcher; child 5011 folded)
supervisor  4986  ppid=1
scan        5088  ppid=5011          (the live scan; subshells 5092, 5093 folded)
scan        5089  ppid=1  orphaned   (the killed scan's subshell; its child 5090 folded)
```

Both decoys were excluded. `lsof` read the sandbox checkout as the cwd of all four, orphan included. The `ps` plus `awk` pass took 0.045 s over the whole machine. The same pass also found a real scan (23245) run by another session's test harness, top-level with a live non-board parent — the case the previous paragraph names.

### What this does NOT do

- **It does not fix orphaned scans.** #1084 owns `scripts-shell.ts`; this plan reads the result.
- **It does not coordinate spend.** Two supervisors sharing a budget is #1069's question.
- **It does not change `--start`'s refusal**, which names an already-loaded label and its checkout (`plot-fleetctl.sh:681-696`) for `$LABEL`.
- **It does not touch `--stop`, and it signals no process.** One stop rule, one label.
- **It does not change the `summary:` line.** The second block follows it.

## Done when

All assertions run in `test/reconcile/fleetctl.test.mjs` with `ps`, `lsof` and `launchctl` stubbed through `guardBin` (`:211`), unless a bullet says otherwise.

- **With two supervisors, one `node --watch` board and one plain board running, `--status` names all four**, each row with its `serves:` (from cwd) and its `installed:` (from argv). The `--watch` pair is one row carrying the watcher's pid.
- **A stubbed `bash -c '… board/board-server.mjs …'` row, a `zsh -c '… board/plot-registryd.mjs …'` row and a `grep board-server.mjs` row are NOT reported.**
- **A board whose installation path holds a space is found**, and its `installed:` line prints the whole path.
- **One scan with three subshells counts as 1 in flight.** A scan-named process with ppid 1 counts as orphaned, in the group of its cwd and installation.
- **A supervisor labelled `com.quatico.ewz.registryd` is found and its label printed**, because enumeration reads no label.
- **A process whose `lsof` output is empty prints `cannot determine (owner <user>)`**, with the stub exiting 1 and printing nothing — the shape measured for root's `syslogd`.
- **When every Plot process serves this checkout and none is orphaned, the output is byte-identical to today's**, asserted for two fixtures: this checkout's supervisor alone, and this checkout's supervisor plus a board and one in-flight scan for this checkout.
- **The Linux arm reads `/proc/<pid>/cwd` on the ubuntu runner against a real process**: the test starts a `sleep` in a temporary directory and the stubbed `ps` lists its pid as a board, so the cwd read is real. Pid 1 is the unreadable case there, since the runner is not root.
- `node --test test/reconcile/fleetctl.test.mjs` stays green — 72 tests on 2026-09-30. An assertion that changes is named rather than renumbered.

## Slices

### Fleet status sees every Plot process on the machine (Branch: bug/fleet-status-sees-every-supervisor)

Classify one `ps` snapshot into supervisors, boards and top-level scans; read each checkout from cwd and each installation from argv; group scans by the pair and name orphans; print a second block only when a process serves another checkout or a scan is orphaned.

## Notes

**This is what #1048 could not become.** That plan's design section argued correctly that nothing needs adding to the unit — only reading from it — and built the per-label reading this reuses whole. What it could not do is find a label nobody told it about, and that limit was not visible until two supervisors ran at once on one machine.

**The operator found the fault before the tooling did.** The report was *"board seems again dead"*, and the board was answering in 4.5 s. Every component was behaving correctly and the machine was saturated; the missing thing was a reading whose scope matched the problem's.

### Round 1, 2026-09-29

One juror, **amend**, **executed**. Verdict: `.plot/panels/2026-09-29-fleet-status-sees-every-supervisor/premise.md`.

**The causal claim was refuted by process ancestry.** The plan blamed a second supervisor; no scan descends from either supervisor, both have zero children, and the scans are spawned by **three boards** from three installations. The symptom was measured correctly and the mechanism was inferred from co-occurrence — the estate's named failure mode, reproduced by the plan's own author.

The subject is therefore every Plot process rather than every supervisor, and **scans in flight** — the reading the first draft refused as noise — is the number that identifies the spender.

**The prefix enumeration was refused too.** `plot-fleetctl.sh:84` validates no label, and the "convention" is one example in a README paragraph (cited at `:67`, which is a code fence; the example is at `:69-72`). An operator typing `com.quatico.ewz.registryd` would be invisible again, under a status line claiming it looked. Enumeration is now by process.

**One finding was overtaken during the panel.** The juror showed the systemd arm rested on nine hardcoded `plot-registryd` sites that `$LABEL` never reached. #1053 merged while the panel ran and `UNIT_NAME` now derives from the label on both platforms. The finding was correct when written.

### Round 2, 2026-09-30

One juror, **amend**, **executed**. Verdict: `.plot/panels/2026-09-29-fleet-status-sees-every-supervisor/round2.md`. Every finding is fixed in the rewrite; none is scoped out.

- **The three-board picture was a transient.** After a reboot: two supervisors, one board. The writer re-measured at 09:58 and kept boards in scope, because the board is still the only Plot process with a scan below it.
- **"Scans in flight by parentage" was wrong in both directions**: descendants counted one scan as four, and a timed-out scan reparents to pid 1 and belongs to no board. Replaced by top-level scans attributed by cwd and installation, with orphans named, and proved in a sandbox. The reparenting cause is #1084, filed 2026-09-30.
- **`pgrep -f` matched multi-command shells holding the string, and `node --watch` doubled a board.** Replaced by one `ps` snapshot classified by interpreter and argument position, with a top-level rule that folds the watcher pair. Proved in the same sandbox, where `pgrep -f` matched 3 processes for 1 board.
- **The mockup printed installations while Done-when asked for checkouts.** Every row now carries both.
- **The silence rule fired on every machine with a board.** Redefined as: every Plot process serves this checkout and no scan is orphaned. The byte-identical assertion now covers the supervisor-plus-board fixture.
- **`lsof` on another user's process returns empty with rc 1.** The row prints `cannot determine`, decided by empty output.
- **The test count was 72, not 67**, and `serves_line` moved to `:476` and `:498`.
