## Implementation brief — the-channel-closes-its-review-findings (wave: Page event throttle)

- **Plan (canonical):** [docs/plans/2026-10-10-the-channel-closes-its-review-findings.md](../../docs/plans/2026-10-10-the-channel-closes-its-review-findings.md) on `main`
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1497 merged
- **Branch:** `bug/the-page-hears-the-last-event` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per plan's `Review: pr`

This is the sixth of seven slices (`### Page event throttle`). It shares no file with slices 1–3 or slice 7. It runs after slice 4 (`agents-tab.browser.test.ts`) only in the sense that both touch that file — slice 4 changes assertions there for the renamed `briefWriter` field, this slice does not touch `agents-tab.browser.test.ts` at all, so there is no real ordering dependency; nothing here waits on another slice landing first.

### What to build

Four related gaps in how the board's SSE channel throttles events, all traced to `origin/main` at `eb4bda159` in issue #1470:

1. **A dropped event never gets a trailing send.** `ruleEventWindow` (`packages/domain/src/rules/event-window.ts:30`) admits the first arrival in a window and silently drops the rest — it never schedules anything for the window's end. A finding published at 1.3s into a 2s page window is dropped and the page does not refetch again until the 30s poll (`App.tsx:343` → `event-listener.ts`). Fix: the ruling must say *this arrival was dropped, and something changed inside this window* so the caller can schedule one trailing send/refetch when the window closes — not just "admit: false".
2. **Six-tab-per-browser connection limit.** Every open board tab calls `new EventSource('/api/events')` directly (`App.tsx:343` via `event-listener.ts:35`), and the server is HTTP/1.1 only (`packages/board/src/server/index.ts:939`, `:1040`). A browser's per-host HTTP/1.1 connection cap (6 in Chrome) means a seventh tab's `EventSource` never connects. Fix: tabs of one browser share one real `EventSource`; one tab holds it and relays events to the others over a `BroadcastChannel`, with hand-over when the holder tab closes.
3. **A `welcome` right after a tab's own `load()` triggers a redundant refetch.** `attach` sends `welcome` to each newly-attached client (`channel-events.ts:142` — line numbers may have shifted since the review). The page already refetched once on its own `load()` (`App.tsx:334-343`), so the `welcome` immediately after causes a second `/api/board` fetch for the same state. Fix: the first `welcome` after a page's own load triggers no refetch — decided in the domain rule, not read ad hoc in `App.tsx`.
4. **`window` shadows the global.** Both `channel-events.ts:59` and `event-listener.ts:33` declare `let window: EventWindow = {}`, shadowing the browser/Node global in a file that also references timers and (in `App.tsx`) `window.matchMedia`. Rename the local.

### Decisions the plan settles — do not re-derive them

**The event window keeps NO config key.** `SERVER_EVENT_WINDOW_MS` (1000ms, `channel-events.ts:17`) and `PAGE_REFETCH_WINDOW_MS` (2000ms, `event-listener.ts`) stay exactly where they are, as exported constants in `packages/domain/src/rules/event-window.ts`. The fix is to the *ruling's shape* (does it report a drop worth a trailing send), not to the window lengths. Don't add a third config key for a trailing-send delay — the trailing send fires at the *existing* window boundary, not a new timer length.

**Six-tab sharing needs a real browser test, and that is the ONE test this slice is allowed to add.** The plan is explicit: "A browser test with several pages proves that the second page opens no stream; it adds an `it(`, so `EXPECTED_TESTS` moves from the base's value by one." Measured today: `EXPECTED_TESTS = 557` at `packages/board/test/integration/stubbed-tests-start-no-board.test.ts:671`. Every OTHER change in this slice — the trailing send, the `welcome`-after-load suppression, the `window` rename — touches *existing* browser test assertions (`page-hears-channel.browser.test.ts`), never adds a new `it(`. If your diff moves `EXPECTED_TESTS` by more than 1, you added a test this slice doesn't call for.

