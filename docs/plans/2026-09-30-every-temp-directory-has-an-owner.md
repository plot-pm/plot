# Every file Plot writes has an owner

> A clean, all-green run of one contract file leaves 365 directories in `$TMPDIR`, a fleet scan leaves one cache directory per run, and the budget ledger grows about 30,000 lines a day with no bound. Cleanup is written per call site and most sites omit it. The fix makes removal a property of the run, puts every script temp path under `TMPDIR`, and gives every state file a declared bound.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Issue:** #1083
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- Plot's helper scripts create every temporary path under `TMPDIR` through one helper, and one exit registry removes them.
- Plot's contract suites run inside a private temp root and a private `HOME`, and CI fails a test that leaves an entry behind.
- The budget ledger rotates into two generations without losing an append, supervisor and board logs rotate by size, and every file Plot writes declares its bound.

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

### macOS `mktemp` ignores `TMPDIR` without a template

On macOS, `mktemp` with no template, and `mktemp -t`, write to `_CS_DARWIN_USER_TEMP_DIR` and ignore `TMPDIR` (`man mktemp`). Measured with `TMPDIR` set to a scratch directory: `mktemp -d` returned `/var/folders/.../T/tmp.1JyBNYiAoy`, while `node -e 'os.tmpdir()'` returned the scratch directory.

Five script sites use the template-less form: `plot-fleet-scan.sh:581`, `plot-board-verify.sh:28`, `plot-install-hooks.sh:177`, `plot-reconcile-scan.sh:477` and `plot-reconcile-scan.sh:2966`. Two more hardcode `/tmp`: `plot-host.sh:861` (`/tmp/plot-host-sweep.$$.XXXXXX`) and `plot-host.sh:933` (`/tmp/plot-host-window.$$.XXXXXX`). A per-run `TMPDIR` therefore does not contain these paths on macOS.

On GNU `mktemp`, which an `ubuntu-latest` runner has, the template-less form honours `TMPDIR`. With `gmktemp` first on PATH, four scan-running files left **98 `tmp.*` entries** in a private root: `fleet` 82, `fleetrefplans` 11, `fleetclaimable` 4, `fleetderived` 1. With stock macOS `mktemp` the same `fleetrefplans` run left 0 in the root and 12 in `/var/folders/.../T`.

### The fleet scan replaces its own EXIT trap

`plot-fleet-scan.sh:581-583` creates an unnamed `mktemp -d` and sets `trap 'rm -rf "$HOST_STATE_CACHE"' EXIT INT TERM`. `:2585-2588` sets `trap 'rm -rf "$REF_TMP"' EXIT INT TERM` in the same shell. The second `trap` replaces the first. Reproduced with those two statements in a scratch script, and in a `bash -x` trace of the live scan:

```
unnamed dir: tmp.WgCQwchlM9  survives=YES
ref dir:     plot-fleet-ref.KXl6Zz  survives=no
```

Measured 2026-09-30, `$TMPDIR` gained 24 `tmp.*` directories between 09:28 and 09:52 with one board running, about one a minute: the scan takes longer than the board's 5 s poll, so a scan starts about once a minute. The machine held 20,939 `tmp.*` entries.

Seven scripts install their own EXIT trap: `plot-board-verify.sh`, `plot-dispatch.sh`, `plot-host.sh`, `plot-fleet-scan.sh` (twice), `plot-install-hooks.sh`, `plot-resolve-artifact.sh` and `plot-worker-loop.sh`. `plot-host.sh:2655` owns `trap 'budget_memo_clear' EXIT`, so a script that sources `plot-host.sh` and sets its own EXIT trap repeats the fleet-scan defect.

### Per-site cleanup is a rule

`test/reconcile/` holds 360 `mkdtempSync` sites. Each one needs its own `rmSync`, and nothing checks that it has one. By this repository's own test, that is a rule: a reviewer can answer "does this test clean up?" with yes without running it.

### Persistent state has no bound either

Measured 2026-09-30:

