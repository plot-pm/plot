## Implementation brief — planning-tab-reads-a-fleet-payload

- **Plan (canonical):** [docs/plans/2026-10-29-planning-tab-reads-a-fleet-payload.md](../../docs/plans/2026-10-29-planning-tab-reads-a-fleet-payload.md) on `main`
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2891 merged
- **Branch:** `bug/planning-tab-reads-a-fleet-payload` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review (plan `Review: pr`)

One slice, no waves. Nothing waits on this branch and it waits on nothing. At dispatch the only open PR is the release PR #2810, which touches no source.

### What to build

The Planning tab shows "Plans read from `<ref>` · Ns ago" and opens a sprint item's plan from `/api/fleet`, which the page polls only while the Delivery tab is open (`packages/board/src/app/App.tsx:542-546`, `:772`). On a fresh page `fleet` is `null` and the age is absent. After one Delivery visit `fleet` holds the last payload and nothing refreshes it. The fix moves the age into `/api/board` as one optional field and replaces the sprint fallback with a domain rule. Your fix is the right one only if the Planning tab shows the same age with Delivery never opened.

Build, in this order:

1. `FleetReadingSchema` (`packages/domain/src/entities/fleet.ts`) gains `fetch_failed: z.boolean().optional()`. The scan script already emits it, so no shell line changes.
2. `CacheEntry` (`packages/board/src/server/fleet.ts`) gains `fetchedAt: number | null`, `null` in `freshCacheEntry`. `refresh` sets it to the new `entry.at` when the scan's `fetch_failed` is not `true`, and leaves it unchanged when it is. `ensureCache` seeds it from the bridge's `at` on the same condition.
3. `packages/domain/src/rules/plan-ref-age.ts`: two arrow functions taking `nowMs` as a value. The server age (`fetchedAt`, `nowMs` → whole seconds, `null` for `null`, never negative) and the page age (server age, receive time, `nowMs` → server age plus elapsed page seconds; `null` or `undefined` in gives `null` out; never negative).
4. `buildFleet` computes `readRefAge` and `ageSeconds` from `fetchedAt` through the server-age rule. `readRefAge` is `null` while `fetchedAt` is `null`; `ageSeconds` stays a number for older pages and reads `readRefAge ?? 0`. The Delivery footer (`AgentList.tsx`) prints `readRefAge + tick` and omits the age when `readRefAge` is `null`. `/api/attention`'s `ageSeconds` reads `fleet.readRefAge`. `mock-fleet.ts` gains `readRefAge: 0`.
5. `BoardSchema` gains `planRefAgeSeconds: z.number().nullable().optional()`. The `/api/board` handler fills it in `packages/board/src/server/index.ts` beside `ticketLaneData`, from the `ensureCache` entry, through a small exported read in `fleet.ts`. Not in `buildBoard`.
6. `App.tsx:1524` and `:1537` pass `board.planRefAgeSeconds` and the page time the board payload arrived. `PlanSourceLine` owns a 1 s interval and calls the page-age rule. While `boardUnreachable` is true it stops the interval, keeps the last age and appends ` (frozen)`. The Delivery poll guard stays.
7. `packages/domain/src/rules/sprint-item-destination.ts`: takes a member's `slug` and `known` and the set of card slugs, returns the card slug to open or no destination. `SprintModal` renders a button only where a destination exists; any other member renders as text with its `?` badge. `planFileFromFleet` leaves the modal (`App.tsx:1592-1603`) and stays in `AgentList.tsx` for plan-level rows.
8. The three doc comments (`PlanSourceLine.tsx:53-58`, `Board.tsx:151-158`, `App.tsx:1592-1603`) state the board source.

Both rules are arrows (`export const f = (…) => …`), with factual TSDoc and no decision history. Line numbers above were measured at `c767fac2f`; find them by name if they moved.

### Decisions the plan settles — do not re-derive them

**The age dates the fleet scan's fetch of the ref, not the board's read.** `/api/board` re-reads the plan sources on every request (`board.ts:2192-2202`), so a board-read time or `generatedAt` would always read "0s ago" and say nothing about the ref. Only the fleet scan runs `git fetch` (`plot-fleet-scan.sh:382-395`). Do not take either alternative.

