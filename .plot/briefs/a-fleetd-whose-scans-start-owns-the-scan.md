## Implementation brief — the-fleet-scan-re-reads-what (wave 2: Scan ownership)

- **Plan (canonical):** docs/plans/2026-10-31-the-fleet-scan-re-reads-what.md on main
- **Approved:** 2026-10-31, Jan Wloka, plan-PR #2979 merged
- **Branch:** `feature/a-fleetd-whose-scans-start-owns-the-scan` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review through the `plot/review` channel, per repo convention

Wave 1 (`feature/the-scan-walk-starts-no-process-per-plan`, PR #2982) is merged, so this branch is eligible. Wave 3 (`feature/the-subject-walk-skips-settled-plans`) is independent of this branch's output.

### What to build

A fleetd whose own scans keep starting — one after another, each within budget of the last — currently still loses ownership of the scan to the board the moment the bridge turns 180 s old (`OWNED_BRIDGE_MAX_AGE_MS`, `packages/domain/src/rules/scan-owner.ts:12`). `fleetOwnsScan` (`scan-owner.ts:37`) requires the bridge itself to be fresh; it has no way to see that fleetd is mid-scan and about to write a fresh one. On 2026-10-31 two scans in a row ran past `FLEET_SCAN_BUDGET_MS` (90 s) each, the bridge aged past 180 s, and the board started `plot-fleet-scan.sh --stream` of its own (`packages/board/src/server/fleet.ts:2815-2823`) — at which point fleetd's own scan and the board's scan ran and fetched in the same repository at the same time, each slowing the other down. The fix is not a longer `OWNED_BRIDGE_MAX_AGE_MS` — that would let a genuinely hung fleet squat on ownership for longer. It is giving `fleetOwnsScan` a second, independent fact: is fleetd still trying.

Record each scan attempt — when it started, when it ended, and whether it succeeded or timed out — and keep fleetd as owner whenever its last attempt *started* within `2 × FLEET_SCAN_BUDGET_MS` (180 s), even while the bridge itself is older than that. A fleetd that starts no new attempt for that same 180 s window gives up ownership exactly as today. The board, while fleetd still owns, shows the bridge's age and fleetd's last scan failure instead of starting a second scan — so a slow-but-alive fleetd is never shadowed by a competing board scan, and a genuinely stopped one still hands over within the same bound as before.

### Decisions the plan settles — do not re-derive them

- **Two independent facts, not one looser threshold.** The plan explicitly separates "is the bridge fresh" from "did fleetd just try." Widening `OWNED_BRIDGE_MAX_AGE_MS` conflates them again and defeats the reason `fleetOwnsScan` hands over at all: a daemon that has actually hung must still be caught within a bounded window. Add the scan-attempt reading beside the bridge reading; do not touch `OWNED_BRIDGE_MAX_AGE_MS`.
- **Attempt start, not attempt end, is what keeps ownership.** A scan that is still running has no end time yet, and the whole point is to cover fleetd *while a slow scan is in flight*. Gate on "last attempt started within `2 × FLEET_SCAN_BUDGET_MS`", not on the last completed scan's timestamp — the latter is exactly `bridgeAt` restated and buys nothing new.
- **No disk cache.** The plan's Decisions section is explicit: slices 1–3 add no file under `.plot/state`; this slice "adds scan-attempt fields to what fleetd already records." The natural site is the existing bridge path fleetd already owns end-to-end — `fleetScan` in `packages/fleet/src/shared/fleet-clock.ts:137-155` is the one place that knows both when an attempt starts and how it ends (`writeScan` on success, the `catch` on failure/timeout at `:151-153`), and `FleetState`/`BridgedPulse` (`packages/domain/src/ports/fleet-state.ts`) is the one porthole fleetd already writes through. The plan does not pin down whether the attempt record is a new `BridgedPulse` field (written on every attempt, not only on success) or a separate small write; `write` today is documented "ONLY EVER CALLED AFTER A SCAN SUCCEEDS" (`fleet-state.ts:49`), so a start-of-attempt write is new behaviour for that port and worth a deliberate decision, not an assumption. Record the choice and why in the PR.
- **The board must keep reading, never writing.** `fleet-state.ts`'s port doc is explicit: "ONE WRITER... The board reads and does not write while a fleet is running." Whatever shape the scan-attempt record takes, the board only ever reads it to decide ownership and to render the failure line; it must not gain a second writer of fleetd's own state.
- **Merge and delivery are out of reach.** `plot-ask.mjs merge` and `plot-pr-merged.sh` ask the host again on every decision; nothing this slice changes can affect a merge or a delivery decision. Do not route scan-ownership state into either.
- **The shell line ratchet is wave 3's room, not this one's.** Wave 1 removed shell lines; wave 3 must fit inside that room (`scripts/check-shell-lines.sh pr`). This wave is almost entirely TypeScript (`packages/domain`, `packages/fleet`, `packages/board`) and should not need the budget wave 3 depends on — if a shell change here turns out unavoidable, say so in the PR rather than spending wave 3's margin silently.

### Done when

The plan's `## Done when` Slice 2 list is the specification:

- `pnpm --filter @plot-pm/domain exec vitest run test/scan-owner.test.ts` passes, with cases for:
  - a live fleetd whose last scan started 100 s ago and whose bridge is 200 s old → fleetd owns;
  - a live fleetd that started no scan for more than `2 × FLEET_SCAN_BUDGET_MS` → the board owns;
  - a stopped fleetd → the board owns, as today.
- A board unit test shows the bridge's age and fleetd's last failure when fleetd owns a stale bridge.

Plus: a changeset for package `plot` (description first, `bumps:` block last — see CLAUDE.md *Versioning*, the order is not cosmetic). Run `node ../plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally — it is CI's gate, not a local one.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base, counting commands rather than lines (joining with `;`/`&&` or folding `fi`/`done` onto the previous line is not a payment). This wave should touch no `.sh` file; if it must, that cost is paid in the same change.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/scan-owner.ts`, `packages/fleet/src/shared/fleet-clock.ts` and the ownership-reading parts of `packages/board/src/server/fleet.ts` (the `fleetOwnsScan` call sites at `:2354` and `:2815-2823`, and the render of the bridge's age / last failure). It does not own `packages/domain/src/ports/fleet-state.ts`'s existing fields or `writeScan` in `packages/fleet/src/shared/fleet-scan.ts:801-817` beyond what adding the scan-attempt record requires — extend deliberately, do not restructure. Wave 1 (merged) owns `skills/plot/scripts/plot-fleet-scan.sh`'s per-plan loops. Wave 3 owns the merge-subject filter in that same script, after this slice. If you find something the plan did not anticipate, report it rather than improvising outside scope.
