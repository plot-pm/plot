## Implementation brief — supervisor-tick-s-fleet-scan-reads (wave 2: Limit-aware stretch)

- **Plan (canonical):** docs/plans/2026-10-28-supervisor-tick-s-fleet-scan-reads.md on main
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2817 merged
- **Branch:** `bug/the-scan-listing-honours-the-limit` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

Wave 1 (`bug/a-refused-scan-listing-backs-off`, → #2847) is merged on `main` as of this brief. It added `listingBackoff`, a `backoffUntil`/`backoffMs` pair on `ScanState`, and the local `SpendRate` interface in `fleet-scan.ts` that already carries `limit`, `basis` (`LimitBasis`), `resetAt` and `account` — wired through `spendRateFor`. This wave does not touch the back-off; it only changes what the stretch does with the rate that back-off already reads. Waves 3 and 4 (the tick line, the Bitbucket delta) have not started and do not depend on this one.

### What to build

Today the listing's stretch (`cadenceStretch`, `packages/domain/src/rules/cadence.ts`) divides the account's observed `perHour` by a fixed ceiling of 8×, with no notion of the account's actual limit — an account at 3,664 requests/hr against a 1,000/hr limit still only stretches 8× (measured: 90–135 requests/hr instead of the 60/hr idle share). Separately, `listingSpend`'s unstretched share comes from `REFRESH_MS` (5 s), the fleet's scan-poll cadence, not a listing cadence — so an idle fleetd's *unstretched* listing already spends 720 requests/hr (`boardSharePerHour(5_000, cost)`), 12× the board's 60/hr share, before any stretch runs at all.

This wave does two things, both in the domain:

1. **`listingSpend` and `cadenceStretch` take the account's limit.** `ListingSpendInput.rate` is currently typed `Pick<SpendRate, 'perHour'> | null` (domain's `budget-record.ts` `SpendRate`) — too narrow to carry `limit`/`basis`. `spendRateFor` in `fleet-scan.ts` already returns an object with `limit: number | null` and `basis: LimitBasis` (`'actual' | 'predicted' | 'unknown'`, from `packages/domain/src/entities/limit.ts`) on top of `perHour`. Widen what `listingSpend`/`cadenceStretch` accept to also read `limit` and `basis`, and change the stretch rule itself: once the observed rate is at or above a limit of basis `actual` or `predicted`, stop stretching by the damped 8× ceiling and instead wait past the reported reset (`resetAt`) or a bounded maximum if `resetAt` is absent/implausible. A `basis: 'unknown'` limit must change nothing — it follows the rule an absent rate already takes (`cadence.ts:181-189`, the `perHour === null` branch: "an absent rate holds the cadence where it is"). This is the same shape, one level up: `unknown` is not "unlimited," it is "nothing to divide by."
2. **The listing's unstretched base moves from 5 s to 60 s.** In `scanOnce` (`fleet-scan.ts:533`), the call to `listingSpend` passes `intervalMs: REFRESH_MS` (5 000). Change this to a 60 000 ms listing base — a new named constant beside `REFRESH_MS`, not a reuse of `PR_REFRESH_MS` (that constant belongs to a different reader, the PR pass, and coupling them would make an unrelated change to one silently retune the other). This alone drops the unstretched share from 720/hr to 60/hr, matching the board's own base and the plan's "Done when" figure for this slice.

### The decisions the plan settles — do not re-derive them

**Why a limit comparison and not a lower ceiling.** The panel considered simply lowering `MAX_CADENCE_STRETCH` for an over-limit account, but that number is a documented population bound ("eight boards' worth of sustained spend is past every population measured here") unrelated to any one account's actual ceiling — conflating the two would make a future change to one silently retune the other. The plan decided to keep `MAX_CADENCE_STRETCH` as-is and add a *second*, limit-driven path that only engages once `perHour` has actually reached the limit.