| File | Size | Bound |
|---|---|---|
| `~/.plot/state/budget.tsv` | 46 MB, 828,680 lines over 27 days | none |
| `~/.plot/state/memo/<pid>/` | 347 directories, 2.1 MB, oldest 2026-09-22 | removed on exit; leaked on SIGKILL |
| `~/.plot/state/slots/` | fixture-account directories from the suites | none |
| `.plot/logs/registryd.log.2026-09-21` | 131 MB over 13 days, renamed by hand | none |
| `.plot/logs/board.log` | 2.4 MB | none |
| `.plot/logs/registryd.log` | 1.7 MB since 2026-09-22 | none |
| `.plot/logs/registryd.err` | small | none |
| PR index, `.git/.plot/state/` | 380 KB | one row per PR |
| `.plot/state/` receipts, pulse, controls | 356 KB | spent or overwritten |
| `.plot/state/unowned-*.tsv` | 242 lines | kept on purpose; the count is the record |
| per-desk `.plot-worker.*` | ~12 KB per desk | removed with the desk by `plot-reap.sh` |

**The ledger costs every GitHub call about 1.1 s.** `plot-host.sh:1717-1722` (`graphql_budget_spent`) calls `budget_rate` before it routes a GitHub call, and `budget_rate_read` reads the whole file in one `awk` pass. Measured on a scratch copy: `plot-host.sh spend-rate` takes 1.23-1.25 s over the 46 MB file and 0.05 s over its last 2,000 lines; `budget_rate github jwloka graphql` takes 1.11 s against 0.01 s.

**The ledger has a pruning port and no caller.** `plot-budget.sh:11-16` says the shell *"appends and reads, and it never prunes"* and leaves truncation to the `BudgetRecord` port's `truncate()` (`ports/budget.ts:93`). Neither `truncate()` nor the port's `lines()` and `survivors()` has a production caller, and `budgetFile` itself has none. The supervisor (`registryd-main.ts:267-288`) and the board (`fleet.ts:1870`) read the ledger only through `plot-host.sh spend-rate`. The port's `truncate()` also loses appends: its write-aside-and-rename ran over a scratch copy of the 46 MB file while four shell loops appended 600 lines through `plot-budget.sh`, and **59 of the 600 appends were lost** in one 660 ms window (58 ms read, 597 ms `survivors`, 5 ms write). A line appended between the read and the rename is not in the kept set, and an appender whose `O_APPEND` descriptor opened the old inode writes into the unlinked file.

**The registryd log was rotated by a person.** `~/.bash_history:197030-197038` holds `plot-fleetctl.sh --stop`, then `mv .plot/logs/registryd.log .plot/logs/registryd.log.2026-09-21`, then `plot-fleetctl.sh --start 1`. The file's birth time is 2026-09-08 16:24 and its last write 2026-09-21 15:52. No unit, script, registryd source or `newsyslog` entry rotates it. Its 13,342 tick lines average about 10 KB each, because a tick then listed every `held on not-claimable` branch, up to 257. Today's log holds 5,944 ticks in 1.7 MB, about 290 bytes a tick, or about 0.4 MB a day at one tick a minute. Tick size depends on the estate, so the bound is on bytes.

**Neither log is opened by the process that writes it.** launchd opens `registryd.log` through the unit's `StandardOutPath` (`com.plot-pm.registryd.plist:80-83`). `plot-boardctl.sh:423-425` opens `board.log` with `>>` before it `exec`s the board. A second writer also exists: `~/.bash_history:34129` holds a hand-started `nohup bash -c 'while true; do node .../plot-registryd.mjs --start-agents >> .plot/logs/registryd.log ...'`. A process cannot rename a file another process opened for it and expect the opener to follow.

**Nothing runs the reaper's removal.** No script calls `plot-reap.sh --yes`. `plot-fleetctl.sh` and the supervisor name it, and the supervisor decides and performs nothing.

## Design

### The rule

**A run owns one temp root, removes it when the run ends, and fails when anything it created is still present. Every temp path a script creates lies under `TMPDIR`. Every file Plot writes outside a temp root declares its bound.**

### Layer 1: scripts create every temp path through one helper

A sourced helper, `plot-tmp.sh`, gives a script two functions:

