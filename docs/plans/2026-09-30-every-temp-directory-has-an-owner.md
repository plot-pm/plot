# Every file Plot writes has an owner

> A clean, all-green run of one contract file leaves 365 directories in `$TMPDIR`, every fleet scan leaves one cache directory, and the budget ledger grows about 30,000 lines a day with no bound. Cleanup is written per call site and most sites omit it. The fix makes removal a property of the run, puts every script temp path under `TMPDIR`, and gives every state file a declared bound.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Issue:** #1083
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2

## Changelog

- Plot's helper scripts create every temporary path under `TMPDIR` through one helper, one exit registry removes them, and a signal still stops the script.
- Plot's contract suites run inside a private temp root and a private `HOME`, and CI fails a test that leaves an entry behind.
- The budget ledger rotates into two generations without losing an append or miscounting a read, supervisor and board logs rotate by size, and every file Plot writes declares its bound.

Board impact: none. No plan-format, template or payload change. `plot-fleet-scan.sh` changes only where it creates its temp directories and how it removes them.

## Motivation

Measured 2026-09-30 on a macOS developer machine after about two months of Plot development: `$TMPDIR` held 277,669 entries, and 141,249 were `plot-*` directories. The directory's link count read 65535.

### The suites leak on the normal path

One run of `test/reconcile/host.test.mjs` with `TMPDIR` set to an empty directory, 266 tests, 266 pass, 0 fail, left **365 entries** in 31 prefixes. The largest six:

| Prefix | Left behind |
|---|---|
| `plot-host` | 126 |
| `plot-host-jira` | 36 |
| `plot-host-jenbin` | 27 |
| `plot-host-bb` | 26 |
| `plot-host-jen` | 23 |
| `plot-host-rate` | 22 |

The file has 39 `mkdtempSync(` sites and 10 `rmSync(` calls. The same method on other files, each with its own empty `TMPDIR`: `budget` leaves 64, `state-gate` 21, `dispatch` 4, `packages/board/test/lifetime` 1, and `fleetrefplans`, `commitrecord`, `restart`, `workerstate`, `workerloop`, `registry` and `claim` leave 0. A static count of cleanup calls does not predict these numbers: `commitrecord` has 10 sites and one cleanup and leaves 0, while `budget` has 5 sites and no cleanup and leaves 64.

### The suites write into the operator's ledger

The same `host.test.mjs` run with a scratch `HOME` and `PLOT_BUDGET_HOME` unset wrote **430 lines** to `$HOME/.plot/state/budget.tsv` and created `$HOME/.plot/state/slots/`. On the operator's machine the tests run with the real `HOME`, so the live ledger carries fixture accounts: `bitbucket/plot-pm` 32,220 lines, `jira/me@acme.test` 2,801, `bitbucket/acme` 1,112, the newest dated 2026-09-30. `~/.plot/state/slots/` holds `acme/` and `a/`. `test/reconcile/{parser,gate,init}.test.mjs` and `packages/domain/test/{host-shell,tracker-shell}.test.ts` use fixture accounts and do not set `PLOT_BUDGET_HOME`.

### Script temp paths escape `TMPDIR`

On macOS, `mktemp` with no template writes to `_CS_DARWIN_USER_TEMP_DIR` as `tmp.XXXXXXXXXX`, and `mktemp -t plot-x` writes there as `plot-x.XXXXXXXX`. Both ignore `TMPDIR` (`man mktemp`). Only an explicit `"${TMPDIR:-/tmp}/plot-<prefix>.XXXXXX"` template lands under `TMPDIR`. `tmp.*` is therefore the default name of every template-less `mktemp` on the machine, from any program.

`skills/plot/scripts/*.sh` holds 14 `mktemp` sites. Five are template-less: `plot-fleet-scan.sh:581`, `plot-board-verify.sh:28`, `plot-install-hooks.sh:177`, `plot-reconcile-scan.sh:477` and `:2966`. Two hardcode `/tmp`: `plot-host.sh:861` and `:933`. Seven are already templated.

Nine more fixed-name temp paths bypass `TMPDIR` without `mktemp`, in three scripts:

| Path | Script | Occurrences |
|---|---|---|
| `/tmp/plot-host-err.$$` | `plot-host.sh` | 48 |
| `/tmp/plot-host-limit.$$` | `plot-host.sh:4636` | 1 |
| `/tmp/plot-host-prlist-err.$$` | `plot-host.sh:578` | 1 |
| `/tmp/plot-host-prlist-state-err.$$.$_s` | `plot-host.sh:1051` | 1 |
| `/tmp/plot-host-sweep.$$.XXXXXX` | `plot-host.sh:861` | 1 |
| `/tmp/plot-host-window.$$.XXXXXX` | `plot-host.sh:933` | 1 |
| `/tmp/plot-open-pr.$$.err` | `plot-open-pr.sh:222-225` | 3 |
| `/tmp/plot-write-config.$$.req` | `plot-write-config.sh:104-112` | 4 |
| `/tmp/plot-write-config.$$.err` | `plot-write-config.sh:115-118` | 3 |

