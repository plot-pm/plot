## Implementation brief — one-pr-reader-per-machine-and (wave: Board reader)

- **Plan (canonical):** [docs/plans/2026-10-23-one-pr-reader-per-machine-and.md](../../docs/plans/2026-10-23-one-pr-reader-per-machine-and.md) on `main`
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2401 merged
- **Branch:** `feature/boards-share-one-pr-reader` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review (plan's `Review: pr`)

This is the plan's last wave. Both prior waves are merged: "Index lock"
(`feature/pr-index-lock-beside-the-index`, PR #2718) and "fleetd lock"
(`feature/fleetd-holds-the-pr-index-lock`, PR #2723). Nothing waits on this
branch.

### What to build

Today, with no fleet running, every board for a repository asks the host for
PRs on its own 60 s timer (`maybeRefreshPrs` → `refreshPrs`, `fleet.ts:2328`,
`:2292`). Two boards for one repository therefore send the host the same PR
list request twice a minute. This slice gives those boards a shared reader
process (`plot-pr-reader.mjs`) so a second board for the same repository adds
zero PR list requests.

Build `packages/fleet/src/server/entry/pr-reader.ts` (bundled as
`plot-pr-reader.mjs`, no such file exists yet — this slice creates it), and
wire the board side in `packages/board/src/server/fleet.ts`:

1. **The reader entry.** Build the same `PrWorld` `registryd-main.ts:2200-2208`
   builds, and run it through `fleetPrs` (`packages/fleet/src/shared/fleet-clock.ts:166`)
   — the exact function fleetd now runs, already taking a `PrLock` and electing
   before every beat. The reader has no `scan` to drive `startFleetClock`
   (`fleet-clock.ts:74` requires one), so drive `startPulse`
   (`packages/domain/src/entities/pulse.ts:271`) directly with one PR
   subscriber at `PR_REFRESH_MS`. The reader runs no scan, no supervision tick,
   no issue read and no automatic write — it is `fleetPrs` and nothing else.
2. **Board-side election.** The board never calls `ReaderLock.elect` itself —
   that is reserved for whichever process (fleetd or the reader) actually reads
   the host. The board reads `ReaderLock.holder(key)` and runs it through the
   pure rule `electReader` (`packages/domain/src/rules/reader-election.ts:119`).
   `elect` with no live `fleetd` heartbeat → start the reader (if not already
   live) and serve this tick from the overlay as today. `follow` → read the
   index store (the existing `readPrsFromStore` path, `fleet.ts:2264`), now
   gated on "lock names a live holder" instead of only `fleetOwnsPrs`'s
   fleet-supervisor check. `unknown` → serve the overlay, start nothing.
3. **Starting the reader.** Through the `Detached` port
   (`packages/domain/src/ports/detached.ts`), exactly the pattern
   `handleNeedsDesign` already uses (`packages/board/src/server/needs-design.ts:79`):
   `(opts.detached ?? detachedNode()).node(script, args, opts.repoRoot, log)`.
   Args: `--lock-dir <abs lock dir> --connector <name>`. The board computes the
   lock directory itself and hands it to the reader verbatim — the reader must
   resolve no key of its own, so the two sides cannot disagree about which lock
   they mean. Log to `<repoRoot>/.plot/logs/pr-reader.log`
   (`packages/fleet/src/shared/process-log.ts:224`'s `logDir`); the `Detached`
   port truncates it at each start.
4. **Heartbeats.** Each board writes `ReaderLock.heartbeat(key, 'board.<pid>', now)`
   on every PR tick, whether it followed the lock, started a reader, or used
   its overlay. The reader counts live heartbeats
   (`heartbeatIsFresh`/`HEARTBEAT_STALE_MS`, `reader-election.ts:155`/`:137`,
   plus the pid+start-time liveness check the lock-slice's panel required) and
   exits when none remain, or when a live `fleetd` heartbeat appears — the one
   predicate ("fleetd reads PRs" = a live `fleetd` heartbeat) the reader's exit
   test and the board's spawn guard both read, so the board never starts a
   reader while fleetd already holds.
5. **Reader state on the board.** `readPrsFromStore` currently takes `prError`
   from the fleet bridge (`fleet.ts:2279-2280`) and forces `prNextIsBackoff =
   false` (around `:2284`). Change it to read `ReaderLock.readerState(key)`
   instead — `prError`, `prNextAt`, `prNextIsBackoff`, `prFullReadFailedAt` —
   so the board's backoff banner shows whichever holder (fleetd or reader) is
   actually paying the host's rate limit, not a fleet-only view of it.
6. **"Who reads PRs."** A domain rule over the lock's holder (fleetd / reader
   pid / nobody — falls back to "this board") that the board renders as a
   string: `fleet`, `reader <pid>`, or `this board`.

### Decisions already settled — do not re-derive them

**`fleetPrs` already elects; this slice does not touch its signature or its
election/fence logic.** PR #2723 (merged 2026-10-27) rewrote
`fleet-clock.ts:fleetPrs` to take a `PrLock`, call `prLock.lock.elect` before
the cadence gate, skip the whole pass on `held`, fence the fold via
`refreshPrs`'s new `world.fenceFold` callback (`pr-refresh.ts:141-150`,
checked immediately before `writePrStore`), and publish `writeReaderState` +
`heartbeat('fleetd', …)` on every pass it held — whether or not the fold
happened that beat. The reader entry reuses this exact function with its own
`PrLock`; it does not reimplement election. Verify this by reading
`packages/fleet/src/shared/fleet-clock.ts:154-270` before writing the reader
entry — the plan's prose describes the mechanism in the abstract, the merged
code is the concrete shape to copy.

**The board never elects — it only reads `holder()` and runs `electReader`.**
`ReaderLock.elect` (`packages/domain/src/ports/reader-lock.ts:51`) is "take the
lock for THIS process." A board that called it would be claiming to be a PR
reader itself, which it is not: it has no `fleetPrs` loop, no cadence state,
nothing to renew the claim with. The port's `holder()` (read-only, no side
effect) plus the rule `electReader` is the only combination that answers "who
should read PRs right now" without the board accidentally taking the lock.

**The key has no account segment.** `(realpath(common git dir), connector)`
only — settled in the Index lock slice, re-affirmed by the plan's Open
Questions: "Does the design differ by connector? No." `resolveBackend`
(`pr-refresh.ts:1021`) is the existing function that resolves the connector
name; reuse it rather than re-deriving a key.

**Heartbeat liveness needs more than file age.** `heartbeatIsFresh` alone
(age-only) is deliberately incomplete per its own TSDoc
(`reader-election.ts:140-149`): "those checks need a process-table read
`reader-lock-file.ts` does not make... The caller that owns a live process
reading combines this with pid liveness and the skew check." That caller is
this slice's reader, reading all heartbeat pids in one `ps -o pid=,lstart= -p
<pids>` call per beat (plan's Reader lifetime section) — not a separate `ps`
call per heartbeat.

**Only PRs move to the lock; issues do not.** `fleetOwnsScan`
(`packages/domain/src/rules/scan-owner.ts:37`) stays the issue read's gate in
both `maybeRefreshPrs` and `issueCadence` (`fleet.ts:2334`/`:1742`,
`:1742`-ish). While only a reader runs (no fleet), the board keeps reading
issues from the host directly, exactly as today. Do not fold the issue read
into the lock — the plan is explicit that PRs and issues now answer to two
different predicates.

**No change to `one-pr-index-writer.test.ts` / `one-issue-index-writer.test.ts`
expectations.** The board still writes no index — it writes heartbeats through
the lock adapter and hands the reader a path, not a store. If a change to
`fleet.ts` makes either test fail, the change is wrong, not the test.

### Done when

The plan's `## Done when` is this wave's own acceptance line, quoted from the
Slices section:

> With no fleet and two boards for one repository, one `plot-pr-reader.mjs`
> process runs, `.plot/logs/pr-reader.log` shows one elected pass per minute,
> the reader survives the exit of the board that started it, it exits within 2
> minutes after the last board, and `budget.tsv`'s `github graphql` rate with
> two boards matches the rate with one board.

Each clause is a real test, not a description:
- "one process runs" — a test starting two board instances against one
  repository must prove a second `Detached.node` call never happens once the
  first reader is live (mirrors the existing `BuildBoardOptions.detached`
  recording-fake seam, `needs-design.ts:14-19`).
- "survives the exit of the board that started it" — the reader's exit check
  must be heartbeat-count-based, never tied to the pid of whichever board
  issued the start.
- "exits within 2 minutes" — `HEARTBEAT_STALE_MS` (120 000 ms,
  `reader-election.ts:137`) is the bound a test asserts against, not a
  rounded "soon."
- the `budget.tsv` rate claim needs no automated test (it is an operator
  measurement over real traffic) — do not invent one.

Also lift, because a naive implementation passes without them:
- **A board test run starts no real reader.** The plan requires this
  explicitly (Board behaviour § Test seam). Pass a recording fake through
  `BuildBoardOptions.detached` in every board test that exercises the PR
  refresh path, the same way `needs-design.test.ts` already does.
- **Reader tests wait on the reader's own pid before teardown.**
  `scripts/owned-run.sh` fails a run on a late-exiting entry — a reader test
  that does not await the spawned process's exit will intermittently fail
  `test:contracts`/`test:board`, not this test itself.
- **A renewing holder is never read as "no holder."** The Index-lock slice's
  observable test (8-process race) already covers the lock primitive; this
  slice's own test should prove the board-side `electReader` call treats a
  freshly-renewed `fleetd` claim as `follow`, not `elect`.

Plus the repo's gates: a changeset (`.changeset/boards-share-one-pr-reader.md`,
description first, `bumps:` block last — the order is load-bearing, see
`CLAUDE.md` § Versioning), the shipping lines each gated —
`packages/fleet/build.mjs` entry (update the "seven entries" count at `:1`,
`:34`, `:38` — this slice makes it eight), the copy to
`skills/plot/scripts/board/plot-pr-reader.mjs` via `packages/board/build.mjs`
(pattern at `:330-343`), a `-merge` line in `.gitattributes`
(`scripts/check-bundle-attributes.sh`), and a row in
`skills/plot/scripts/README.md` (`scripts/check-helper-table.sh`). Also update
the stale text this slice's behaviour falsifies: `fleetOwnsPrs`'s doc
comment (`fleet.ts:2250-2252`), the wording at `fleet.ts:2271`/`:2277-2278`,
the bridge comment at `registryd-main.ts:2307-2308`, and the *A Decision
Reads The Index* § *One writer* paragraph in `CLAUDE.md` (name the reader as
the second process on the one writer path — the fleetd-lock slice already
added one paragraph there; this slice adds the reader's).

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before
each push and run what it prints. The suites in the `CI suites` config key
(`pnpm run test:e2e`, `test:contracts`, `test:board`, domain coverage, the
reconcile tests) run in CI; a failure there comes back as a correction. Do
not run the full suites locally as a matter of course — `test:e2e` in
particular dispatches real workers into sandbox repos and is CI's gate, not a
local one (`CLAUDE.md` § Testing).

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew
past its merge base. This slice adds no `.sh` file (the reader ships as a
`.mjs` bundle copied by `build.mjs`), so it should cost nothing here — but
verify no shell helper script was touched in passing before pushing.

### Bookkeeping

Open the PR through the controller once real work exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` directly — it takes the title from the last commit
subject and the plan/brief body goes missing. Push the first real commit as
soon as it exists, so the branch is visible before the PR opens.

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Slices` section, under the "Board reader" heading
(`docs/plans/2026-10-23-one-pr-reader-per-machine-and.md:208`).

### Scope guard

This branch owns:
- `packages/fleet/src/server/entry/pr-reader.ts` (new)
- `packages/fleet/build.mjs` (new entry)
- `packages/board/build.mjs` (new copy step), `packages/board/src/server/fleet.ts`
  (election, heartbeat, reader-state read, "who reads PRs")
- `.gitattributes`, `skills/plot/scripts/README.md`, the stale-text spots named
  above, `CLAUDE.md`'s *One writer* paragraph

It does not own: `packages/domain/src/ports/reader-lock.ts`,
`packages/domain/src/rules/reader-election.ts`,
`packages/domain/src/adapters/reader-lock/*` (Index lock slice, merged, #2718)
or `packages/fleet/src/shared/fleet-clock.ts`'s `fleetPrs`/`PrLock`
(fleetd lock slice, merged, #2723) — call into them, do not restructure them.

Both prior waves of this plan are merged and no sibling branch is in flight
for it. If this slice needs a change to `fleetPrs`'s signature or the
`ReaderLock` port, that is a sign the port is missing something the plan did
not anticipate — report it rather than widening scope silently.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
