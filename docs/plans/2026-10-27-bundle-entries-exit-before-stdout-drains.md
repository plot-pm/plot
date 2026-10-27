# Bundle entries exit before stdout drains on macOS

> Entries under `packages/*/src/server/entry/` call `process.exit()` after writing to stdout, which cuts any answer over 64 KB on a macOS pipe; the entries must end by setting `process.exitCode`, and a gate must refuse the old ending.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2747
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- Bundle entries deliver their whole stdout to a pipe reader on macOS. An answer over 64 KB was cut at 65536 bytes.

<!-- Board impact: none. The plan format, template, helper scripts and docs/plans layout do not change. The entries are board-package code and the shipped bundles are rebuilt by main after merge. -->

## Motivation

`process.exit()` does not wait for pending stdout writes. Node writes to a pipe asynchronously on macOS and synchronously on Linux. Measured 2026-10-27 on macOS: `node -e "process.stdout.write('x'.repeat(1e6)); process.exit(10)" | wc -c` prints `65536`.

The defect surfaced in the #2731 review of `plot-listing-walk.mjs`. Commit `da194bcaf` fixed that one entry: it sets `process.exitCode` and ends on its own, and a test pipes about 200 KB through the built entry (the old code delivered 65536 of 201043 bytes). Measured on `origin/main` for this plan: 60 `process.exit(` lines under `packages/board/src/server/entry/` and 6 files with one each under `packages/fleet/src/server/entry/`. A shell consumer that reads a cut answer sees malformed or empty JSON.

CI runs on Linux, where the write is synchronous, so no test sees the truncation. A new entry written in the same shape passes CI and fails on an operator's Mac.

The issue lists 19 board entries that end with `process.exit(run(...))` after a stdout write and 7 that end with `process.exit(await run(...))`: `deliver.ts`, `verify.ts`, `approve.ts`, `reap.ts`, `needs-design.ts`, `design.ts`, `record-pr.ts`. Which of the 7 write an answer over 64 KB has not been traced.

## Design

### Approach

Two changes, in this order, because the gate fails on the tree as it stands.

1. **Entries.** Replace the ending `process.exit(code)` with `process.exitCode = code` where the entry has nothing left to run. The process then ends when stdout drains. Where the entry holds an open handle that keeps the loop alive (a server, a timer, a child), the entry closes it before the assignment, or writes with a callback and exits in the callback. Each entry's existing exit code stays unchanged.
2. **Gate.** A script under `scripts/` refuses a `process.exit(` call in `packages/*/src/**/entry/` that follows a `process.stdout.write` or an `out`/`write` callback bound to stdout in the same file. It joins the `Local checks` `**` line and the CI gate list. It carries a ratchet, or an explicit allow-list with a reason per line, for an exit that follows no stdout write (an argument error before any output, `transition.ts:364`).

### Open Questions

- [ ] Does a static gate on `process.exit(` text in `entry/` hold, or does it need the call graph? An exit inside a helper that the entry calls after a write is invisible to a grep.
- [ ] Which of the 7 `await run(...)` entries can write over 64 KB? The fix is the same for all 26, so the trace changes the test list and not the change.
- [ ] Can a test fail on Linux? A pipe test passes on Linux with the old code. A test that replaces `process.stdout.write` with an asynchronous stub and asserts the entry ends without `process.exit` can fail on both platforms.
- [ ] Do `packages/board/src/server/index.ts`, `lifetime.ts` and `packages/fleet/src/shared/board-run.ts` belong to the gate's scope? They call `process.exit(` but are not entries.

## Slices

### Entries

- `feature/bundle-entries-end-by-setting-exit-code` — every `process.exit(` under `packages/*/src/server/entry/` that follows a stdout write sets `process.exitCode` instead, with one test that drives an entry through an asynchronous stdout stub <!-- builds: entry exit helper, a shared ending for bundle entries, if three or more entries need the same close-then-set shape -->

### Gate

- `feature/a-gate-refuses-process-exit-after-stdout` — a `scripts/check-*.sh` gate that refuses a new `process.exit(` after a stdout write in an `entry/` directory, wired into `Local checks` and `ci.yml` <!-- builds: check-entry-exit.sh, a gate on process.exit in entries --> <!-- waits: feature/bundle-entries-end-by-setting-exit-code -->

## Notes

- Created by `/plot-idea` from tracker issue #2747. The plan stops at Draft.
- Deliverable search (`plot-deliverable-search.sh`, "process.exit after stdout write gate in entry") found no existing gate. It listed `process.exit` sites in `packages/domain/src/adapters/` (signal handlers, out of scope) and `scripts/`.
- Reference fix: `da194bcaf` (`plot-listing-walk`).
- Definition of Done: `docs/definition-of-done.md`.