A fourth script, `plot-update-board.sh:66`, writes `/tmp/plot-board-cache-${OWNER}-${PROJECT_NUMBER}.json`, a cache that persists across calls and is state, not a temp path. `plot-reap.sh:470` matches `/private/tmp/*` in a `case` pattern and writes nothing.

A per-run `TMPDIR` therefore does not contain these paths on macOS. On GNU `mktemp`, which an `ubuntu-latest` runner has, the template-less form honours `TMPDIR`: with `gmktemp` first on PATH, four scan-running files left **98 `tmp.*` entries** in a private root (`fleet` 82, `fleetrefplans` 11, `fleetclaimable` 4, `fleetderived` 1). With stock macOS `mktemp` the same `fleetrefplans` run left 0 in the root and 12 in `/var/folders/.../T`.

### The fleet scan replaces its own EXIT trap

`plot-fleet-scan.sh:581-583` creates an unnamed `mktemp -d` and sets `trap 'rm -rf "$HOST_STATE_CACHE"' EXIT INT TERM`. `:2585-2588` sets `trap 'rm -rf "$REF_TMP"' EXIT INT TERM` in the same shell. The second `trap` replaces the first. Reproduced with those two statements in a scratch script, and in a `bash -x` trace of the live scan:

```
unnamed dir: tmp.WgCQwchlM9  survives=YES
ref dir:     plot-fleet-ref.KXl6Zz  survives=no
```

Measured 2026-09-30, about 50 new `tmp.*` entries appeared in `/var/folders/.../T` in six minutes with two boards and two supervisors running. Seven of them held 953-958 files each, one per branch, which is the host-state cache's shape. The machine held 20,939 `tmp.*` entries.

Seven scripts install their own trap: `plot-board-verify.sh`, `plot-dispatch.sh`, `plot-host.sh`, `plot-fleet-scan.sh` (twice), `plot-install-hooks.sh`, `plot-resolve-artifact.sh` and `plot-worker-loop.sh`, 8 traps in all. `plot-host.sh:2655` owns `trap 'budget_memo_clear' EXIT`. No script sources `plot-host.sh` today, so its trap cannot collide with a caller's yet.

**The existing trap shape swallows the signal.** A handler of the form `trap 'rm -rf "$d"' EXIT INT TERM` does not exit. Sent TERM or INT, a scratch script with that trap deleted its directory, kept running, and exited 0. All eight traps have that shape.

### Per-site cleanup is a rule

`test/reconcile/` holds 360 `mkdtempSync` sites. Each one needs its own `rmSync`, and nothing checks that it has one. By this repository's own test, that is a rule: a reviewer can answer "does this test clean up?" with yes without running it.

### Persistent state has no bound either

Measured 2026-09-30:

| File | Size | Bound |
|---|---|---|
| `~/.plot/state/budget.tsv` | 46 MB, 828,680 lines over 27 days | none |
| `~/.plot/state/memo/<pid>/` | 347 directories, 2.1 MB, oldest 2026-09-22 | removed on exit; leaked on SIGKILL |
| `~/.plot/state/slots/` | fixture-account directories from the suites | none |
| `/tmp/plot-board-cache-*.json` | one per project | none |
| `.plot/logs/registryd.log.2026-09-21` | 131 MB over 13 days, renamed by hand | none |
| `.plot/logs/board.log` | 2.4 MB | none |
| `.plot/logs/registryd.log` | 1.7 MB since 2026-09-22 | none |
| `.plot/logs/registryd.err` | small | none |
| PR index, `.git/.plot/state/` | 380 KB | one row per PR |
| `.plot/state/` receipts, pulse, controls | 356 KB | spent or overwritten |
| `.plot/state/unowned-*.tsv` | 242 lines | kept on purpose; the count is the record |
| per-desk `.plot-worker.*` | ~12 KB per desk | removed with the desk by `plot-reap.sh` |

**The ledger costs every GitHub call about 1.1 s.** `plot-host.sh:1717-1722` (`graphql_budget_spent`) calls `budget_rate` before it routes a GitHub call, and `budget_rate_read` reads the whole file in one `awk` pass. Measured on a scratch copy: `plot-host.sh spend-rate` takes 1.23-1.25 s over the 46 MB file and 0.05 s over its last 2,000 lines; `budget_rate github jwloka graphql` takes 1.11 s against 0.01 s. At load 38, `spend-rate` took 0.119 s over an empty ledger and 0.202 s over 61,000 lines, so process start is most of the cost at the bounded size.

