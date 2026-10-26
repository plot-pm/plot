## Implementation brief — board-status-banner-offline-tickets-and (wave: Board client)

- **Plan (canonical):** [docs/plans/2026-10-24-board-status-banner-offline-tickets-and.md](../../docs/plans/2026-10-24-board-status-banner-offline-tickets-and.md) on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2498 merged
- **Branch:** `bug/board-client-fetch-bound-and-click` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** plot-review on the PR (per repo convention)

This is the plan's fifth and last slice. It touches `packages/board/src/app/App.tsx` and
`packages/board/test/integration/plan-link-click.browser.test.ts` only — disjoint from the
other four slices' files, so it waits on nothing and nothing waits on it.

### What to build

Two MEDIUM findings from issue #2477 (#2088, #2113), checked against `origin/main` at
`84b1638e4`:

1. **The board's own fetch bound outlives the poll that can overtake it.**
   `BOARD_POLL_TIMEOUT_MS = 12_000` at `App.tsx:155` is sized against the board's 30 s
   steady-state cadence. But the board also polls every 4 s while a start is pending
   (`STARTING_POLL_MS = FLEET_POLL_MS` at `App.tsx:90`) and refetches on every channel
   event (`listenForEvents` at `App.tsx:476`). Under either of those, a request still
   outstanding at 12 s can be overtaken by its own successor, and two in flight for
   `/api/board` can land out of order and show older data than the screen already has —
   exactly the hazard `POLL_TIMEOUT_MS`'s own comment (`App.tsx:103-108`) names and sizes
   the FLEET bound against. The board bound needs the same treatment: fit the shortest
   cadence the board fetch can actually run at, not just its slowest one.

2. **A remembered plan click that cannot resolve waits in silence for 30 s.**
   `onOpenPlanFile` (`App.tsx:858`) remembers a click as `pendingPlan` when the board
   has not loaded (`planLinkClick` returns `'wait'`). The deferred effect at `App.tsx:895`
   gives that click a hard deadline, `PENDING_PLAN_TIMEOUT_MS = 30_000`, before falling
   back to `/plan/<file>` navigation on its own. But when `boardFailures` has already
   crossed its threshold and the banner is telling the reader the board is unreachable,
   the click still waits out the full 30 s with no visible sign that it noticed — the
   apparatus that already knows the server is gone (`fleetUnreachable`,`boardFailures`)
   is not consulted by the pending-click path at all.

### The decisions the plan settles — do not re-derive them

**Why `BOARD_POLL_TIMEOUT_MS` cannot just become `3_500` (the fleet's bound).**
`/api/board` walks every plan in the estate and spawns `plot-plan-meta.sh` once per
build; measured 2026-10-19 under ambient load (issue #2083), the same batched spawn that
finishes in ~360 ms in isolation took 2.9–4.4 s inside the running server. `/api/fleet`,
by contrast, reads a cache the server refreshes on its own timer and never runs a scan
inline — measured at 0.76 s under the same load. The two endpoints do not cost the same,
so they cannot safely share one bound: a 3.5 s bound on `/api/board` would count a normal
loaded-machine answer as a failure. The fix is to separate "how long before this request
is abandoned" from "how often can a new one start" — the board needs its own generous
timeout for the slow case, and a SEPARATE mechanism (already partly present — `fetch-state`
tracking whether a request is in flight, or an `AbortController` that cancels a
superseded request rather than merely racing it) to stop two `/api/board` requests from
being live at once when the 4 s starting-poll or a channel event fires before the first
one finishes. Re-widening the single timeout does not fix the overlap; only not starting
a second request while the first is outstanding does.

**Why the pending-click deadline cannot simply read `fleetUnreachable` and resolve early.**
`fleetUnreachable`/`boardFailures` are counted on the FLEET's 4 s cadence (`App.tsx:333`
comment), not the board's — a board that has failed enough to raise the banner is a
different count from a board poll that has merely not answered yet once. The two counters
exist because the two endpoints poll at different rates, named explicitly in the comment
at `App.tsx:335-337` ("TWO counters rather than one"). The fix for finding #2 is to make
the pending-click path READ the board's own unreachable signal (not the fleet's) and
resolve to the `/plan/<file>` fallback immediately once that signal is already true when
the click lands, or as soon as it becomes true while waiting — rather than inventing a
third counter or borrowing the fleet's.