- `plot_tmpdir <prefix>` and `plot_tmpfile <prefix>` create a path with an explicit template, `"${TMPDIR:-/tmp}/plot-<prefix>.XXXXXX"`, with the X's trailing, which BSD `mktemp` requires. The template is what makes the path honour `TMPDIR` on macOS. Each call records the path for removal.
- `plot_on_exit <command>` adds a command to one exit registry. The helper installs the only `trap ... EXIT INT TERM` in the process, and that trap runs every registered command and removes every recorded path. A second registration adds to the list and never replaces the trap.

All five template-less `mktemp` sites, the two hardcoded `/tmp` spools in `plot-host.sh`, and every other `mktemp` in `skills/plot/scripts/*.sh` move to the helper. All eight EXIT traps in the seven scripts move to `plot_on_exit`, `plot-host.sh`'s `budget_memo_clear` included. That fixes the fleet-scan overwrite by construction. The fleet scan's unnamed cache becomes `plot-fleet-host-state.*`.

**A grep gate holds it.** A check in `scripts/`, modelled on `scripts/check-host-cli-callers.sh` and with a named exception list, refuses in `skills/plot/scripts/*.sh` outside `plot-tmp.sh`: any `mktemp` call, a `/tmp/` path literal in a write, and any `trap` that names `EXIT`, `INT` or `TERM`. The defect is the missing template and the second trap, so the gate refuses both, not only `mktemp -d`.

### Layer 2: a backstop sweep for SIGKILL

A trap does not run on SIGKILL. The board ends a scan at its 90 s timeout, `bounded.sh` escalates to SIGKILL, and a person kills a hung script. So some paths outlive every trap. A scratch script with an EXIT-only trap kept its directory under SIGKILL only: TERM, INT and HUP each left 0, KILL left 1.

`plot-reap.sh` gains a sweep of two populations, both **owned by this user and older than a bound** (default 24 h, from a `Temp sweep after` config key):

- `$TMPDIR/plot-*` entries, and `$TMPDIR/tmp.*` entries until every release that still writes the unnamed fleet-scan cache has aged out.
- `$PLOT_BUDGET_HOME/memo/<pid>` directories (default `~/.plot/state/memo/`) whose pid is not alive. A reused pid keeps its directory until that process exits; 4 of 347 measured pids were live.

It follows the reaper's own rules: `--dry-run` by default, `--yes` removes, and it reports each entry.

**The age bound is safe because no temp path outlives the call that made it.** Every Plot temp path found on this estate belongs to one script call, one scan or one board request: `lsof` on the running board and both registryd processes showed no open file under `$TMPDIR` or `/tmp`, and the board's `mkdtempSync` sites (`board.ts:1831, 1857, 2326`) are per request. The board and the supervisor run for days, so process lifetime is not the argument. A 24 h bound is about 1,000 times the 90 s scan timeout.

**The sweep has a caller.** `plot-fleetctl.sh --once` runs the sweep with `--yes` after its tick, because a tick is the one operator command already run on a schedule, and the sweep's licence is the age bound plus ownership, both measurements. Without a supervisor, the sweep runs when a person runs `plot-reap.sh --yes`, and the plan states that limit rather than claiming a backstop that nothing runs.

### Layer 3: the suite owns `TMPDIR` and `HOME`

`test:contracts` and `test:board` run inside a wrapper, `scripts/owned-run.sh`, that wraps the whole script string, `bounded.sh` included. The wrapper:

1. Creates one root, `"${TMPDIR:-/tmp}/plot-run.XXXXXX"`. The `plot-` prefix puts a root that a SIGKILL of the wrapper leaves inside Layer 2's sweep.
2. Sets `TMPDIR`, `HOME`, `PLOT_BUDGET_HOME` and `PLOT_PR_INDEX_HOME` to directories inside the root for the whole process tree. `os.tmpdir()` reads `TMPDIR`, and after Layer 1 every script path does too, so the 347 `tmpdir()` sites stay unchanged. The `HOME` and `PLOT_BUDGET_HOME` redirect is what stops the suites writing to the operator's ledger and `slots/`.
3. Runs the suite, then runs `scripts/check-registry-not-leaked.mjs` with the **original** `TMPDIR` and `HOME`. That check builds its temp set from `os.tmpdir()` (`:116`); inside the root it would lose `/var/folders/.../T` from the set.
4. Runs the leak gate (Layer 4) and removes the root, whatever the exit code.