**The ledger has a pruning port and no caller.** `plot-budget.sh:11-16` says the shell *"appends and reads, and it never prunes"* and leaves truncation to the `BudgetRecord` port's `truncate()` (`ports/budget.ts:93`). Neither `truncate()` nor the port's `lines()` and `survivors()` has a production caller, and `budgetFile` itself has none. The supervisor (`registryd-main.ts:279`) and the board (`fleet.ts:1880`) read the ledger only through `plot-host.sh spend-rate`. The port's `truncate()` also loses appends: its write-aside-and-rename ran over a scratch copy of the 46 MB file while four shell loops appended 600 lines through `plot-budget.sh`, and **59 of the 600 appends were lost** in one 660 ms window. A line appended between the read and the rename is not in the kept set, and an appender whose `O_APPEND` descriptor opened the old inode writes into the unlinked file.

**Every spend window is at most one hour.** No connector declares a window. Both readers compute the window start as `max(now - 1 h, latest passed reset)`, from `FALLBACK_WINDOW_MS` (`rules/budget-record.ts:23`) and `BUDGET_FALLBACK_WINDOW_MS` (`plot-budget.sh:210`).

**The registryd log was rotated by a person.** `~/.bash_history:197030-197038` holds `plot-fleetctl.sh --stop`, then `mv .plot/logs/registryd.log .plot/logs/registryd.log.2026-09-21`, then `plot-fleetctl.sh --start 1`. The file's birth time is 2026-09-08 16:24 and its last write 2026-09-21 15:52. No unit, script, registryd source or `newsyslog` entry rotates it. Its 13,342 tick lines average about 10 KB each, because a tick then listed every `held on not-claimable` branch, up to 257. Today's log holds 5,944 ticks in 1.7 MB, about 290 bytes a tick, or about 0.4 MB a day at one tick a minute. Tick size depends on the estate, so the bound is on bytes.

**Neither log is opened by the process that writes it.** launchd opens `registryd.log` and `registryd.err` through the unit's `StandardOutPath` and `StandardErrorPath` (`com.plot-pm.registryd.plist:80-83`). `plot-boardctl.sh:423-425` opens `board.log` with `>>` before it `exec`s the board. `lsof +fg` on the four live processes shows every one of these descriptors with the `AP` (`O_APPEND`) flag. A second writer also exists: `~/.bash_history:34129` holds a hand-started `nohup bash -c 'while true; do node .../plot-registryd.mjs --start-agents >> .plot/logs/registryd.log ...'`. A writer that inherited its descriptor follows the inode across a rename and never creates the new name.

**Nothing runs the reaper's removal.** No script calls `plot-reap.sh --yes`, `crontab -l` is empty, and nothing runs `plot-fleetctl.sh --once` on a schedule. The launchd unit runs `plot-registryd.mjs --start-agents` directly (`com.plot-pm.registryd.plist:34-36`).

## Design

### The rule

**A run owns one temp root, removes it when the run ends, and fails when anything it created is still present. Every temp path a script creates lies under `TMPDIR` and carries a `plot-` name. Every file Plot writes outside a temp root declares its bound.**

### Safety

**Nothing in Plot deletes by glob in a shared temp directory.** `$TMPDIR`, `/tmp` and `/var/folders/.../T` hold every program's files, and a glob there matches what Plot did not create. On 2026-09-30 a round-2 juror ran `rm -rf "$(getconf DARWIN_USER_TEMP_DIR)"tmp.*` to remove one probe directory, and it removed every `tmp.*` entry in the operator's real temp directory. So:

- **A script or test removes only a path it created**, by the exact name `mktemp`, `mkdtempSync` or the helper returned, or by the name recorded in the helper's registry.
- **The sweep matches Plot's own name shape only**: entries whose name is `plot-<prefix>.<suffix>` or `plot-run.<suffix>`, directly under `$TMPDIR`, owned by this user and past the age bound, plus `memo/<pid>` directories under `$PLOT_BUDGET_HOME`. It lists candidates with `find -maxdepth 1 -user … -name 'plot-*'`, reports each by its full path, and removes each by that path. It never passes a glob to `rm`, and it never reads `/tmp` or `/var/folders` when `$TMPDIR` points elsewhere.
- **The Layer 1 gate also refuses an `rm` whose argument holds a glob character under `$TMPDIR`, `${TMPDIR`, `/tmp`, `/var/folders` or `$(getconf`**, in `skills/plot/scripts/*.sh` and in `scripts/`. Test files use `rmSync` on a path they hold, and the leak gate's migration adds no pattern delete.

### Layer 1: scripts create every temp path through one helper

A sourced helper, `plot-tmp.sh`, gives a script three functions:

- `plot_tmpdir VAR prefix` and `plot_tmpfile VAR prefix` create a path from the template `"${TMPDIR:-/tmp}/plot-<prefix>.XXXXXX"`, with the X's trailing, which BSD `mktemp` requires, and assign it to the variable named `VAR` through `printf -v`. They print nothing and are never called inside `$(…)`. The template is what makes the path honour `TMPDIR` on macOS.
- `plot_on_exit command` adds a command to the registry.

