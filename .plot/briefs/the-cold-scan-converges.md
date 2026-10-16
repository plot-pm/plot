## Implementation brief — fleetd-scan-cost-and-read-cadence (slice: #1756)

- **Plan (canonical):** `docs/plans/2026-10-16-fleetd-scan-cost-and-read-cadence.md` on `main`
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1862 merged
- **Branch:** `bug/the-cold-scan-converges` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

Independent of the plan's other four slices (`bug/the-tick-asks-nothing-for-an-ended-desk`,
`bug/the-settled-walk-survives-a-burst`, `bug/the-design-commit-key-matches-a-real-plan`,
`bug/the-issue-index-writes-at-on-an-answer`) — nothing here blocks or waits on them.

### What to build

Fix #1756: on a Bitbucket repository with 26 branches and ~3,500 PRs,
`plot-fleet-scan.sh --stream` takes 106-280 s against a 90 s budget
(`FLEET_SCAN_BUDGET_MS`, `packages/fleet/src/shared/fleet-scan.ts:23`). The
board kills it with SIGKILL and `scanOnce` throws — discarding the `terminal:`
and `listing:` lines the scan already streamed to stderr before it died.
Next scan starts cold on both caches and times out again. The failure is not
"the scan is too slow" — it is "a slow scan's partial work is thrown away",
which is fixable without making the scan itself faster.

**The exact defect, traced to the line:** in `scanOnce`
(`packages/fleet/src/shared/fleet-scan.ts:332-405`), stderr lines prefixed
`terminal:`/`listing:` accumulate into local variables `learned`/`listed`
(lines 383-385). `state.terminal = learned` and the `state.listing` write
only happen at lines 390-395, **after** the `if (parsed === null) throw` guard
at line 388. A SIGKILL from the 90 s timeout in `runStreaming`
(`packages/board/src/server/fleet.ts:968-974`, same shape in the fleet's own
stream helper) means the terminal `reading` line never arrived, `parsed`
stays null, the function throws before line 390 runs, and `learned`/`listed`
— which hold real, host-charged answers — are dropped with the stack frame.

Both callers hold `state`/`entry` across scans for exactly this reason
(`ScanState` in `fleet-scan.ts:33-44`; `CacheEntry.terminal`/`.listing` in
`packages/board/src/server/fleet.ts:343-364`), and both currently start every
post-timeout scan from `state.terminal = ''` / `state.listing = ''` — the
cold-start value — because a failed `scanOnce` call never touches either
field. Confirmed by reading every reference to `entry.terminal` /
`entry.listing` in `fleet.ts`: written once at construction
(`freshCacheEntry`), read never, which is the empty-cache symptom made
literal.

### The decision this plan leaves open — do not improvise past it

**Open Question #1756** (plan, Design › Open Questions) is still open: *keep
the streamed lines on timeout* vs. *a longer first-scan budget* vs. *a
parallel per-branch sweep within the host's rate budget*. The plan already
rules out the third as this slice's scope — it "needs the connector
rate-limit contract, so it is the largest" — and names the Changelog's
success condition as *"the fleet scan completes on a repository whose cold
first scan exceeds 90 s"*, which a longer budget alone cannot guarantee (a
repo can always be made to exceed any fixed budget) but keeping partial
answers can converge toward, because the SECOND scan then starts warm and is
cheaper than the first. **Pick between the remaining two — or combine
them — and record the choice in the plan's Open Questions before writing
code**, the way `/plot-approve` expects a settled design. Keeping streamed
lines on timeout is the one that directly matches the Changelog line and
reuses machinery (`PLOT_TERMINAL_CACHE`, `PLOT_PR_LISTING`, `onErrorLine`)
that already exists on both sides of the pipe — the gap is purely that
`scanOnce` discards what it already has, not that the plumbing is missing.

### What must not regress