**Absence tests must wait on receipt, not a fixed sleep.** `channel-events.test.ts` today asserts an absence (no broadcast, no second connection) after a fixed 50–120ms sleep, and one assertion (`:135` in the review's line numbers) waits on the channel rather than the hub. A fixed sleep under load is exactly the kind of flaky-by-construction wait this repo's test memory warns about — wait on the hub's own receipt/ack, not a timer. Same principle for `page-hears-channel.browser.test.ts:54-56`, which the review found asserting the request count immediately after `emit()` — assert only after advancing past the page's window (the test already uses `page.clock.runFor`, as the existing test above shows; follow that pattern, don't add a new sleep-based wait).

**The browser test's own window of a `welcome`-triggers-no-refetch case is per-page-load, not per-session.** A second `welcome` arriving later in the same page's life (e.g. after a server reconnect) is NOT "right after load" and should still refetch as it does today — only the one immediately following this page's own `load()` call is suppressed. If you can't cleanly express "immediately following this page's own load" as a domain-rule input, say so in the PR rather than guessing a timeout-based heuristic.

**`ruleEventWindow`'s signature change is additive, not a rewrite.** `EventRuling` today is `{ admit: boolean; window: EventWindow }`. The trailing-send need is naturally expressed by also returning something like "a window that dropped at least one arrival" so the caller (the SSE hub server-side, and `event-listener.ts` client-side) can schedule exactly one deferred action when its own window elapses. Keep the pure function pure — it takes `(window, now, windowMs)` and returns a verdict; it does not itself set timers. The caller (`channel-events.ts`'s `onMessage`, `event-listener.ts`'s `source.onmessage`) owns the `setTimeout`/equivalent that fires the trailing send.

### Done when

The plan's `## Done when` is implicit in the per-issue bullets above (#1470 M1, M2, L1–L4) — there is no separate `## Done when` heading in this plan; treat the five numbered findings in the `### Page event throttle` slice line as the spec:

- A burst of events inside one window yields exactly one admit now and exactly one trailing send/refetch at the window's end — not zero (today's bug) and not one per dropped event.
- A 7th (or Nth) tab of the same browser opens no second `EventSource`; the new browser test proves it by opening several pages and asserting only one `window.__sources`-equivalent connection exists. This is the one new `it(` — `EXPECTED_TESTS` becomes 558, with a dated history-comment line in the same commit, per the plan's `## Approach` rule on that constant.
- The first `welcome` right after a page's own `load()` causes no `/api/board` fetch; a later `welcome` (reconnect) still does.
- `channel-events.test.ts` and `page-hears-channel.browser.test.ts` assertions wait on receipt/the page's own clock, not a fixed sleep.
- Neither `channel-events.ts` nor `event-listener.ts` declares a local `window` that shadows the global.

Plus the repo's standing gates: no committed board bundle diff (generated, `-merge` in `.gitattributes` — see `CLAUDE.md`'s board-artifact-conflict procedure if you hit one), a changeset naming `@plot-pm/board` (this slice touches only board + domain code, not the `plot` skill package), and — if this branch's diff touches any `.sh` file under `skills/` — `scripts/check-shell-lines.sh`'s ratchet, which it should not need to since this slice is pure TS.

For tests: run `node skills/plot/scripts/board/plot-local-checks.mjs` from the repo root before each push and run what it prints — it resolves the related-test and typecheck commands for `packages/domain/**` and `packages/board/**` automatically from the changed files, plus the gate scripts. The suites listed under `CI suites` in `CLAUDE.md`'s Plot Config (`test:e2e`, `test:contracts`, `test:board`, the domain coverage run, the reconcile `node --test`) run in CI on every PR — do not run them locally as a matter of course; `test:e2e` in particular dispatches real workers into sandbox repos and is CI's gate, not a local one.

### Bookkeeping

Open the PR through the controller once there is a real commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch, or
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` directly — the controller reads which plan names this branch and titles the PR from the plan's wave heading. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section, under the `### Page event throttle` heading. Push the first real commit as soon as it exists so the branch is visible to `/plot-pulse`.

### Scope guard

This branch owns:

- `packages/domain/src/rules/event-window.ts` and its test
- `packages/board/src/server/channel-events.ts`
- `packages/board/src/app/lib/event-listener.ts`
- `packages/board/src/app/App.tsx` (only the `listenForEvents` call site and anything needed to pass a page-load signal into the suppression rule — not unrelated App.tsx code)
- `packages/domain/test/event-window.test.ts`
- `packages/board/test/integration/channel-events.test.ts`
- `packages/board/test/unit/event-listener.test.ts`
- `packages/board/test/integration/page-hears-channel.browser.test.ts`
- `packages/board/test/integration/stubbed-tests-start-no-board.test.ts` (only the `EXPECTED_TESTS` constant + its dated history comment)

Other slices in this plan and what they hold, so a collision is a known fact rather than a surprise at merge time (verified against this plan's `## Slices` section and `origin/main`'s remote branches at dispatch time — none of the five sibling branches had been pushed as of this writing):

- `bug/a-stale-default-branch-reading-holds-nothing` (slice 1) — `packages/domain/src/rules/default-branch.ts`, `packages/fleet/src/shared/default-branch-refresh.ts`, `skills/plot/scripts/plot-host.sh` or `build-jenkins.ts`, `registryd-main.ts:805-811` only. No overlap with this slice.
- `bug/the-channel-stamps-what-it-hears` (slice 2) — `packages/domain/src/adapters/channel/channel-socket.ts` (test only), `index-monitor.ts`, `pr-refresh.ts`, `desk-relay.test.ts`, `packages/board/src/server/findings.ts`. No overlap.
- `bug/the-fleetd-wiring-has-tests` (slice 3) — `registryd-main.ts`, `fleet-clock.ts`, fleet test files. No overlap.
- `bug/the-brief-writer-row-reads-the-rule` (slice 4) — `brief-writer.ts`, `schema.ts`, `row-identity.ts`, `fleet.ts`, `board-run.ts`, and `agents-tab.browser.test.ts`. Shares `agents-tab.browser.test.ts` with slice 5, not with this slice.
- `bug/the-board-builds-the-default-branch-reading` (slice 5) — `board.ts` (test only), `estate.ts`, `checks-reading.ts`, `agents-tab.browser.test.ts`. No overlap with this slice.
- `bug/the-mod-follows-after-a-reload` (slice 7) — `mods/plot-follow/**`, `follow-channel.ts` (domain copy + corpus test). No overlap.

If you find something the plan did not anticipate — e.g. the `welcome`-suppression needs a signal `App.tsx` can't cleanly provide, or the trailing-send mechanism needs a config key after all — report it in the PR description rather than improvising outside this scope.