**The `card as Card` casts at `App.tsx:863`, `App.tsx:885` and `App.tsx:1493` are a
LOW finding in the same area (#2113) and are in scope for this slice.** `planLinkClick`
(`packages/domain/src/rules/plan-link-click.ts`) takes two booleans
(`boardLoaded`, `cardFound`) and returns an enum — it never sees the `Card` itself, so
nothing on the caller's side lets TypeScript narrow `card` from `Card | null` to `Card`
when the decision is `'open'`, forcing the cast at all three call sites. Fix by having
the caller branch directly on `card` (e.g. `if (card) { ... }` before or instead of
calling `planLinkClick` for the narrowing, keeping `planLinkClick` as the single source
of truth for the `wait`/`navigate` choice) — do not change `planLinkClick`'s signature
casually; it is a tested pure rule in the domain package and two of its three callers
pass `true` for `boardLoaded` unconditionally (`App.tsx:884`, `App.tsx:1491`), so a
signature change ripples.

**The sprint-member-with-no-card LOW (`App.tsx:1497`, #2113) is real and in scope.**
`onOpenPlan` inside `SprintModal` (`App.tsx:1489`) looks up `allCards.find((c) =>
c.slug === slug)` and, finding none, leaves the modal open with no fallback — the comment
at `App.tsx:1496-1499` says there is "no `/plan/<file>` path to fall back to (only the
slug, not the file)". That is no longer true: `planFileFromFleet`
(`packages/board/src/app/lib/agent-rows/plan-level-row.tsx:110`) already maps a slug to
a plan file from the fleet's own payload (branch rows and draft plans), independent of
whether the board has a card — it is the same lookup `AgentList.tsx:520` already uses for
plan-level rows. Wire `onOpenPlan` to call it: when the board holds no card but the fleet
names a file for the slug, navigate to `/plan/<file>` instead of doing nothing.

### Done when

The plan's `## Done when` is implicit in its `## Changelog` line for this slice:
"the board fetch bound fits the 4 s poll, and a plan click on an unreachable board answers
at once." Concretely:

- `BOARD_POLL_TIMEOUT_MS` (or its replacement) no longer lets two `/api/board` requests
  race under the 4 s starting-poll or a channel-triggered refetch — prove this with a test
  that drives the starting-poll cadence and asserts no more than one request is in flight,
  not just that the constant changed.
- The `App.tsx:151` comment claiming "the 12 s bound keeps at most one board request live"
  is corrected to say what actually keeps that true (or is removed if nothing does yet).
- A remembered click resolves to `/plan/<file>` immediately when the board is already
  known unreachable, rather than waiting the full `PENDING_PLAN_TIMEOUT_MS`.
- A new browser test covers "a remembered click whose board later lands without the
  card" — the plan names this gap explicitly (`plan-link-click.browser.test.ts:108`'s
  neighbourhood has no such case; the existing tests cover "board loaded with card",
  "click remembered then board loads with card", and "board never answers at all", but
  not "board answers, late, with no card for this slug").
- The three `card as Card` casts are gone, or justified if one turns out to be
  irreducible — say which.
- The sprint-modal `onOpenPlan` falls back to `/plan/<file>` via `planFileFromFleet` when
  no card exists but the fleet names a file.
- The existing route-callback style stays synchronous (no `async`/`await route.fetch()`
  inside a `page.route` callback) per the LOW finding at
  `plan-link-click.browser.test.ts:108`, and no test waits out a real 30 s timer where a
  shorter one proves the same thing — [[playwright-route-callbacks-must-be-synchronous]].
- The test-file header comment (`plan-link-click.browser.test.ts:10-22`) is corrected if
  it still narrates only the #2083/a-click-on-a-plan-story history rather than describing
  the mechanism as it stands after this slice's fix.

Plus: no new generated-bundle diff (`packages/board` builds its own bundle; do not commit
`board-server.mjs`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each
push and run what it prints — it resolves the related `vitest`/`tsc` runs for
`packages/board` and the gate scripts for a touched `.tsx`/`.ts` file. The suites named in
`CLAUDE.md`'s `CI suites` key (including `test:e2e` and the full board test run) run in CI
on the PR; do not run them locally as a matter of course — `test:board` rebuilds the bundle
and takes the operator's own running board down if one is open on this machine
([[never-run-board-tests-while-the-board-is-open]], [[local-test-board-takes-the-operators-board-down]]).

`scripts/check-shell-lines.sh` does not apply — this slice touches no `.sh` file.

### Bookkeeping

Open the PR through the controller once the branch has its first real commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch, ready
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` directly. When the PR exists, append `→ #<number>` to this
branch's line in the plan's `## Slices` section, under the `### Board client` heading:

```
- `bug/board-client-fetch-bound-and-click` — fetch bound, immediate feedback on an unreachable board and click tests (#2088, #2113) → #<number>
```

No project board is configured in this plan's `## Plot Config`, so skip the "Ready"
status step.

### Scope guard

This branch owns `packages/board/src/app/App.tsx` and
`packages/board/test/integration/plan-link-click.browser.test.ts`. It may also touch
`packages/board/src/app/lib/agent-rows/plan-level-row.tsx` only to call the existing
`planFileFromFleet` export from `App.tsx` — add no new export there unless the existing
one cannot be wired in from the sprint-modal callback as-is.

The plan's other four slices are not yet claimed (no remote branch exists for any of
them as of 2026-10-24) and touch disjoint files — `pr-status.ts`/`host-notes.ts`,
`issue-offline-fallback.ts`/`fleet.ts`, `fleet-state.ts`, and
`trees-git.ts`/`board.ts` respectively. None of them names `App.tsx` or the
plan-link-click test, so no collision is expected; verify at dispatch time if any of
those branches appear before this one lands.

If you find something the plan did not anticipate, report it rather than improvising
outside scope.
