# Fleet status sees every Plot process on the machine

> `--status` asks about one supervisor. The scans that load the machine are spawned by BOARDS, a board can run from an installation other than the checkout it serves, and nothing on the estate asks what else is running here.

## Status

- **State:** Approved
- **Approved:** 2026-09-30, jwloka, in-session
- **Type:** bug
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Issue:** #1080
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 6
- **Started:** 2026-09-30, jwloka, `bug/fleet-status-sees-every-supervisor`

## Changelog

- `/plot-fleet --status` names every Plot supervisor, board and top-level scan running on this machine, with the checkout each one serves and the installation it runs from, and counts separately the scans whose parent process has exited.

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

Measured a third time 2026-09-30 10:17, load `7.64 14.70 29.27`, with the classifier below:

| pid | kind | installation | serves (cwd) | top-level scans below it |
|---|---|---|---|---|
| 10942 | supervisor `com.plot-pm.registryd` | this checkout | this checkout | 0 |
| 10931 | supervisor `com.plot-pm.registryd.ewz-kus-portal` | `~/.claude/plugins/cache/plot-marketplace/plot/2.21.0` | `/Users/jwloka/Quatico/ewz/ewz-kus-portal` | 0 (one child, `plot-host.sh pr-list`) |
| 1969 | board | `~/.claude/plugins/marketplaces/plot-marketplace` | `/Users/jwloka/Quatico/ewz/ewz-kus-portal` | 1 (86669) |
| 35248 | board | `~/.claude/plugins/marketplaces/plot-marketplace` | this checkout | 1 (42339) |

A third top-level scan, 99738, ran from the 2.21.0 cache installation with cwd `ewz-kus-portal`, under an agent session's `zsh -c`. It descends from no Plot process.

**The scope is supervisors AND boards, and three readings confirm it.** The board count moves (three, then one, then two), so any single picture is a transient. Two facts held across all three readings: the supervisors spawn no scans, and every scan descends from a board, from a session, or from nothing. A supervisor-only status names 2 of the 4 Plot processes at 10:17 and omits both that spawn scans. Board 35248 also runs from an installation other than the checkout it serves, and no existing reading shows that pair (installation and checkout). This plan shows it on every row it prints, and does not print a row for that pair alone (see *The rule*).

### The upstream cause belongs to #1084

`scripts-shell.ts:127` spawns `start` with `detached: true`, and the `stream` timeout at `scripts-shell.ts:158` sends `child.kill('SIGKILL')` to the top bash only. A timed-out scan's subtree reparents to pid 1 and keeps running, and the board starts the next scan. That is the most likely origin of the pile-up. **#1084 removes it; this plan makes it visible** and does not change `scripts-shell.ts`.

### The existing readings are each correct and each scoped to one label

**#1051** gave each checkout its own launchd label; **#1048** made `--status` name the checkout a supervisor serves; **#1053** made the systemd unit name follow the label, so `UNIT_NAME` derives from the label on both platforms.

All three answer *about my supervisor*. `serves_line` is called at `plot-fleetctl.sh:476` and `:498`, both for `$LABEL`. **None is defective and none is machine-scoped.**

### A label prefix cannot find a supervisor

`plot-fleetctl.sh:84` is `LABEL="${PLOT_FLEET_LABEL:-com.plot-pm.registryd}"` — any string, no validation, no warning. The only example of a per-checkout label is `units/README.md:71` (paragraph), example at `:73-75`. An operator who sets `com.quatico.ewz.registryd` gets a supervisor that a prefix enumeration does not find, under a status line that claims it looked.

**So enumeration is by process, not by label.** The label is read from the process afterwards.

## Design

### The rule

**`--status` reports every Plot process on the machine and says which checkout each serves and which installation it runs from.** A Plot process is a supervisor, a board, or a top-level scan, as classified below.