**The registry is a file, not a shell variable.** It lives at `"${TMPDIR:-/tmp}/plot-reg.$$"`. `$$` is the owning script's pid in every subshell, so a registration made inside `$(…)` or `( … ) &` reaches the owner's trap. A shell array would not: each subshell appends to its own copy. Four existing sites already run inside a command substitution (`plot-host.sh:861`, `:2878`, `:2884` and `plot-reconcile-scan.sh:2966`), the same fact `plot-budget.sh:410-417` records for the budget memo.

**The helper installs the process's only traps, once, when it is sourced.** EXIT runs every registered command, removes every recorded path and the registry file, and keeps the exit status. INT and TERM run the same cleanup, clear their own trap, and re-raise the signal, so the script stops and exits 130 or 143. A trap installed on the first call, inside a substitution, would remove the path when the substitution closes; installing at source time prevents that. A prototype of this design ran on `/bin/bash` 3.2.57 and bash 5.3.15 with `set -u`: two directories, two commands and a file registered inside `$(…)` all ran or were removed on a normal exit (status 7 kept), on INT (130) and on TERM (143).

**What moves to the helper in this slice:** all 14 `mktemp` sites; the nine fixed-name `/tmp` paths in the table above, the 48 `plot-host-err.$$` redirects included; and all 8 traps in the 7 scripts, `plot-host.sh`'s `budget_memo_clear` included. The fleet scan's unnamed cache becomes `plot-fleet-host-state.*`. That fixes the trap overwrite by construction. `plot-update-board.sh`'s cache is state, not a temp path, and moves to Layer 5.

**Stopping on a signal is a behaviour change.** Today a TERM deletes the temp files and the script runs on to exit 0. After this slice it exits 143. Each of the seven scripts is checked for a caller that relies on the old status; `plot-worker-loop.sh` keeps its ALRM and USR1 traps, which the helper does not touch.

**A grep gate holds it.** A check in `scripts/`, modelled on `scripts/check-host-cli-callers.sh` and with a named exception list, refuses in `skills/plot/scripts/*.sh` outside `plot-tmp.sh`: any `mktemp` call, a `/tmp/` path in a write or redirection, `$(plot_tmpdir` and `$(plot_tmpfile`, and any `trap` that names `EXIT`, `INT` or `TERM`. The gate passes on this slice's own branch, because the slice migrates every site it names.

### Layer 2: a backstop sweep for SIGKILL

A trap does not run on SIGKILL. The board ends a scan at its 90 s timeout, `bounded.sh` escalates to SIGKILL, and a person kills a hung script. So some paths outlive every trap.

`plot-reap.sh --sweep-temp` removes two populations, both **owned by this user and older than a bound** (default 24 h, from a `Temp sweep after` config key):

- `$TMPDIR/plot-*` entries. The helper gives every script temp path this prefix, the suites' `mkdtempSync` sites already use it, and Layer 3's root is `plot-run.*`.
- `$PLOT_BUDGET_HOME/memo/<pid>` directories (default `~/.plot/state/memo/`) whose pid is not alive. A reused pid keeps its directory until that process exits; 4 of 347 measured pids were live.

It follows the reaper's own rules: `--dry-run` by default, `--yes` removes, and it reports each entry.

**The sweep never removes a `tmp.*` entry.** That name belongs to every template-less `mktemp` on the machine, and neither ownership nor age separates Plot's from another program's. The fleet-scan cache gets its `plot-fleet-host-state.*` name in Layer 1, in the same slice and before the sweep's commit, so from that release on no Plot script creates a `tmp.*` entry. The `tmp.*` caches that earlier releases left stay where they are. `plot-reconcile-scan.sh` reports their count in an advisory section below its blocking marker, counting a `tmp.*` directory only when it holds `.list-arrived`, `.list-complete`, `pr-list.json` or `pr-list-open.json` (`plot-fleet-scan.sh:855-1075`). The section prints no removal command: removing them is a person's decision.

**The age bound is safe because no temp path outlives the call that made it.** Every Plot temp path found on this estate belongs to one script call, one scan or one board request: `lsof` on the running board and both registryd processes showed no open file under `$TMPDIR` or `/tmp`, and the board's `mkdtempSync` sites (`board.ts:1831, 1857, 2326`) are per request. The board and the supervisor run for days, so process lifetime is not the argument. A 24 h bound is about 1,000 times the 90 s scan timeout.

**The supervisor runs the sweep, behind an opt-in flag.** `plot-registryd.mjs` gains `--sweep-temp`, off by default, the same shape as `--start-agents` (`registryd-main.ts:113-118`). With the flag, a tick calls `plot-reap.sh --sweep-temp --yes` through an adapter, at most once an hour, keyed by the modification time of `.plot/state/temp-sweep.at`, which the tick overwrites. Both unit files pass the flag. A plain `--once` and a run without the flag still decide and perform nothing, so `plot-fleetctl.sh:14-16`'s contract holds. On a machine with no supervisor the sweep runs only when a person runs `plot-reap.sh --sweep-temp --yes`, and `plot-reconcile-scan.sh`'s advisory section also reports how many entries the sweep would remove, so `/plot-reconcile` surfaces it.