**Failed fetch: `fetchedAt`, not `entry.at`.** The scan keeps running when `git fetch` fails, and `refresh` sets `entry.at` on every finished scan. An age built from `entry.at` reports a fresh read of a ref that was not refreshed. `entry.at` keeps its meaning (scan time): the bridge comparison, `pulseShrink` and the scan countdown read it and must not change. Both readers strip `fetch_failed` today because the schema lacks it (`fleet-scan.ts:623`, `fleet-state-file.ts:73`); adding the key fixes both and needs no shell edit, so `check-shell-lines.sh` sees no growth.

**A cold server answers `null`, never `0`.** `buildFleet` returns `ageSeconds: 0` while no scan has finished (`fleet.ts:7506`). `planRefAgeSeconds` follows the `readRefAge` null rule (`fleet.ts:7658`), never `ageSeconds`' 0. An absent field (older server) decodes to `undefined` and shows "Plans read from `<ref>`" with no age.

**The page adds elapsed page time to the server's age and never subtracts a server timestamp from `Date.now()`.** That breaks on clock skew for a remote viewer. The Delivery footer's method (`AgentList.tsx:577-601`) is the model. The tick lives inside `PlanSourceLine`, not in `App`.

**One `fetchedAt` serves Planning, Delivery and attention.** Without it the Delivery footer would print an age the Planning line contradicts for the same fetch.

**`/api/board` gets one field and no second one.** The line does not say in words that a fetch failed; an age that keeps counting from the last good fetch is the signal.

**The scan owner can be fleetd.** With a fresh bridge the board spawns no scan and sets `entry.at` to the bridge's `at` (`fleet.ts:2775-2806`, `:2879`); `fetch_failed` travels in the same pulse. A board restart seeds from the bridge (`fleet.ts:3015`).

**The sprint fallback cannot help.** The board's cards already include plans from the ref, the working tree and branches (`board.ts:2250-2287`), and the server marks a sprint member with no card `known: false`. The panel measured every sprint file on `origin/main`: 16 members name no plan file on the ref or any branch, 0 name a branch-only plan. So `planFileFromFleet` finds nothing on a fresh page or after a Delivery visit. Do not keep it as a fallback.

Carried-over rules: absent is not false (a missing `fetch_failed` means the fetch succeeded); a `null` age prints no age, never `0s ago`; no shell line grows.

### Done when

The plan's `## Tests` list is the specification. The assertions that exist because a naive implementation would pass without them:

- `packages/board/test/integration/plan-source.browser.test.ts`: the `/api/fleet` stub answers `ageSeconds: 999` and `999s ago` never shows, on a fresh page and after a Delivery visit and return to Planning. This fails before the fix and catches an implementation that still reads `fleet`.
- Board unit: a scan whose reading carries `fetch_failed: true` leaves `readRefAge` dating the previous good fetch, and a bridge seed with `fetch_failed: true` gives `null`. This catches an age built from `entry.at`.
- Board unit: a reading or bridge with no `fetch_failed` dates its own `at`, and a board payload with no `planRefAgeSeconds` parses. This catches the older-server and older-script cases.
- Browser: a `/api/fleet` stub with `readRefAge: 40, ageSeconds: 0` shows exactly `scanned 40s ago`, and `readRefAge: null` shows no scanned age. This catches a footer that prints `0s ago` for a failed fetch.
- Browser: with `/api/board` failing, the age stops and the line reads ` (frozen)`. This catches a clock that keeps counting while the server is dead.
- Browser (sprint): a `known: false` member whose slug the `/api/fleet` stub names in `draftPlans` renders as text with its `?` badge and no button, from the Planning tab and from the Discovery tab, fresh and after a Delivery visit. The stub that names the slug makes the test fail before the fix.
- Domain unit: `plan-ref-age.test.ts` and `sprint-item-destination.test.ts` as the plan lists them, including the never-negative cases and the empty-slug case.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e`. No built bundle in the diff (`check-no-bundle-diff.sh`). A changeset for `@plot-pm/board` with the description first and the `bumps:` block last.

Shell gate: `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, remove shell elsewhere in the same change or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section when the PR exists. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/entities/fleet.ts`, two new files under `packages/domain/src/rules/` with their tests, `packages/board/src/server/{fleet,index,attention,mock-fleet}.ts`, `packages/board/src/contract/schema.ts`, and in `packages/board/src/app/`: `App.tsx`, `components/{PlanSourceLine,Board,SprintModal,AgentList}.tsx`. Tests go under `packages/domain/test/` and `packages/board/test/`.

No other slice is in flight on these files at dispatch (verified from open PRs: only release PR #2810). Do not edit `plot-fleet-scan.sh`, and do not touch `planFileFromFleet`'s use for plan-level rows in `AgentList.tsx`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