**Why `basis` gates the new behaviour and `limit` alone does not.** A `predicted` limit is a guess until a refusal proves it (`limit.ts`'s own docstring: "wrong until something proves it"); treating a predicted limit identically to an actual one is already the design's call (both gate the new wait), but `unknown` must not — it carries no number at all (`limit: null` always accompanies `basis: 'unknown'`), and reading a null limit as "no limit, stretch freely" vs. "limit is zero, wait forever" are both wrong in different directions. The existing `perHour === null` precedent in `cadenceStretch` is the model: no evidence, don't move.

**Why the 5 s → 60 s change is a separate constant, not a reused one.** `REFRESH_MS` (5 s) is the fleet's scan-poll cadence — how often `scanOnce` runs at all, independent of whether a listing is due. `PR_REFRESH_MS` (60 s) is a different reader's (the PR pass's) cadence. The listing's own base belongs to neither; it needs its own name so a future change to the scan-poll interval or the PR pass's interval does not retune the listing's share as a side effect.

**Reused rule, not a new one.** `refreshIntervalMs` in `cadence.ts` is the single public entry a caller like `prRefreshMsFor` calls — do not add a second copy of the stretch-and-round arithmetic for the limit-aware path. The limit check is a new branch inside `cadenceStretch`/`targetStretch` (or a function they call), not a parallel rule.

### Done when

The plan's `## Done when` list is the specification for this slice:

> **Slice 2:** listings succeed on a quiet account. Today the listing spends 720 requests. After the slice it spends at most 60. With an account rate above a `predicted` limit of 1,000, the listing spends 0 requests before the reported reset.

Lift these into domain unit tests (`packages/domain/test/listing-spend.test.ts`, `packages/domain/test/cadence.test.ts`) because a naive implementation passes without them:

- An idle account (`perHour: 0` or `null`) with the new 60 s base spends at most 60 requests/hr through `listingSpend` — this catches a fix that only changes the stretch ceiling but forgets to also pass the 60 s base from `scanOnce`, which would still leave the unstretched share at 720/hr.
- An account whose `perHour` is **below** its `actual`/`predicted` limit stretches exactly as today (the existing 8×-damped path) — this catches an implementation that engages the wait-for-reset branch too early, before the account has actually reached its ceiling.
- An account whose `perHour` is **at or above** an `actual` or `predicted` limit of 1,000 spends 0 requests until `resetAt` (or the bounded maximum, if `resetAt` is null/implausible) — this is the plan's explicit "spends 0 requests before the reported reset" assertion, and it is the one a stretch-ceiling-only fix cannot satisfy no matter how high the ceiling goes, because 8× a non-zero rate is never 0.
- An account with `basis: 'unknown'` and any `perHour` behaves exactly as `rate: null` does today — this catches a fix that reads a null `limit` as "no ceiling" and stretches further than 8×, or as "ceiling of zero" and refuses to spend at all.

Plus: the repo's gates — build artifacts (no committed `board-server.mjs` diff), a changeset naming the `plot` package (this plan's changeset, if not already present on `main` from wave 1), and platform constraints (Node 24 via `nvm use`). This slice touches only `packages/domain/**`, so `scripts/check-shell-lines.sh` is not triggered unless a `.sh` file is also touched — it should not be. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run a full suite locally.

### Bookkeeping

Open the PR through the controller once the branch carries real commits:

```bash
skills/plot/scripts/plot-open-pr.sh          # the current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

Do not run `gh pr create`. Push the first real commit as soon as it exists, and append `→ #<number>` to this branch's line in the plan's `## Slices` section (under `### Limit-aware stretch`) the moment the PR is opened.

### Scope guard

This branch owns:

- `packages/domain/src/rules/listing-spend.ts` and its test
- `packages/domain/src/rules/cadence.ts` and its test (the `targetStretch`/`cadenceStretch` limit branch)
- `packages/fleet/src/shared/fleet-scan.ts` — only the `listingSpend` call site in `scanOnce` (the `intervalMs` argument, and whatever widened `rate` shape it now passes through from `spendRateFor`'s existing `SpendRate`)

No other wave of this plan has an open branch right now: wave 1 (`bug/a-refused-scan-listing-backs-off`) is merged and its ref is gone; waves 3 (`bug/the-tick-line-counts-each-loop`) and 4 (`bug/a-bitbucket-scan-reads-a-delta`) have no branch yet. There is therefore no live sibling to collide with — the only overlap risk is with a future wave 3/4 branch also touching `fleet-scan.ts`'s `scanOnce`, which this brief cannot verify in advance; re-check `git ls-remote --heads origin` for those branch names before assuming the file is still uncontested.

If you find something the plan did not anticipate, report it rather than improvising outside scope — in particular, do not widen `budget-record.ts`'s domain-level `SpendRate` type itself (the one `spendRate()` returns) unless the plan's decision log is amended first; the plan scopes this to `fleet-scan.ts`'s own local `SpendRate` and `listingSpend`'s input type, not the budget record's.