- **`parsed === null` must still throw.** The caller's "no complete pulse"
  contract (`scanOnce`'s own doc comment: "Adopts the caches the scan reports
  back only after its terminal line arrived") is right for `state.pulse` /
  the board's `entry.pulse` — a partial plan list must never overwrite a good
  one (see `fleet.ts:2335-2350`'s shrink-detection comment for why). The fix
  is scoped to `state.terminal`/`state.listing` — which, because the board
  passes `entry` by reference, is the same memory as `entry.terminal`/
  `entry.listing` — **not** to accepting a partial `FleetReading` as the pulse.
- **`listingBranches` and `listingAt` follow the same partial-acceptance
  rule as a successful listing does** (lines 391-394) — a partial `listed`
  string should update them the same way a complete one does, since a
  partial per-branch sweep is still real, host-charged data about however
  many branches it covered before the kill.
- **The board's path (`fleet.ts`) and the fleetd path (`fleet-clock.ts`)
  share `scanOnce`, and the fix belongs entirely inside it** —
  `packages/fleet/src/shared/fleet-scan.ts:332-405`. No wiring gap to close
  on the caller side: `fleet.ts:2303-2305` already passes `entry` itself as
  `scanOnce`'s `state` argument (confirmed by reading the call site —
  `CacheEntry` structurally satisfies `ScanState`, same six fields), and
  `scanOnce` mutates that object by reference. `entry.terminal`/
  `entry.listing` read as never-written today only because `scanOnce`
  itself never reaches its own carry-forward lines (390-395) on the throw
  path — fixing that inside `scanOnce` fixes both callers for free. Do not
  duplicate the carry-forward logic in `fleet.ts`'s `catch` block
  (lines 2406-2429) or in `fleet-clock.ts`.

### Done when

The plan's `## Done when` is not written out as a separate section in this
plan — use the Changelog line as the acceptance test: **the fleet scan
completes on a repository whose cold first scan exceeds 90 s**, and **the
tick spends host calls only on desks that can release** (the second clause
belongs to slice 2, `#1374` — ignore it here, it is not this branch's claim).

Concretely for this slice:

- A scan killed by `FLEET_SCAN_BUDGET_MS` leaves `state.terminal` and/or
  `state.listing` non-empty when the killed process streamed at least one
  such line before the SIGKILL — test this by simulating a mid-stream kill
  (an `onErrorLine` callback that fires some `terminal:`/`listing:` lines,
  then `runStreaming`'s timeout path rejects).
- A second scan immediately following a killed one starts with a non-empty
  `PLOT_TERMINAL_CACHE`/`PLOT_PR_LISTING` seed where the first scan streamed
  any such lines — i.e., it is measurably warmer, not cold.
- `parsed === null` still throws, and the thrown scan still leaves
  `state.pulse`/`entry.pulse` untouched (existing behaviour, assert it stays).
- No change to the shell script's own output format — `terminal:`/`listing:`
  lines are already emitted today; this slice only changes whether the
  TypeScript caller keeps them after a throw.

Plus the repo's gates: run `node skills/plot/scripts/board/plot-local-checks.mjs`
before each push and run what it prints — it resolves the related Vitest
suite and `tsc --noEmit` for `packages/fleet` from the files you touched. The
suites named under `## Plot Config` → `CI suites` run in CI on every PR; do
not run them locally, and do not list them as a thing this branch itself
must run.

**Shell gate:** `scripts/check-shell-lines.sh` refuses a PR whose shell under
`skills/` grew past its merge base. This slice is TypeScript-only
(`packages/fleet/src/shared/fleet-scan.ts`) — the shell script's
`terminal:`/`listing:` emission is unchanged, so this gate should pass
without any shell-line budget to spend. If the fix turns out to need a
shell-side change, say so in the PR rather than assuming it's free.

### Bookkeeping

Open the PR through the controller once the branch exists and carries a commit:

```
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create`. When the PR is created, append `→ #<number>` to
this branch's line in the plan's `## Slices` section
(`docs/plans/2026-10-16-fleetd-scan-cost-and-read-cadence.md`).

Push the first real commit as soon as it exists — a branch that sits locally
with no PR is invisible to the fleet and to `/plot-pulse`.

### Scope guard

**This branch owns:** `packages/fleet/src/shared/fleet-scan.ts` (the fix
itself) and its test file. `packages/board/src/server/fleet.ts` should need
no change — its call site already passes `entry` by reference — but if the
fix needs a test fixture that exercises the board's cache specifically,
that test can live alongside `fleet.ts`'s existing tests without touching
`fleet.ts`'s source.

**Does not own:** `registryd.ts`/`registryd-main.ts` (slice 2, #1374),
`default-branch.ts` (slice 3, #1582), `design-work.ts`/`auto-design.ts`/
`design.ts` (slice 4, #1685/#1673), `issue-refresh.ts`/`IssueIndexSchema`
(slice 5, #1652). No other branch is pushed yet (checked at brief-writing
time, 2026-10-16) — the five slices are claimed independently via
`plot-fleet-scan.sh --next`, so verify with `git ls-remote --heads origin`
before assuming this list is still current when you pick the branch up.

If the fix turns out to require touching the shell script's streaming
protocol itself (not just the TypeScript side that consumes it), report
that rather than improvising — it would cross into the shell-line budget
this slice was scoped to avoid spending.