**Nothing to report** means: every Plot process found serves THIS checkout (its cwd is this repository's root), and no scan is orphaned. In that case the output is byte-identical to today's. A normal single-checkout machine — one supervisor and one board for this checkout, the board's scans in flight — is this case.

**A foreign installation that serves THIS checkout is silent, by decision.** Today's board 35248 is that case: it runs from `~/.claude/plugins/marketplaces/plot-marketplace` with cwd this repository. In an adopting repository that is the normal shape, because the board and the supervisor always run from a plugin installation and the checkout holds no artifact of its own. Printing on it would print the block on every adopting machine, which is the noise the silence rule exists to prevent. The installation is shown whenever the block prints for another reason. Version skew between an installation and a checkout is not something this plan reports.

Otherwise a second block follows the existing output, after the `summary:` line at `plot-fleetctl.sh:616`. It lists every Plot process except the supervisor the first block already names. Every row carries both paths. The block is derived on every call and never stored. It prints under every platform arm, including `none`, because a board runs on a host with no init system. The mockup is the 10:17 reading, where the block prints because supervisor 10931 and board 1969 serve another checkout:

```
supervisor: running (pid 10942) — com.plot-pm.registryd
  serves:  THIS repository (/Users/jwloka/Quatico/Agentic-Tools/plot)
  …
summary: agents_running=1 agents_other=1 supervisor=up install=running tick_age=6

plot processes on this machine:
  supervisor  pid 10931  com.plot-pm.registryd.ewz-kus-portal
    serves:     /Users/jwloka/Quatico/ewz/ewz-kus-portal
    installed:  ~/.claude/plugins/cache/plot-marketplace/plot/2.21.0
  board       pid 1969
    serves:     /Users/jwloka/Quatico/ewz/ewz-kus-portal
    installed:  ~/.claude/plugins/marketplaces/plot-marketplace
  board       pid 35248
    serves:     THIS repository
    installed:  ~/.claude/plugins/marketplaces/plot-marketplace
  scans       1 in flight, 0 orphaned
    serves:     /Users/jwloka/Quatico/ewz/ewz-kus-portal
    installed:  ~/.claude/plugins/marketplaces/plot-marketplace
  scans       1 in flight, 0 orphaned
    serves:     /Users/jwloka/Quatico/ewz/ewz-kus-portal
    installed:  ~/.claude/plugins/cache/plot-marketplace/plot/2.21.0
  scans       1 in flight, 0 orphaned
    serves:     THIS repository
    installed:  ~/.claude/plugins/marketplaces/plot-marketplace
```

On Linux a supervisor row names its systemd unit (`unit plot-registryd-ewz`) where macOS names the launchd label.

A process whose cwd cannot be read prints `serves:     cannot determine (owner <user>)` and is never omitted.

### Safety

**`--status` never executes text taken from another process's argv.** The `ps` snapshot lists every user's command lines, and any of them can hold `$( … )`, backticks or `;`. The awk pass emits each candidate path as data, one per line. Bash reads each line into a variable and tests it with `[[ -f "$p" && -x "$p" ]]`. No candidate goes through awk `system()`, `eval`, an interpolated `sh -c`, or any other shell evaluation. Measured 2026-09-30: `awk '{ system("test -x \"" $0 "\"") }'` over the row text `/bin/zsh -c x$(touch <box>/pwned2) /bin/bash` created `pwned2`, and the same text tested as a bash variable created nothing, with both `$(touch …)` and `;touch …` in it.

### One snapshot, one classifier

Enumeration is ONE call: `ps axww -o pid=,ppid=,uid=,args=`. One snapshot keeps the parent relations consistent, `axww` is accepted by both BSD `ps` and procps, and it lists every user's processes. **The owner is read as a numeric `uid`, not `user=`**, because procps truncates `user=` to 8 columns. The name is resolved with `id -un <uid>` only for a row that prints `cannot determine`. An `awk` pass classifies each row in four steps.

1. **argv[0] is the args string up to the first match of `(^|/)(node|bash|sh)` followed by a space**, not the first whitespace token. `ps` prints argv[0] unquoted, and an interpreter can live under a path with a space: the unit bakes `$NODE` into `ProgramArguments`, and fnm on macOS installs under `~/Library/Application Support/fnm`. The matched name is the interpreter. **An argv[0] that holds a space must name an executable regular file**, tested as *Safety* describes with `[[ -f && -x ]]`: `-x` alone admits a directory. A space-free argv[0] is taken as is. This check is what keeps the first match from landing inside another shell's command string: `/bin/zsh -c cd x; /bin/bash /x/…/plot-fleet-scan.sh` matches `/bash ` at a candidate argv[0] of `/bin/zsh -c cd x; /bin/bash`, which is no file. **A process whose spaced interpreter path is deleted or unreadable is not found**, and this is a stated limit: a node binary removed after launch (`fnm uninstall` of the version a unit baked in) or one behind a directory the operator cannot enter fails the test while the process runs. The interpreter is not taken from `ps -o comm=` instead, for two reasons. It needs a second snapshot joined by pid, which a process can enter or leave between the two reads. And `comm` is not a stable path: on this machine it reads `node` for boards 1969 and 35248 and a full path for supervisor 10931, and procps truncates it to a 15-character basename. No classified process on this machine has a spaced interpreter path today.
2. **The artifact path starts at the first token after argv[0] that contains a `/`**, or at a token that is exactly `plot-fleet-scan.sh`. The tokens before it are the leading options. This skips slash-free option values (`--max-old-space-size 4096`, `-o pipefail`), keeps relative paths (`skills/…` holds a slash), and keeps a path with a space (`/opt/App` starts it). The path runs to the end of the artifact name, spaces included, and **the artifact name must be followed by a space or end the args**: `…/board-server.mjs')` and `…/board-server.mjs.bak` do not match. **An option value that itself holds a `/`** (`bash --rcfile /dev/null …`, `node --require /x/hook.js …`) starts the path early and gives a wrong installation. No invocation on this estate has that shape; it is a stated limit.
3. **Command-string options disqualify the row.** For `bash` or `sh`, a single-dash option cluster that contains `c` (`-c`, `-lc`, `-ec`, `-xc`) means a command string follows, so the row is never a scan. The rule reads single-dash clusters only, so `--norc` and `--rcfile` do not trip it. For `node`, a single-dash cluster that contains `e` or `p` (`-e`, `-p`, `-pe`) and `--eval`, `--eval=…`, `--print` or `--print=…` disqualify the row the same way. Without this step the space-tolerant path of step 2 re-admits `bash -c 'sleep 45; : /opt/App Support/skills/plot/scripts/plot-fleet-scan.sh'`.
4. **The path names the kind:**

| kind | interpreter | the artifact path |
|---|---|---|
| supervisor | `node` | ends `/board/plot-registryd.mjs` |
| board | `node` | ends `/board/board-server.mjs` |
| scan | `bash` or `sh` | has the basename `plot-fleet-scan.sh` |

`zsh -c '…'`, `sudo bash …` and `grep board-server.mjs` have no interpreter at argv[0] and are never classified. `pgrep -f` matches every one of these shapes and is not used.

**A relative artifact path is resolved against the process's cwd before the installation is named.** `pnpm board` starts this repository's own board as `node --watch skills/plot/scripts/board/board-server.mjs` (`package.json:14`), and a harness scan runs as `bash skills/plot/scripts/plot-fleet-scan.sh`. Without the cwd the suffix removal leaves an empty installation. When the resolved installation is this repository's root, the row prints `installed:  THIS repository`. When the cwd cannot be read, a relative path prints `installed:  cannot determine`.

**A process is reported only at top level: its parent is not a process of the same kind.** This one rule does two jobs:

- it folds a `node --watch` board and the child it supervises into one row, and the row keeps the watcher's pid — `plot-boardctl.sh --stop` already treats the pair as one board;
- it counts one scan as one process, not as the four its subshells show.

**A scan is attributed by cwd and installation, never by parentage.** cwd is inherited and survives reparenting; the installation is the scan's resolved argv path minus `/skills/plot/scripts/plot-fleet-scan.sh`. **A resolved path that does not end in the full suffix prints `installed:  cannot determine`**: `bash plot-fleet-scan.sh` run from `/c` resolves to `/c/plot-fleet-scan.sh`, which names a file and not an installation, while the same command run from an installation's `skills/plot/scripts/` resolves to a full path and names that installation. The same holds for a board or supervisor path that ends in `/board/<name>.mjs` without `/skills/plot/scripts/` before it. Scans are grouped by the pair (checkout, installation) into one `scans` row per group. **A top-level scan is orphaned when its parent has exited**, which the snapshot shows as a ppid of 1, or as a parent whose args are `…/systemd --user`. On Linux a user's systemd manager makes itself a child subreaper, so a scan whose board died reparents to that manager and not to pid 1; macOS has no subreaper. The row counts orphans separately. The reading does not say why the parent exited: a scan left behind by a board's timeout (#1084) and a manual scan started with `nohup` read the same. A board's installation is its resolved artifact path minus `/skills/plot/scripts/board/board-server.mjs`, and a supervisor's minus `/skills/plot/scripts/board/plot-registryd.mjs`. Paths under `$HOME` print with `~`.

A scan with no board above it and a live parent (a test, a manual run) is top-level, not orphaned, and is counted in its group like any other.

### Checkout, label, and the platform arms

The arm is chosen by `uname -s` (`Darwin` or `Linux`), not by `platform()`. `platform()` answers `none` on a Linux host with no `systemctl` (`plot-fleetctl.sh:131-137`), and a board can run there. Any other kernel prints `cannot determine` for every checkout.

- **Checkout (macOS):** `lsof -a -p <pid> -d cwd -Fn`, the `n` line. **Empty output means cannot determine**, whatever the exit code: for another user's process `lsof` prints nothing and exits 1, with no error text to parse. It needs no sudo for this user's launchd jobs (measured on 10931 and 10942). 0.053 s per call.
- **Checkout (Linux):** `readlink "$PLOT_PROC_ROOT/<pid>/cwd"`, where `PLOT_PROC_ROOT` defaults to `/proc` and exists so a test can supply a fixture tree. A failed read means cannot determine.
- **Label (macOS):** `launchctl list`, the row whose pid column equals the supervisor's pid. A pid with no row prints no label. The label is a detail about a found process, never the way one is found.
- **Unit (Linux):** the Linux row names the systemd unit, not `$LABEL`: the label-to-unit mapping replaces characters and cannot be inverted (`units/README.md:137`). Read `$PLOT_PROC_ROOT/<pid>/cgroup` and take the line that starts with `0::` (the cgroup v2 entry). The unit is the last `/`-separated segment of that line when the segment ends in `.service`, with `.service` removed. A missing `0::` line (cgroup v1), a segment that does not end in `.service`, or an unreadable file prints no unit. Example: `0::/user.slice/user-1001.slice/user@1001.service/app.slice/plot-registryd-ewz.service` gives `unit plot-registryd-ewz`.

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

A second pass, over ten synthetic `ps` rows, checked the option and path rules. It classified `node --watch skills/plot/scripts/board/board-server.mjs` and `bash skills/plot/scripts/plot-fleet-scan.sh --json` (relative), `node /opt/App Support/inst/…/board-server.mjs` and `/bin/bash /opt/App Support/inst/…/plot-fleet-scan.sh --stream` (space), and a full-path `node …/plot-registryd.mjs --start-agents`. It excluded `bash -c 'sleep 45; : /opt/App Support/skills/plot/scripts/plot-fleet-scan.sh'`, `bash -lc '…plot-fleet-scan.sh'`, `/bin/zsh -c eval 'board/board-server.mjs'`, `node -e require('/x/board/board-server.mjs')` and `grep board-server.mjs`.

A third pass, 2026-09-30 10:17, ran the four-step classifier over 24 synthetic rows and one live snapshot. It found an interpreter at `…/App Support/bin/node` (a real symlink to node), a spaced artifact path for a board and a scan, the relative board and scan with their `--watch` child and subshell folded, `--norc`, `--max-old-space-size 4096` and `-o pipefail` with the correct path, a bare `bash plot-fleet-scan.sh`, and a scan under a `systemd --user` parent marked orphaned. It excluded `bash -c` (with a spaced path), `bash -lc`, `/bin/bash -ec`, `sh -xc`, `/bin/zsh -c cd x; /bin/bash …/plot-fleet-scan.sh`, `/bin/zsh -c …/plot-registryd.mjs`, `node -e`, `grep`, `sudo bash …` and a spaced interpreter path that names no file. `bash --rcfile /dev/null …` gave the path `/dev/null /x/…`, the stated limit of step 2. The live snapshot gave the 10:17 table above in 0.079 s.

### What this does NOT do

- **It does not fix orphaned scans.** #1084 owns `scripts-shell.ts`; this plan reads the result.
- **It does not coordinate spend.** Two supervisors sharing a budget is #1069's question.
- **It does not change `--start`'s refusal**, which names an already-loaded label and its checkout (REFUSAL 4, `plot-fleetctl.sh:722-742`) for `$LABEL`.
- **It does not touch `--stop`, and it signals no process.** One stop rule, one label.
- **It does not change the `summary:` line.** The second block follows it.

## Done when

Unless a bullet says otherwise, all assertions run in `test/reconcile/fleetctl.test.mjs` with `ps`, `lsof`, `launchctl` and `id` stubbed through `guardBin` (defined at `:130`, put first on `PATH` at `:211`). `lsof` and `id` have no stub today, and `stubPlatform`'s `launchctl` stub answers `print` only (`:1024-1026`), so the build adds a `list` answer and the two stubs. CI runs on `ubuntu-latest` (`ci.yml:61`), so every macOS case (stubbed `lsof`, `launchctl list`) runs under `stubPlatform(box, { kernel: 'Darwin' })` (`:1006`), which stubs `uname -s`; without it those cases take the `readlink` arm and print `cannot determine`.

- **With two supervisors, one `node --watch` board and one plain board running, `--status` names all four**, each row with its `serves:` (from cwd) and its `installed:` (from argv). The `--watch` pair is one row carrying the watcher's pid.
- **A stubbed `bash -c '… board/board-server.mjs …'` row, a `zsh -c '… board/plot-registryd.mjs …'` row, a `node -e "…board/board-server.mjs…"` row and a `grep board-server.mjs` row are NOT reported.**
- **`bash -c 'sleep 45; : /opt/App Support/skills/plot/scripts/plot-fleet-scan.sh'` and `bash -lc '…/plot-fleet-scan.sh'` are NOT counted as scans**, although each command string ends in a scan path and the first holds a space.
- **A board whose installation path holds a space is found**, and its `installed:` line prints the whole path.
- **A supervisor whose interpreter path holds a space is found with its label**: `<box>/Library/Application Support/fnm/node-versions/v24/installation/bin/node /x/skills/plot/scripts/board/plot-registryd.mjs --start-agents`, with that interpreter created as an executable regular file inside the test box (the ubuntu runner cannot create `/Users/…`). The same row with a directory at that path is NOT reported. The stated limit is asserted too: the row with the interpreter file removed is NOT reported. The same row with an interpreter path that names no file is NOT reported, and neither is `/bin/zsh -c cd x; /bin/bash /x/skills/plot/scripts/plot-fleet-scan.sh --json`.
- **`--status` executes nothing from another process's argv**: stubbed rows whose args hold `/bin/zsh -c x$(touch <box>/pwned) /bin/bash /x/skills/plot/scripts/plot-fleet-scan.sh` and `/bin/zsh -c x;touch <box>/pwned; /bin/bash /x/skills/plot/scripts/plot-fleet-scan.sh` are NOT reported, and `<box>/pwned` does not exist after `--status` returns.
- **`node -pe require('/x/skills/plot/scripts/board/board-server.mjs')`, `node --eval=require('/x/…/board-server.mjs') x` and `node /x/skills/plot/scripts/board/board-server.mjs.bak` are NOT reported.**
- **A bare `bash plot-fleet-scan.sh`** counts as one scan. With cwd `/c` it prints `installed:  cannot determine`; with cwd `<box>/inst/skills/plot/scripts` it prints `installed:  <box>/inst`.
- **A slash-free option value stays out of the path**: `node --max-old-space-size 4096 /x/skills/plot/scripts/board/board-server.mjs` prints `installed:  /x`, and `bash -o pipefail /x/skills/plot/scripts/plot-fleet-scan.sh` counts one scan installed at `/x`.
- **Long options do not trip the `-c` rule**: `bash --norc /x/skills/plot/scripts/plot-fleet-scan.sh` counts as a scan, while `sh -xc : /x/skills/plot/scripts/plot-fleet-scan.sh` does not.
- **A relative artifact path resolves against the cwd**: `node --watch skills/plot/scripts/board/board-server.mjs` with cwd this checkout prints `installed:  THIS repository`, and `bash skills/plot/scripts/plot-fleet-scan.sh` with cwd another checkout names that checkout as its installation. With an empty `lsof` answer the relative row prints `installed:  cannot determine`.
- **One scan with three subshells counts as 1 in flight.** A top-level scan with ppid 1 counts as orphaned (parent exited), in the group of its cwd and installation; the output makes no claim about which process was its parent. On the Linux arm, a top-level scan whose parent row is `/usr/lib/systemd/systemd --user` counts as orphaned too.
- **A supervisor labelled `com.quatico.ewz.registryd` is found and its label printed**, because enumeration reads no label.
- **A process whose `lsof` output is empty prints `cannot determine (owner <user>)`**, with the stub exiting 1 and printing nothing — the shape measured for root's `syslogd`. The stubbed `ps` gives a numeric `uid`, and the owner name is the one the stubbed `id -un` returns for it, printed whole for a 12-character user name.
- **When every Plot process serves this checkout and none is orphaned, the output is byte-identical to today's**, asserted for three fixtures: this checkout's supervisor alone; this checkout's supervisor plus a board and one in-flight scan for this checkout; and this checkout's supervisor plus a board from a foreign installation (`~/.claude/plugins/marketplaces/plot-marketplace`) whose cwd is this checkout — the decided silent case.
- **The Linux arm reads `/proc/<pid>/cwd` on the ubuntu runner against a real process**: the test starts a `sleep` in a temporary directory and the stubbed `ps` lists its pid as a board, so the cwd read is real. Pid 1 is the unreadable case there, since the runner is not root.
- **The Linux unit arm is asserted on the ubuntu runner through `PLOT_PROC_ROOT`**: a fixture `<root>/<pid>/cgroup` holding `0::/user.slice/user-1001.slice/user@1001.service/app.slice/plot-registryd-ewz.service` prints `unit plot-registryd-ewz`; a fixture with only cgroup v1 lines, and one whose last segment is `app.slice`, print no unit.
- **The arm follows `uname -s`, not `platform()`**: with `stubPlatform(box, { kernel: 'Linux' })` and no `systemctl` on `PATH`, `platform()` answers `none`, and the block still prints with checkouts read through `PLOT_PROC_ROOT`.
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

### Round 3, 2026-09-30

One juror, **amend**, **executed**. Verdict: `.plot/panels/2026-09-29-fleet-status-sees-every-supervisor/round3.md`. The whitespace-split classifier held on 960 live rows with no false positive; every finding was a matcher detail or a missing decision, and each is now a sentence plus a Done-when fixture.

- **The space-tolerant matcher re-admitted a `-c` decoy.** `bash -c 'sleep 45; : /opt/App Support/…/plot-fleet-scan.sh'` classified as a scan once options were stripped. A `bash`/`sh` option containing `c`, and a `node` `-e`/`-p`/`--eval`/`--print`, now disqualify the row; the writer checked this on ten synthetic rows.
- **A relative argv path gave an empty installation.** `pnpm board` is that case. The path is now resolved against the process's cwd.
- **The silence rule did not say what a foreign installation serving this checkout does.** Decided: silent, because that is the normal adoption shape, and asserted as a third byte-identical fixture.
- **"No longer owned by a board" claimed a cause the reading cannot see.** ppid 1 now means only that the parent exited.
- **The Linux label parse was vague and unasserted, and procps truncates `user=`.** The parse is now the `0::` line's last `.service` segment, asserted through `PLOT_PROC_ROOT`; the owner is read as `uid=` and resolved with `id -un`.
- **Citations:** the label refusal is REFUSAL 4 at `plot-fleetctl.sh:722-742` (`:681-696` is REFUSAL 2b), and `guardBin` is defined at `:130`.

### Round 4, 2026-09-30

One juror, **amend**, **executed** on macOS; the Linux arms were read and not run. Verdict: `.plot/panels/2026-09-29-fleet-status-sees-every-supervisor/round4.md`. The classifier held on 986 live rows and 14 of 19 fixtures. Each finding is now a sentence plus a Done-when fixture.

- **An interpreter path with a space dropped the row silently.** argv[0] is now the first `(^|/)(node|bash|sh)` followed by a space, and a spaced argv[0] must name an executable file. The writer added that check because the widened match alone lands inside another shell's command string (`/bin/zsh -c cd x; /bin/bash …`).
- **Option values folded into the path.** The path now starts at the first token containing a `/`; an option value that holds a `/` is a stated limit.
- **"An option containing `c`" matched `--norc`.** The rule now reads single-dash clusters only.
- **The arm followed `platform()`, which answers `none` on a Linux host with no `systemctl`.** It now follows `uname -s`, and the macOS cases name `stubPlatform` with a Darwin kernel because CI is `ubuntu-latest`.
- **A Linux subreaper hides orphans from a ppid-1 test.** Orphaned now also covers a parent that is `systemd --user`, with a fixture. The Linux row names a unit, not a label.
- **The machine table and two citations had drifted.** The writer re-measured at 10:17 (two boards, three top-level scans, the block prints), and the citations now read `units/README.md:71` and `:73-75`, and `plot-fleetctl.sh:616` for the summary line.

### Round 5, 2026-09-30

One juror, **amend**, **executed** on macOS; the Linux arms were read and not run. Verdict: `.plot/panels/2026-09-29-fleet-status-sees-every-supervisor/round5.md`. The design held on 1003 live rows, and every fixture and citation checked out. Five findings were fixed.

- **Safety.** The plan did not say how the executable check runs. The natural awk form, `system("test -x …")`, runs `$( … )` from any user's command line, and the round-4 writer's own prototype used that form. A *Safety* subsection now requires a bash variable and `[[ -f "$p" && -x "$p" ]]`. A Done-when fixture asserts that no marker file appears. The writer reproduced both halves: `system()` created the marker, and the variable test did not.
- **A live process with a deleted or unreadable spaced interpreter was dropped silently.** This is now a stated limit with a fixture. The alternative, `ps -o comm=`, was rejected: it needs a second snapshot, and `comm` reads `node` for some processes and a full path for others on this machine.
- **`-x` admits a directory.** The check is now `-f && -x`, with a fixture.
- **The artifact name could be followed by anything.** It must now be followed by a space or end the args. `-pe`, `--eval=` and `--print=` join the node exclusions, with fixtures.
- **Bullet 5 named `/Users/u/…`, which the runner cannot create, and the installation of a bare `bash plot-fleet-scan.sh` was undefined.** The bullet now uses `<box>/Library/…`. A path without the full suffix prints `installed:  cannot determine`. The test-harness additions (a `launchctl list` answer, `lsof` and `id` stubs) are named.

### Round 6, 2026-09-30

One juror, **proceed**, **executed**. Verdict: `.plot/panels/2026-09-29-fleet-status-sees-every-supervisor/round6.md`. The Safety rule held against 8 real decoy processes whose argv held `$( )`, `;`, backticks, `$(( $( ) ))`, nested quotes and `x[$( )]`: no marker file appeared. The forbidden awk `system()` form created markers for the backtick and `$(( ))` shapes. Every Done-when fixture and the live snapshot classified as written, with no false positive.

Two non-blocking additions for the implementer: apply the Safety rule to every string read from another process, the `lsof` cwd included, with an `lsof`-stub fixture whose cwd holds `$(touch <box>/pwned)`; and build without `declare -A`, since macOS `/bin/bash` is 3.2 (a second awk pass does the fold). Scans started by a test harness are top-level scans, so the block prints during a `pnpm test` run, as the silence rule intends.
