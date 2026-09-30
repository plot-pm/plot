# Every temp directory has an owner

> A clean, all-green run of one contract file leaves 365 directories in `$TMPDIR`, and a fleet scan leaves one per poll. Cleanup is written per call site and most call sites omit it, so the fix makes removal a property of the run rather than of each site.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Issue:** #1083
- **Review:** in-session
- **Impl:** own branches

## Changelog

- Plot's contract suites and helper scripts remove every temporary directory they create, and CI fails a test that leaves one behind.

Board impact: none. No plan-format, template or payload change; `plot-fleet-scan.sh` changes only how it cleans up.

## Motivation

Measured 2026-09-30 on a developer machine after about two months of Plot development: `$TMPDIR` held 277,669 entries, and 141,249 were `plot-*` directories. The directory's link count read 65535.

### The suites leak on the normal path

One run of `test/reconcile/host.test.mjs` with `TMPDIR` set to an empty directory, 266 tests, 266 pass, 0 fail, left **365 entries**:

| Prefix | Left behind |
|---|---|
| `plot-host` | 126 |
| `plot-host-jira` | 36 |
| `plot-host-jenbin` | 27 |
| `plot-host-bb` | 26 |
| `plot-host-jen` | 23 |
| `plot-host-rate` | 22 |

The file has 17 `mkdtempSync` sites and 3 `rmSync` calls. 13 files under `test/reconcile/` call `mkdtempSync` and contain no cleanup. No test failed and no run was killed. Every `pnpm run test:contracts` in every worktree adds to the directory.

### The fleet scan replaces its own EXIT trap

`plot-fleet-scan.sh:581-583` creates an unnamed `mktemp -d` and sets `trap 'rm -rf "$HOST_STATE_CACHE"' EXIT INT TERM`. `:2585-2588` sets `trap 'rm -rf "$REF_TMP"' EXIT INT TERM` in the same shell. The second `trap` replaces the first. Reproduced with those two statements in a scratch script:

```
unnamed dir: tmp.WgCQwchlM9  survives=YES
ref dir:     plot-fleet-ref.KXl6Zz  survives=no
```

The board runs the scan every 5 s. The machine held 20,939 `tmp.*` entries.

### Per-site cleanup is a rule

`test/reconcile/` holds 360 `mkdtempSync` sites. Each one needs its own `rmSync`, and nothing checks that it has one. By this repository's own test, that is a rule: a reviewer can answer "does this test clean up?" with yes without running it.

## Design

### The rule

**A run owns one temp root, removes it when the run ends, and fails when anything it created is still present.**

### Layer 1: the suite owns `TMPDIR`

`test:contracts` and `test:board` set `TMPDIR` to a fresh directory under the system temp directory, one per run, for the whole process tree. `os.tmpdir()` reads `TMPDIR`, and so do `mktemp` and every script's `${TMPDIR:-/tmp}`. That covers the 347 `tmpdir()` sites without changing them.

The wrapper removes the root when the run ends, whatever the exit code. A killed run leaves **one** directory rather than 365.

`scripts/bounded.sh` already wraps both suites and sends SIGTERM, then SIGKILL 30 s later. The root lives in the process that owns the bound, so cleanup is not a step inside the run that a signal can skip.

### Layer 2: the leak gate

Before the wrapper removes the root, it lists what is still inside. A non-empty root fails the suite and names each entry and its prefix.

**This avoids the snapshot problem `scripts/check-registry-not-leaked.mjs` describes.** That gate refuses a before/after comparison of the shared registry because the supervisor writes to it during a run. The per-run root is private: no supervisor, board or other agent writes into it. An entry present at the end came from this run.

The gate is what keeps the fix. Without it, the 361st `mkdtempSync` site brings the leak back.

**It needs a migration step, not a flag day.** The first run of the gate fails on today's 365-entry file. Slice 1 fixes the leaking files, or gives each a `t.after` cleanup, until the gate passes. A temporary allow list is acceptable only when it names each file with its measured count and can only shrink, like the spawn ratchet in `ci.yml`.

### Layer 3: scripts get one temp helper

A sourced helper, `plot-tmp.sh`, gives a script `plot_tmpdir <prefix>`. It creates the directory, records it, and installs **one** EXIT/INT/TERM trap that removes every recorded directory. A second call adds to the list; it does not replace the trap.

`plot-fleet-scan.sh`'s two `mktemp -d` calls, and the other scripts that call `mktemp -d`, move to the helper. That fixes the overwrite by construction.

A grep gate in `scripts/` refuses a raw `mktemp -d` in `skills/plot/scripts/*.sh` outside the helper. It follows `scripts/check-host-cli-callers.sh`, including a named exception list.

### Layer 4: a backstop sweep for SIGKILL

A trap does not run on SIGKILL. The board ends a scan at its 90 s timeout, and `bounded.sh` escalates to SIGKILL. So some directories outlive any trap.

`plot-reap.sh` gains a sweep of `$TMPDIR/plot-*` and `$TMPDIR/tmp.*` entries **owned by this user and older than a bound** (default 24 h, from a `Temp sweep after` config key). It follows the reaper's own rules: `--dry-run` by default, `--yes` removes, and it reports each entry.

**The age bound is the safety argument.** No Plot process runs longer than `Worker bound` (28,800 s). An entry older than 24 h cannot belong to a live run.

**`tmp.*` is included only because the fleet scan named its directory that way.** Layer 3 gives that directory a `plot-` prefix, so a later version can drop `tmp.*` from the sweep and stop touching other tools' files.

### What this does NOT do

- **It does not change what any test asserts.** Only where its sandbox lives.
- **It does not sweep the whole temp directory.** Only `plot-*` and, for now, `tmp.*` entries this user owns, past the age bound.
- **It does not claim the leak caused the app-launch fault** seen the same day. Removing 141,249 directories restored neither LaunchServices nor `getconf DARWIN_USER_CACHE_DIR`.

## Done when

- **One run of `test/reconcile/host.test.mjs` leaves zero entries in its `TMPDIR`**, measured the same way as the 365 above.
- **`pnpm run test:contracts` fails when a test leaves an entry**, asserted by a fixture test that creates one on purpose and checks that the run names it.
- **A killed contract run leaves at most one directory**: send SIGKILL to the run mid-suite and count.
- **`plot-fleet-scan.sh` leaves no directory on a normal exit**, including the host-state cache the second trap used to replace. The two-statement reproduction above becomes a test.
- **A raw `mktemp -d` added to a script fails CI** by name.
- **The sweep removes an owned `plot-*` directory older than the bound and keeps a younger one**, with `--dry-run` as the default.
- **The 74 hardcoded `'/tmp'` literals are classified**: 14 in `test/reconcile/` and 60 in `packages/board/test/`. A literal that creates a file moves under `TMPDIR`; one that is only fixture data stays and is named as such.

## Slices

### The suites own their temp root (Branch: bug/the-suites-own-their-temp-root)

Layers 1 and 2: per-run `TMPDIR` in the wrapper, the leak gate, and the fixes that make it pass.

### Scripts share one temp helper (Branch: bug/scripts-share-one-temp-helper)

Layers 3 and 4: `plot-tmp.sh`, the `mktemp -d` gate, the fleet-scan trap fix, and the reaper's age sweep.

## Notes

**The 365 was the second measurement.** The issue first said a killed run skipped cleanup. One clean run showed the leak is the normal path, and #1083 carries that correction.

**The two slices are independent.** Slice 1 changes test wrappers and tests; slice 2 changes scripts and the reaper. Either can land first.
