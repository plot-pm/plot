## Implementation brief — a-daemon-spends-within-its-means

- **Plan (canonical):** `docs/plans/2026-09-29-a-daemon-spends-within-its-means.md` on `main`
- **Approved:** 2026-09-29, jwloka, in-session
- **Branch:** `bug/a-daemon-spends-within-its-means` (base: `main`, claimed at `753ee3eb`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review + CI)
- **Issue:** #1065

Single-slice plan: nothing waits on this branch and it waits on nothing. #1059 (a duplicate host call in the tick) and #1069 (two stretching consumers pin at the ceiling) are separate defects and stay out of this branch.

### What to build

A Bitbucket estate reported `HTTP 429` twice in two hours, about 20 minutes each, with every slice held `merge-unknown`. The incident was diagnosed three times before anybody measured it, because the supervisor's tick line says nothing about what the account spends. Measured live: 2825 req/hr on the account, 88% Bitbucket; the supervisor's measured ceiling is 120 req/hr (2 host calls a tick at 60 s), about 8%.

Make the tick REPORT the account's observed rate, the supervisor's own share, and the board's current stretch. Add no backoff. The line that would have settled the incident in one read is of the shape `account 2825/hr, mine 120/hr, board stretched 8.5×`.

The place is `tickLine` in `packages/board/src/server/entry/registryd.ts:292`, printed by `reportTick` in `registryd-main.ts:1041`. The reading already exists: `plot-host.sh spend-rate` (`:4735`) reads the budget record every spender appends to and asks no host. The board reads it in `spendRateFor` (`packages/board/src/server/fleet.ts:1869`), which returns `null` on every failure. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**No backoff, no stretch.** The obvious fix is to feed the supervisor through `cadenceStretch` the way the board is fed. Round 1 measured it and killed it: `others` (310/hr) exceeds `share` (60/hr) continuously on this account, so `targetStretch` (`packages/domain/src/rules/cadence.ts:139`) returns `MAX_CADENCE_STRETCH = 8` outright and stays there. `queue.ts:116-124` makes a hold safe only because the next tick is 60 s away; at 8× it is eight minutes away. A stretched supervisor turns two 20-minute outages into a permanent 8-minute hand-over cadence, and removes about 5% of a load it did not create. Done when asserts the interval is unchanged.

**The supervisor is already in the record.** `plot-host.sh:2621`: every host call appends one line, refusals included, and the supervisor reaches the host through `host-shell.ts` → `plot-host.sh`. Add no instrumentation. The gap is that the tick READS nothing.

**Rename nothing in `cadence.ts`.** `boardSharePerHour` and `othersPerHour` are arithmetic over an interval and a cost and name no consumer. The plan answered the naming question; a rename is a diff with no behaviour change.

**Reach the spend record through the adapter, not a new `spawn`.** The Layering Rule: a controller never spawns, and the CI ratchet *One place reaches a process* counts direct `spawn`/`execFile` sites outside `adapters/`. `spendRateFor` asks `scriptsFor(opts).hostSaid(['spend-rate'])`; the supervisor's world is built in `worldForRepo` (`registryd-main.ts:262`) from `scriptsShell`. Take the reading through that seam.

**No cross-tick state.** The record is on disk and is read per tick. `DESIGN-agent.md`'s *holds nothing between ticks* is measured (a `kill -9` mid-tick reaches the identical decision), and a stored rate would break it.

**Carried-over invariants.** Absent is not zero: a `null` `perHour` (no span to divide by), an unreadable record and a missing script are *no evidence* and must not print `account=0/hr`. An unrecognised `basis` is `unknown`, never a guess (`fleet.ts:1897`).

### Open point the plan leaves to the slice

**"The board's current stretch" has no free source in the supervisor.** The board holds its stretch in memory and publishes it as `prAgeSeconds` / `prNextInSeconds` on `/api/fleet` (`schema.ts:3998-4010`). A supervisor that calls a running board over HTTP gains a dependency on an optional process, which `plot-ask.mjs` exists to avoid. Two honest routes: derive the stretch the board WOULD compute from the same spend reading with `targetStretch` and label it as derived, or omit the field where no board answers. Pick one, say which in the PR, and never print a stretch nobody measured. The plan also asks the slice to state whether it verified on a Bitbucket supervisor or read the absence of backoff from source on a GitHub checkout.

### Done when

The plan's `## Done when` list is the specification. The assertions that a naive implementation passes without:

- **Saturated is not unreachable.** `merge-unknown=N` means the host would not answer; `account=2825/hr` is a different fact. A test with both a saturated stub record and an unreachable host must show both, each under its own name.
- **The counters keep their shape.** Existing `tickLine` fields keep their names and order; new fields append after them, so a tick stays comparable with an earlier one in `.plot/logs/registryd.log`. Verified at dispatch: no script parses the tick line today (`plot-fleetctl.sh` reads only the log's mtime), so a test must hold the shape. The queue fields are omitted when no queue was read (`registryd.ts:312`); give the spend fields the same rule: omitted or marked unread when there is no reading, never zero.
- **The interval is unchanged**, asserted as a value, so a later slice cannot add backoff without failing a test that names this plan.
- **An incomplete tick keeps its own line** (`tickLine` early return). The spend reading must not make an incomplete tick look complete, or the reverse.

Plus the repo gates: `nvm use` (Node 24), `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` (rebuilds `board-server.mjs` and `plot-registryd.mjs`; commit the rebuilt artifacts), `pnpm run typecheck`. Not `test:e2e`. The relevant unit tests are `packages/board/test/unit/registryd-tick.test.ts` and `registryd-main.test.ts`. Add a changeset: `'@plot-pm/board': patch`, description first.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`.
- Once the PR exists, append `(Branch: bug/a-daemon-spends-within-its-means, PR: #N)` inside the slice heading in the plan's `## Slices` section on `main` (this plan annotates inside the heading, not with a trailing `→ #N`).

### Scope guard

This branch owns `packages/board/src/server/entry/registryd.ts`, `registryd-main.ts`, their unit tests, the rebuilt `skills/plot/scripts/board/plot-registryd.mjs`, and a changeset. It may read `packages/domain/src/rules/cadence.ts` and must not change its behaviour. It does not touch `fleet.ts`'s cadence, `plot-host.sh`, or the tick interval.

Branches in flight at dispatch, verified by `git diff origin/main...`:

- `bug/a-tick-asks-the-host-once` (#1059, `docs/plans/2026-09-29-a-tick-asks-the-host-once.md`) is claimed and holds no commits yet. It removes a duplicate host call from the same tick, so it is the likeliest collision in `registryd-main.ts`. Whichever merges second rebases; neither branch takes the other's change.
- `bug/a-unit-name-follows-the-label` owns `skills/plot/scripts/plot-fleetctl.sh` and `skills/plot/units/`. No file overlap.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