### Layer 3: the suite owns `TMPDIR` and `HOME`

`test:contracts` and `test:board` run inside a wrapper, `scripts/owned-run.sh`, that wraps the whole script string, `bounded.sh` included. The wrapper:

1. Creates one root, `"${TMPDIR:-/tmp}/plot-run.XXXXXX"`. The `plot-` prefix puts a root that a SIGKILL of the wrapper leaves inside Layer 2's sweep.
2. Sets `TMPDIR`, `HOME`, `PLOT_BUDGET_HOME` and `PLOT_PR_INDEX_HOME` to directories inside the root for the whole process tree. `os.tmpdir()` reads `TMPDIR`, and after Layer 1 every script path does too, so the 347 `tmpdir()` sites stay unchanged. The `HOME` and `PLOT_BUDGET_HOME` redirect is what stops the suites writing to the operator's ledger and `slots/`.
3. Runs the suite, then runs `scripts/check-registry-not-leaked.mjs` with the **original** `TMPDIR` and `HOME`. That check builds its temp set from `os.tmpdir()` (`:116`); inside the root it would lose `/var/folders/.../T` from the set.
4. Runs the leak gate (Layer 4) and removes the root, whatever the exit code.

The wrapper traps INT and TERM itself, with Layer 1's re-raise semantics, because a Ctrl-C or a CI cancel signals the wrapper as well as its child, and `bounded.sh` installs no trap. It also covers `bounded.sh`'s unbounded branch, where no `timeout` is on PATH and `bounded.sh` runs the command directly. `bounded.sh` already returns to its caller after it kills the child, so the wrapper survives a child SIGKILL and removes the root. A SIGKILL of the wrapper itself leaves one `plot-run.*` directory, which the sweep removes.

**Environment inheritance holds.** 181 `env: {` literals in `test/reconcile` and `packages/board/test` were sampled at 7 call sites, and every helper they reach spreads `...process.env`. No test clears the environment. `fleetrefplans.test.mjs:274` sets `TMPDIR` to a path taken from `os.tmpdir()`, which stays inside the root.

### Layer 4: the leak gate

Before the wrapper removes the root, it lists what is still inside the temp directory. A non-empty list fails the suite and names each entry and its prefix.

**This avoids the snapshot problem `scripts/check-registry-not-leaked.mjs` describes.** That gate refuses a before/after comparison of the shared registry because the supervisor writes to it during a run. The per-run root is private: no supervisor, board or other agent writes into it. An entry present at the end came from this run. Across 11 files, 3 of them with `detached: true` spawns, the count at exit equalled the count 40-45 s later, and no process held a path in the root after exit.

**The gate is authoritative on macOS and Linux because Layer 1 lands first.** Before Layer 1, macOS scripts write outside the root, where the gate cannot see them, and GNU `mktemp` puts 98 `tmp.*` entries inside it, where the gate fails on a defect this slice does not own. After Layer 1, both platforms create every script path under `TMPDIR`.

**The gate cannot see writes under `HOME`.** Layer 3 redirects them into the root, so they cannot reach the operator's machine, and Layer 5's inventory gate reads them. The leak gate reads only the temp directory.

**It needs a migration step, not a flag day.** The first run of the gate fails on today's leaking files. Slice 2 fixes each file, or gives it a `t.after` cleanup, until the gate passes. The migration works from the measured per-file count, not from a grep of cleanup calls. A temporary allow list is acceptable only when it names each file with its measured count and can only shrink, like the spawn ratchet in `ci.yml`.

The gate is what keeps the fix. Without it, the 361st `mkdtempSync` site brings the leak back.

### Layer 5: every state file declares its bound