The wrapper traps INT and TERM itself, because a Ctrl-C or a CI cancel signals the wrapper as well as its child, and `bounded.sh` installs no trap. It also covers `bounded.sh`'s unbounded branch, where no `timeout` is on PATH and `bounded.sh` runs the command directly. `bounded.sh` already returns to its caller after it kills the child, so the wrapper survives a child SIGKILL and removes the root. A SIGKILL of the wrapper itself leaves one `plot-run.*` directory, which the sweep removes.

**Environment inheritance holds.** 181 `env: {` literals in `test/reconcile` and `packages/board/test` were sampled at 7 call sites, and every helper they reach spreads `...process.env`. No test clears the environment. `fleetrefplans.test.mjs:274` sets `TMPDIR` to a path taken from `os.tmpdir()`, which stays inside the root.

### Layer 4: the leak gate

Before the wrapper removes the root, it lists what is still inside the temp directory. A non-empty list fails the suite and names each entry and its prefix.

**This avoids the snapshot problem `scripts/check-registry-not-leaked.mjs` describes.** That gate refuses a before/after comparison of the shared registry because the supervisor writes to it during a run. The per-run root is private: no supervisor, board or other agent writes into it. An entry present at the end came from this run. Across 11 files, 3 of them with `detached: true` spawns, the count at exit equalled the count 40-45 s later, and no process held a path in the root after exit.

**The gate is authoritative on macOS and Linux because Layer 1 lands first.** Before Layer 1, macOS scripts write outside the root, where the gate cannot see them, and GNU `mktemp` puts 98 `tmp.*` entries inside it, where the gate fails on a defect this slice does not own. After Layer 1, both platforms create every script path under `TMPDIR`.

**The gate cannot see writes under `HOME`.** Layer 3 redirects them into the root, so they cannot reach the operator's machine, and Layer 5's inventory gate reads them. The leak gate reads only the temp directory.

**It needs a migration step, not a flag day.** The first run of the gate fails on today's leaking files. Slice 2 fixes each file, or gives it a `t.after` cleanup, until the gate passes. The migration works from the measured per-file count, not from a grep of cleanup calls. A temporary allow list is acceptable only when it names each file with its measured count and can only shrink, like the spawn ratchet in `ci.yml`.

The gate is what keeps the fix. Without it, the 361st `mkdtempSync` site brings the leak back.

### Layer 5: every state file declares its bound