**The budget ledger rotates into two generations.** The shell appender stays lock-free and append-only, which `plot-budget.sh` requires for `O_APPEND` atomicity below `PIPE_BUF` (512 on this fleet's macOS machines). The ledger is three files in `$PLOT_BUDGET_HOME`: `budget.tsv` (current generation), `budget.tsv.1` (previous generation), and `budget.gen`, a generation counter.

**Rotation:**

1. `budget_append` reads the first line's timestamp of `budget.tsv` with `{ read …; } 2>/dev/null < budget.tsv`. The braces matter: a trailing `2>/dev/null` does not catch a redirection error in the moment after a rename. When the current generation is older than the generation length (24 h), the appender tries to take the lock.
2. The lock is a directory, `budget.lock`, created with `mkdir`, holding the owner's pid and start time. An appender that finds the lock held by a live owner skips the rotation and appends; no append ever waits.
3. Under the lock, the rotator re-reads the condition, sets `budget.gen` to the next odd number, renames `budget.tsv` to `budget.tsv.1`, sets `budget.gen` to the next even number, and removes the lock. Each counter write is a write to a scratch file and a `mv`, so a reader never sees a partial number. The rename is O(1) at any size.

**Stale-lock recovery.** A lock whose owner pid is not alive, or whose start time is more than 10 s old, is stale. An appender that finds a stale lock breaks it: it renames the lock directory to a unique name, which only one breaker can win, removes it, and takes the lock afresh. If `budget.gen` is odd, the dead rotator stopped between its counter writes; the rename is atomic, so the two files are consistent either way, and the new owner sets the counter to the next even number before it proceeds. Each break writes one line to stderr and one line to `$PLOT_BUDGET_HOME/budget-lock-broken.tsv` (time, dead pid, lock age). `plot-reconcile-scan.sh`'s advisory section reports that file's line count, so a break is never silent. Round 2 showed the failure this closes: after a SIGKILL of the rotator, 50 later appends, each due to rotate, never rotated.

**The reader is exact across a rotation.** `budget_rate_read` and the port's adapter read like a sequence lock:

1. Read `budget.gen` as `g1`. If it is odd, a rotation is in progress; retry.
2. Read `budget.tsv`, then `budget.tsv.1`, in one `awk` pass over both.
3. Read `budget.gen` as `g2`. If `g2` differs from `g1`, a rotation happened during the read; discard the answer and retry.

The order in step 2 is deliberate. Read current first, then previous, and a rotation between the two reads makes the reader see the old current file twice. It counts that generation twice and never misses it. The counter check then discards that answer. The reverse order, `.1` first, skips the whole live generation when a rotation lands between the reads: round 2 measured `spent` 0 for the live generation. After three retries the reader answers from its last read and adds `"rotating":true` to the JSON. That answer can only over-count, which makes `graphql_budget_spent` more cautious, never less. A missing `budget.gen` reads as 0, so the first release reads an unrotated ledger correctly.

**Why nothing is lost.** An append that races a rename lands in one of the two files, and the reader reads both: round 2 ran the writer half against a copy of the 47.8 MB ledger with four appenders writing 150 lines each and a rotation forced mid-stream, and all 11 trials showed 600 of 600 visible, 0 duplicates and 0 torn lines. The next rotation replaces `budget.tsv.1`, when every line in it is at least one generation old. The generation length (24 h) is 24 times `FALLBACK_WINDOW_MS` (1 h), the upper bound of every window, so no line inside a live window is discarded. A contract test asserts that the generation length exceeds `FALLBACK_WINDOW_MS`.

**The reader reports what it read.** `budget_rate_read` adds a `read` field, the number of ledger lines its pass read across both generations. At the measured 30,700 lines a day, two generations hold at most about 61,000 lines. `spend-rate` over 61,000 lines took 0.083 s more than over an empty ledger, both at load 38.

**The first rotation keeps the 46 MB file for one generation.** It becomes `budget.tsv.1` and leaves at the second rotation, 24 h later, so the per-call cost stays about 1.2 s for one day and then falls. Discarding it at once would drop the lines in the live window.

**The port's `truncate()` is removed.** It has no production caller, its write-aside loses appends (59 of 600 measured), and rotation replaces it. `plot-budget.sh`'s header changes from *"it never prunes"* to *"it appends, reads two generations under a counter, and rotates by rename"*. `truncate()`, `truncationOwed()` and the adapter's write-aside leave the port and adapter with their tests, and `lines()` reads both generations under the same counter check.

**Logs rotate in the process that writes them.** `registryd` and the board open their own log file with `O_APPEND` rather than writing to an inherited stdout. At a size bound (default 10 MB) the writer renames the file to `.1`, shifts older files up to `.3`, deletes the fourth, and reopens. A size bound, because tick size varied from 290 bytes to 10 KB with the estate. The process that opens a file is the only one that can rename it and follow the rename, and this covers a hand-started writer as well as launchd. The unit's `StandardOutPath` and `StandardErrorPath`, and `plot-boardctl.sh`'s redirect, keep only output printed before the writer opens and crash traces, and each process truncates its inherited stdout and stderr at start when they pass the bound. That truncate is safe because every opener uses `O_APPEND`, measured with `lsof +fg`; a truncate under a plain `>` writer leaves a hole of NUL bytes, measured at 415 bytes in round 2.

**The board-project cache moves under a declared home.** `plot-update-board.sh:66`'s `/tmp/plot-board-cache-*.json` moves to `~/.plot/state/board-cache/`, one file per project, declared *overwritten*.

**An inventory gate holds the rule, built from observed writes.** A static grep cannot list the paths, because writes are built from variables (`"$file.$BASHPID.tmp"`, `join(home, FILE)`). So the gate runs inside Layer 3's sandbox: after the contract suite, it lists every file under the sandbox's `HOME/.plot/`, the scratch repositories' `.plot/`, and the git common dir's `.plot/`, and matches each path against a checked-in manifest of globs. Each glob declares one bound: *overwritten*, *spent*, *window*, *rotated*, *removed on exit*, *removed with its desk*, *kept on purpose*, or *tracked in git*. A path no glob matches fails the test and names it. Its coverage is exactly what the suites execute; a write path no test reaches is not seen, and the manifest states that limit.

**It declares, it does not measure sizes.** A size check in CI would read a runner's fresh filesystem and pass every time. The declaration is what a reviewer and the test can both read.

### What this does NOT do

- **It does not change what any test asserts.** Only where its sandbox and its `HOME` live.
- **It does not move the hardcoded `'/tmp'` literals in the tests.** All 73 were classified and none creates a file: 12 in `test/reconcile/` (two comments in `reap-manifest`, ten plist placeholders in `fleetctl.test.mjs:644-685`) and 61 in `packages/board/test/`, all fixture data. `idea-route.test.ts:378` asserts that `/tmp/plot-pwned` does not exist, an injection canary that must stay literal.
- **It does not remove any `tmp.*` entry**, including the fleet-scan caches earlier releases left. It reports them.
- **It does not delete the `unowned-*.tsv` ledgers.** Their growth is one line per bypass, and the count is the record they exist to keep.
- **It does not clean the operator's existing ledger of fixture-account lines.** Rotation drops them within two generations.
- **It does not claim the leak caused the app-launch fault** seen the same day. Removing 141,249 directories restored neither LaunchServices nor `getconf DARWIN_USER_CACHE_DIR`.

## Done when

- **No script creates a temp path outside `TMPDIR`**: with `TMPDIR` set to an empty directory on macOS, a fleet scan, a reconcile scan, `plot-board-verify.sh`, `plot-install-hooks.sh --verify`, `plot-open-pr.sh` and `plot-write-config.sh` add no entry to `getconf DARWIN_USER_TEMP_DIR` or `/tmp`, and every entry they create under `TMPDIR` starts with `plot-`.
- **`plot-fleet-scan.sh` leaves no directory on a normal exit**, the host-state cache included. The two-statement reproduction above becomes a test.
- **The helper registers in the calling shell**: a path created with `plot_tmpdir VAR prefix` exists after the call and is removed at exit, and a path registered inside `$(…)` and inside `( … ) &` also survives until the owner exits and is removed then. A test covers both failure modes of a variable registry: removed at once, and leaked.
- **A script sent TERM mid-run exits 143 and runs no command after the signal**, and one sent INT exits 130, with every registered path removed.
- **A `mktemp` call, a `/tmp/` write, `$(plot_tmpdir`, or a raw EXIT/INT/TERM trap added to a script fails CI** by name, and the gate passes on the slice's own branch.
- **The sweep removes an owned `plot-*` directory and a dead-pid memo directory older than the bound, and keeps a younger one, a live-pid one, and every `tmp.*` entry**, with `--dry-run` as the default. A registryd tick with `--sweep-temp` runs it at most once an hour; a tick without the flag runs nothing.
- **An `rm` with a glob under a shared temp directory fails the gate**, asserted by a fixture script holding `rm -rf "$TMPDIR"/tmp.*`, and the sweep's test asserts that a non-Plot entry of the same age and owner survives, `tmp.*` and `plot` without a dot included.
- **`plot-reconcile-scan.sh` reports** the sweepable count, the legacy fleet-scan `tmp.*` cache count, and the broken-lock count, below its blocking marker.
- **One run of `test/reconcile/host.test.mjs` leaves zero entries in its `TMPDIR`**, measured the same way as the 365 above, on macOS and with GNU `mktemp`. The four scan files `fleet`, `fleetrefplans`, `fleetclaimable` and `fleetderived` leave zero with GNU `mktemp`.
- **One run of `host.test.mjs` adds zero lines to the operator's `budget.tsv`** and creates nothing under the operator's `~/.plot/state/slots/`.
- **`pnpm run test:contracts` fails when a test leaves an entry**, asserted by a fixture test that creates one on purpose and checks that the run names it.
- **A killed contract run leaves at most one directory**, a `plot-run.*`: send SIGKILL to the run mid-suite and count. SIGINT and SIGTERM to the wrapper leave none.
- **`check-registry-not-leaked.mjs` still sees `/var/folders/.../T`** when it runs after a wrapped suite.
- **No append is lost across a rotation**: four concurrent appenders writing 600 lines while rotations fire leave all 600 readable by `budget_rate_read`.
- **A reader is exact across a rotation**: with a rotation forced between the reader's read of `budget.tsv` and its read of `budget.tsv.1`, the answer equals the count from a quiescent read, and no reader answer during the four-appender race counts a line twice unless it carries `"rotating":true`.
- **After a SIGKILL of the rotator holding the lock, a later append breaks the stale lock, rotates, and records the break** in `budget-lock-broken.tsv`.
- **A reader reads at most two generations**: after three rotations over a fixture ledger, `budget_rate_read`'s `read` field equals the line count of `budget.tsv` plus `budget.tsv.1`, and no line older than two generations is read.
- **`registryd.log` and `board.log` rotate at the bound and keep 3 files**, asserted by writing past the bound in a sandbox, with the writer started both under a unit-shaped redirect and by hand.
- **The inventory gate fails on an undeclared state path**, asserted by a fixture script that writes one inside the sandbox.

## Slices

### Scripts share one temp helper (Branch: bug/scripts-share-one-temp-helper)

Layers 1 and 2: `plot-tmp.sh` with assignment by name, the file-backed exit registry and the re-raising signal traps; the migration of all 14 `mktemp` sites, the nine fixed-name `/tmp` paths and the 8 traps; the gate; the fleet-scan cache rename; the reaper's sweep over `plot-*` entries and dead-pid memo directories; the registryd `--sweep-temp` flag in both units; and the scan's advisory counts.

### The suites own their temp root (Branch: bug/the-suites-own-their-temp-root)

Layers 3 and 4: `scripts/owned-run.sh` with the private `TMPDIR`, `HOME` and `PLOT_BUDGET_HOME`, the original-environment registry check, the signal traps, the leak gate, and the per-file fixes that make it pass. It needs the first slice: without templated script paths the gate is blind on macOS and red on Linux.

### Every state file declares its bound (Branch: bug/every-state-file-declares-its-bound)

Layer 5: two-generation rotation of the budget ledger with the generation counter, the stale-lock recovery and the removal of `truncate()`; process-owned log rotation; the board-project cache move; and the inventory gate. It needs the second slice: the inventory gate runs inside that slice's sandbox, and its `HOME` redirect keeps the suites out of the ledger this slice bounds.

## Notes

**The 365 was the second measurement.** The issue first said a killed run skipped cleanup. One clean run showed the leak is the normal path, and #1083 carries that correction.

**The slices land in order.** The first changes scripts, the reaper and the supervisor's flag, the second changes the test wrappers and tests, and the third changes the ledger, the two log writers and adds one contract test. Each depends on the one before it, as the slice texts state, so the slice order is the dependency order.

### Round 1, 2026-09-30

Two jurors, `suites` and `state`, both `amend` on executed evidence. The round changed the plan in these places:

- The draft claimed a per-run `TMPDIR` covers every script's temp path. macOS `mktemp` without a template ignores `TMPDIR`, so the templated helper moved to the first slice and became a precondition of the leak gate, and the claim that any slice can land first was removed.
- The `host.test.mjs` site counts were corrected from 17 and 3 to 39 and 10. The `/tmp` literal Done-when became a stated result: none of the 73 creates a file.
- The wrapper now runs the registry check with the original environment, traps INT and TERM itself, and names its root `plot-run.*`.
- The registryd log bullet now names the hand rotation and the 13-day span, and the size bound rests on the measured tick-size range instead of "one day".
- The `truncate()` caller was replaced by two-generation rotation, after the port's write-aside lost 59 of 600 concurrent appends and no production code read the ledger through the port.
- The suites' writes to the operator's ledger, the `memo/` directories, the sweep's caller, the exit registry, and the observed-writes inventory gate were added.
- The sweep's safety argument changed from process lifetime to call-scoped temp paths, because the board and the supervisor run for days.

### Round 2, 2026-09-30

One juror, `r2-1083`, `amend` on executed evidence. The round changed the plan in these places:

- The sweep matched `tmp.*`, which is the default name of every template-less macOS `mktemp` from any program. It now removes only `plot-*` entries and dead-pid memo directories; legacy `tmp.*` caches are counted and reported, never removed. The juror's own cleanup command, `rm -rf "$(getconf DARWIN_USER_TEMP_DIR)"tmp.*`, removed every `tmp.*` entry in the operator's temp directory, which shows the hazard directly.
- A Safety paragraph was added: no script, test or sweep deletes by glob in a shared temp directory, and the gate refuses such an `rm`.
- The ledger reader read `.1` before the current file and skipped the live generation when a rotation fell between the two reads. It now reads current first under a generation counter and retries on a change.
- The rotation lock had no recovery: after a SIGKILL of the rotator, rotation stopped for good. A stale lock is now broken, recorded and reported.
- The draft named `plot-fleetctl.sh --once` as a scheduled caller of the sweep. Nothing schedules it, and `--once` performs nothing by contract. The supervisor now runs the sweep behind an opt-in `--sweep-temp` flag, and the reconcile scan reports what a sweep would remove.
- The helper's call form `d=$(plot_tmpdir x)` removed or leaked its path depending on when the trap was installed. It now assigns by name and keeps a file-backed registry keyed by `$$`, and its traps re-raise INT and TERM, because the existing trap shape swallowed the signal and exited 0.
- The `/tmp` inventory grew from two sites to nine fixed-name temp paths in three scripts plus one persistent cache in a fourth, and slice 1 migrates all of them so its own gate passes.
- The 0.2 s Done-when bound measured process start and machine load. It is replaced by a bound on the lines a reader reads.
- `fleet.ts:1870` was corrected to `:1880`, the `O_APPEND` question was closed by `lsof +fg`, and the window assertion now reads `FALLBACK_WINDOW_MS`.