**The budget ledger rotates into two generations, and no append is lost.** The shell appender stays lock-free and append-only, which `plot-budget.sh` requires for `O_APPEND` atomicity below `PIPE_BUF` (512 on this fleet's macOS machines). Rotation works like this:

- The ledger is `budget.tsv` (current generation) and `budget.tsv.1` (previous generation).
- `budget_append` reads the first line's timestamp of `budget.tsv`, one `head -1`. When the current generation is older than the generation length (24 h), the appender takes a `mkdir` lock beside the file, re-reads the condition under the lock, renames `budget.tsv` to `budget.tsv.1`, and releases the lock. A rename is O(1) at any file size. The lock serialises rotations only; no append takes it. Two appenders that both see the condition rotate once, because the second re-reads a fresh generation under the lock.
- `budget_rate_read`, and the port's adapter, read `budget.tsv.1` and then `budget.tsv`. An append that races a rename lands in one of the two files, and the reader reads both. So no append is lost.
- The next rotation replaces `budget.tsv.1`. Every line in it is then at least one generation old, and 24 h is 24 times the port's `FALLBACK_WINDOW_MS` (1 h), so no line inside a live window is discarded. The slice asserts that the generation length exceeds every window a connector states, and refuses to rotate if a connector ever states a longer one.

At the measured 30,700 lines a day, the two generations hold at most about 61,000 lines. The slice measures `plot-host.sh spend-rate` at that size and records the figure in its commit; the Done-when bound is 0.2 s.

**The first rotation keeps the 46 MB file for one generation.** It becomes `budget.tsv.1` and leaves at the second rotation, 24 h later, so the per-call cost stays about 1.2 s for one day and then falls. Discarding it at once would drop the lines in the live window.

**The port's `truncate()` is removed.** It has no production caller, its write-aside loses appends (59 of 600 measured), and rotation replaces it. `plot-budget.sh`'s header changes from *"it never prunes"* to *"it appends, reads two generations, and rotates by rename"*. `truncate()`, `truncationOwed()` and the adapter's write-aside leave the port and adapter with their tests, and `lines()` reads both generations.

**Logs rotate in the process that writes them.** `registryd` and the board open their own log file with `O_APPEND` rather than writing to an inherited stdout. At a size bound (default 10 MB) the writer renames the file to `.1`, shifts older files up to `.3`, deletes the fourth, and reopens. A size bound, because tick size varied from 290 bytes to 10 KB with the estate. The process that opens a file is the only one that can rename it and follow the rename, and this covers a hand-started writer as well as launchd. The unit's `StandardOutPath` and `StandardErrorPath`, and `plot-boardctl.sh`'s redirect, keep only output printed before the writer opens and crash traces, and each process truncates its inherited stdout and stderr at start when they pass the bound. That truncate is safe only when the opener used `O_APPEND`; the slice verifies it for launchd and for the `>>` redirect before it relies on it.

**An inventory gate holds the rule, built from observed writes.** A static grep cannot list the paths, because writes are built from variables (`"$file.$BASHPID.tmp"`, `join(home, FILE)`). So the gate runs inside Layer 3's sandbox: after the contract suite, it lists every file under the sandbox's `HOME/.plot/`, the scratch repositories' `.plot/`, and the git common dir's `.plot/`, and matches each path against a checked-in manifest of globs. Each glob declares one bound: *overwritten*, *spent*, *window*, *rotated*, *removed on exit*, *removed with its desk*, *kept on purpose*, or *tracked in git*. A path no glob matches fails the test and names it. Its coverage is exactly what the suites execute; a write path no test reaches is not seen, and the manifest states that limit.

**It declares, it does not measure sizes.** A size check in CI would read a runner's fresh filesystem and pass every time. The declaration is what a reviewer and the test can both read.

### What this does NOT do

- **It does not change what any test asserts.** Only where its sandbox and its `HOME` live.
- **It does not move the hardcoded `'/tmp'` literals in the tests.** All 73 were classified and none creates a file: 12 in `test/reconcile/` (two comments in `reap-manifest`, ten plist placeholders in `fleetctl.test.mjs:644-685`) and 61 in `packages/board/test/`, all fixture data. `idea-route.test.ts:378` asserts that `/tmp/plot-pwned` does not exist, an injection canary that must stay literal.
- **It does not delete the `unowned-*.tsv` ledgers.** Their growth is one line per bypass, and the count is the record they exist to keep.
- **It does not clean the operator's existing ledger of fixture-account lines.** Rotation drops them within two generations.
- **It does not sweep the whole temp directory.** Only `plot-*`, `plot-run.*`, for now `tmp.*`, and dead-pid memo directories this user owns, past the age bound.
- **It does not claim the leak caused the app-launch fault** seen the same day. Removing 141,249 directories restored neither LaunchServices nor `getconf DARWIN_USER_CACHE_DIR`.

## Done when

- **No script creates a temp path outside `TMPDIR`**: with `TMPDIR` set to an empty directory on macOS, a fleet scan, a reconcile scan, `plot-board-verify.sh` and `plot-install-hooks.sh --verify` add no entry to `getconf DARWIN_USER_TEMP_DIR` or `/tmp`.
- **`plot-fleet-scan.sh` leaves no directory on a normal exit**, the host-state cache included. The two-statement reproduction above becomes a test.
- **A template-less `mktemp`, a `/tmp/` write, or a raw EXIT trap added to a script fails CI** by name.
- **The sweep removes an owned `plot-*` directory and a dead-pid memo directory older than the bound, and keeps a younger one and a live-pid one**, with `--dry-run` as the default. `plot-fleetctl.sh --once` runs it.
- **One run of `test/reconcile/host.test.mjs` leaves zero entries in its `TMPDIR`**, measured the same way as the 365 above, on macOS and with GNU `mktemp`. The four scan files `fleet`, `fleetrefplans`, `fleetclaimable` and `fleetderived` leave zero with GNU `mktemp`.
- **One run of `host.test.mjs` adds zero lines to the operator's `budget.tsv`** and creates nothing under the operator's `~/.plot/state/slots/`.
- **`pnpm run test:contracts` fails when a test leaves an entry**, asserted by a fixture test that creates one on purpose and checks that the run names it.
- **A killed contract run leaves at most one directory**, a `plot-run.*`: send SIGKILL to the run mid-suite and count. SIGINT and SIGTERM to the wrapper leave none.
- **`check-registry-not-leaked.mjs` still sees `/var/folders/.../T`** when it runs after a wrapped suite.
- **No append is lost across a rotation**: four concurrent appenders writing 600 lines while rotations fire leave all 600 readable by `budget_rate_read`.
- **`plot-host.sh spend-rate` answers in under 0.2 s** over a two-generation ledger at the measured daily rate.
- **`registryd.log` and `board.log` rotate at the bound and keep 3 files**, asserted by writing past the bound in a sandbox, with the writer started both under a unit-shaped redirect and by hand.
- **The inventory gate fails on an undeclared state path**, asserted by a fixture script that writes one inside the sandbox.

## Slices

### Scripts share one temp helper (Branch: bug/scripts-share-one-temp-helper)

Layers 1 and 2: `plot-tmp.sh` with templated paths and the exit registry, the migration of every `mktemp`, `/tmp` spool and EXIT trap, the gate, the fleet-scan trap fix, and the reaper's sweep over temp entries and dead-pid memo directories, called from `plot-fleetctl.sh --once`.

### The suites own their temp root (Branch: bug/the-suites-own-their-temp-root)

Layers 3 and 4: `scripts/owned-run.sh` with the private `TMPDIR`, `HOME` and `PLOT_BUDGET_HOME`, the original-environment registry check, the signal traps, the leak gate, and the per-file fixes that make it pass. It needs the first slice: without templated script paths the gate is blind on macOS and red on Linux.

### Every state file declares its bound (Branch: bug/every-state-file-declares-its-bound)

Layer 5: two-generation rotation of the budget ledger with the removal of `truncate()`, process-owned log rotation, and the inventory gate. It needs the second slice: the inventory gate runs inside that slice's sandbox, and its `HOME` redirect keeps the suites out of the ledger this slice bounds.

## Notes

**The 365 was the second measurement.** The issue first said a killed run skipped cleanup. One clean run showed the leak is the normal path, and #1083 carries that correction.

**The slices land in order.** The first changes scripts and the reaper, the second changes the test wrappers and tests, and the third changes the ledger, the two log writers and adds one contract test. Each depends on the one before it, as the slice texts state, so the slice order is the dependency order.

### Round 1, 2026-09-30

Two jurors, `suites` and `state`, both `amend` on executed evidence. The round changed the plan in these places:

- The draft claimed a per-run `TMPDIR` covers every script's temp path. macOS `mktemp` without a template ignores `TMPDIR`, so the templated helper moved to the first slice and became a precondition of the leak gate, and the claim that any slice can land first was removed.
- The `host.test.mjs` site counts were corrected from 17 and 3 to 39 and 10. The `/tmp` literal Done-when became a stated result: none of the 73 creates a file.
- The wrapper now runs the registry check with the original environment, traps INT and TERM itself, and names its root `plot-run.*`.
- The registryd log bullet now names the hand rotation and the 13-day span, and the size bound rests on the measured tick-size range instead of "one day".
- The `truncate()` caller was replaced by two-generation rotation, after the port's write-aside lost 59 of 600 concurrent appends and no production code read the ledger through the port.
- The suites' writes to the operator's ledger, the `memo/` directories, the sweep's caller, the exit registry, and the observed-writes inventory gate were added.
- The sweep's safety argument changed from process lifetime to call-scoped temp paths, because the board and the supervisor run for days.
