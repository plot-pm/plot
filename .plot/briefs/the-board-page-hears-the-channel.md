## Implementation brief — the-fleet-reports-what-changed-on-the-host (wave 5: The board page hears the channel)

- **Plan (canonical):** `docs/plans/2026-10-09-the-fleet-reports-what-changed-on-the-host.md` on `main`
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1451 merged
- **Branch:** `feature/the-board-page-hears-the-channel` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is wave 5 of 8. Waves 1 to 4 merged (#1455, #1460, #1464, #1466): fleetd opens the channel on `.plot/fleet.sock` in loop mode, and two publishers run on it — the IndexMonitor (`checks green`, `checks failing`, `pr merged`, `default branch red`) and the desk-findings relay (`owes a review`, `owes an answer`, `build failed`). Nothing subscribes except the master agent's `until` waits in `entry/act.ts`. Wave 6 (`the-board-shows-the-new-readings`) edits the payload and `StatusPanel.tsx`; this wave touches neither. Waves 6 and 7 wait on nothing here.

### What to build

The page learns of a change only by polling: `/api/board` every 30 s (`POLL_MS`, `packages/board/src/app/App.tsx:30`) and `/api/fleet` every 4 s while the Agents tab is open. A PR that merges or a desk that owes a review shows up to 30 s late on the Board tab, though the channel carried it within one tick. Two changes:

1. **The server subscribes and forwards.** A new module in `packages/board/src/server/` subscribes to `<repoRoot>/.plot/fleet.sock` with `subscribe` from `channel-client.ts` (purpose `{ kind: 'everything' }`, subscriber name `board`) and serves `GET /api/events` as `text/event-stream`. Each `finding` message becomes one SSE event; the server sends at most one event per second. The `welcome` that opens every subscription also becomes one event, so a page that reconnects fetches once and is current. Add the route beside `/api/fleet` in `handleRequest` (`server/index.ts:496`); it is a GET and needs no entry in the write-route table.
2. **The page listens.** `App.tsx` opens an `EventSource('/api/events')` and calls `load()` when an event arrives, at most once per 2 s. The 30 s poll stays untouched. With no channel running, the route stays open and sends no event, the page polls as it does today, and nothing is shown as broken.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**Server-sent events, not a WebSocket and not a poll interval cut to 5 s.** `EventSource` reconnects by itself, needs no dependency, and runs over the board's existing HTTP listener. Shortening the poll would cost a full `/api/board` build per tick for every open tab whether or not anything changed; a push costs one build per burst. The plan's *Cost* row for this wave is "none" for the host and "page refetches, at most one per 2 s while findings arrive" otherwise. Do not add a second transport.

**The event carries no payload the page trusts.** The page refetches `/api/board` on an event and renders what that answers. Do not patch the board state from the finding: the board's file read of the desk findings is still the source (wave 4 kept it on purpose, so a finding shows with no channel running), and a second path into the same state is how two readings come to disagree. The event body may carry the finding for a log or a test to read; the page ignores it.

**Two throttles, two places, two numbers.** The server sends at most one event per second; the page refetches at most once per 2 s. A burst of findings (the first fold after a restart publishes tens) must give the page one refetch and not one per finding. Put the coalescing decision in a domain function that takes the clock as an argument (`CLAUDE.md`, *Every rendered state is a domain property*): a unit test then asserts "ten findings inside one second give one event, a later finding gives another" with no timer and no server. The server and the page call the same rule; neither re-implements it.

**A missing channel is the normal case, not an error.** `--once` runs, a fleetd that is not started and a bind that failed all leave `.plot/fleet.sock` absent. The subscription retries with a bounded back-off (start at 2 s, cap at 30 s) and logs through the board's existing `boardLog` once per transition, not once per attempt. It never throws into the request path, and it never stops the board. This is the same rule wave 3 and 4 hold on the publisher side: channel failure never stops the process that uses it.

**A subscription ending is not being served.** `subscribe` calls `onEnd` with a reason for a refusal, a serving and a crash alike. An `everything` purpose is never served, so any `onEnd` means "reconnect". Do not read the empty reason as success.

**The route spawns nothing and blocks nothing.** `a-read-route-spawns-nothing.test.ts` walks every read route's handler for a synchronous spawn, so the new route is in its population. The socket subscription is asynchronous I/O and fits. Run that test and read its output; do not add the route to an exemption list.

**An open stream must not hold the board alive or look like activity.** `exitWhenIdle` (`server/lifetime.ts`) measures the time since the last request; a stream that is held open for hours is one request. Decide whether `lastRequestAt` is touched at connect only (the natural result) and confirm with a test that an open `/api/events` neither keeps an idle board from exiting nor blocks `server.close()`. If `close()` waits on the stream, end open streams on shutdown. Report the result in the PR description either way: it is the first long-lived response this server has had, and `PLOT_EXIT_WITH_PARENT` runs depend on the answer.

**The cost figure is a deliverable.** The plan says the slice "measures it and states the figure": one `/api/board` build costs what a poll costs today. Measure the build time of `/api/board` on this repo's own checkout (cold and warm) and state the number in the PR description. The expected result is "same as a poll"; the point is that a burst is bounded at one build per 2 s per open page, and that figure is now written down.

**Rules carried from earlier waves, so they are not rediscovered by breaking them:**

- Absent is not false. No channel is not "no findings"; the page must not claim the fleet is quiet because the stream is silent. The poll is the authority and stays.
- Do not subscribe in a request handler. One subscription per board process, shared by every open `/api/events` response. Ten tabs are ten responses and one socket.
- The board server does not call `seen`, does not publish and does not write to the channel. It is a reader (`RunningChannel` is fleetd's).
- Arrow functions for everything you write, tests included. No `.default()` in a schema; optional fields stay absent, never `''`.
- The heartbeat message is not a finding. Do not turn it into an event: it would refetch the board every beat. A comment line (`: keep-alive`) on an interval is fine if a proxy or the browser needs one; measure before adding it.

### Done when

The plan's wave line is the specification: a server test sees one event per published finding, and the page test refetches once for a burst of findings and polls as before with no channel.

The assertions that exist because a naive implementation would pass without them:

- **One event per finding, spaced.** Publish three findings more than a second apart on a real socket; the SSE client receives three events. Catches a throttle that drops everything after the first.
- **A burst gives one event, then the next window gives another.** Publish ten findings inside one second; assert one event, then publish one more after the window and assert a second. Catches a throttle that never reopens, and one that never closes.
- **The welcome is one event.** A client that connects while the channel holds 30 findings receives one event, not 30. Catches a forward of `current` as a list of findings.
- **A heartbeat is no event.** Hold a connection across a heartbeat; assert nothing arrived. Catches a forward of every message type.
- **No channel: the route answers and stays quiet.** Start the board with no socket; `GET /api/events` returns 200 `text/event-stream` and no event, and the `/api/board` poll still works. Catches a route that returns 500 or hangs on a missing socket.
- **The channel starts after the board.** Start the board first, then start the channel and publish; the client receives the event. Catches a subscription that tries once and gives up.
- **The channel restarts under a live client.** Stop and restart the channel; the next finding reaches the same client. Catches a subscription that ends with the first `onEnd`.
- **Two clients share one subscription.** Connect two; count the connections the channel sees. Catches a subscription per request.
- **A client that goes away is released.** Connect, abort, publish; assert no write to a closed response and no leaked listener. Catches the `ERR_STREAM_WRITE_AFTER_END` that a long-lived response is known for.
- **The page: a burst gives one refetch.** Deliver five events inside 2 s; assert one extra `/api/board` request. Then wait out the window, deliver one, assert another. Catches a page that refetches per event.
- **The page: no channel, the poll is unchanged.** With no event ever arriving, `/api/board` is requested at the 30 s cadence and nothing else. Catches a page that drops the poll once an `EventSource` exists.
- **The page: an `EventSource` error does not stop the poll or show an error.** Catches an `onerror` that sets the page's error state.
- **The throttle rule is a domain function with a unit test and no timer.**

For the page tests: Playwright's `route.fulfill` cannot stream, so a stubbed route cannot deliver a burst. Either replace `EventSource` with a controllable fake through `addInitScript`, or start the real board (`startServer`) and publish to a real channel under the test's own temp directory. The first is faster; the second proves the wire. `stubbed-tests-start-no-board.test.ts` gates which tests may start a board — read its rule before choosing, and mark a real-board test `@needs-real-board` with the reason, as `dead-fetch.browser.test.ts` does. Use a socket path under the test's own temp directory and wait on a message or on the server's close, never a sleep.

Mutation-test the gates you add: remove the 1 s server window, remove the 2 s page window, and make the subscription give up after one `onEnd`; read the failures before you trust the tests (`mutation-test-a-gate-before-believing-its-tests`). Commit before you mutate.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. This slice touches `packages/board/src` and likely `packages/domain/src/rules/`, so expect the board and domain vitest runs, `pnpm run typecheck`, the domain `tsc --noEmit` and the `scripts/check-*.sh` gates on the list. Do not run board tests while an operator's board is open on this machine; `pnpm run test:board` takes that board down, and `scripts/owned-run.sh` isolates the run.

**Shell-line gate.** `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, the growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

**Other gates:**

- A changeset in `.changeset/` for package `@plot-pm/board`, description first and the `bumps:` block last, with `plan: docs/plans/2026-10-09-the-fleet-reports-what-changed-on-the-host.md` inside the comment block. Run `./scripts/check-changeset-packages.sh`.
- The one-spawn ratchet (*One place reaches a process*, `ci.yml`) counts `spawn` and `execFile` in `*.ts`. This slice opens a socket and spawns nothing; the count must not grow.
- `pnpm build:board` only to test locally. `skills/plot/scripts/board/board-server.mjs` and the other bundles are generated: restore every generated path from the merge base before you push (`scripts/check-no-bundle-diff.sh`), and never commit a rebuild. A conflict in `board-server.mjs` is not read; follow *Definition of Done › Resolving a board artifact conflict*.
- The board is first-class (`docs/definition-of-done.md`): a new route and a page behaviour are board impact, and the plan's board-impact comment already names `/api/events`. If `CLAUDE.md` says the page polls only (`grep -n "poll" CLAUDE.md`), edit it, run `./scripts/check-agents-md.sh --write` and confirm with `./scripts/check-agents-md.sh`. Do not edit `AGENTS.md` by hand. If nothing is false after this wave, change nothing.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.
- Where a project board is configured, set the new PR to "Ready" with `../plot/scripts/plot-update-board.sh <pr-url> "Ready" <owner> <number>`; skip it otherwise.
- Do not edit the plan's `State:` line or any `Started:` record by hand; `plot-state-gate.sh` refuses it.

### Scope guard

This branch owns:

- a new module in `packages/board/src/server/` for the channel subscription and the SSE fan-out, and the one route block in `packages/board/src/server/index.ts`
- `packages/board/src/app/App.tsx` for the `EventSource`, and a small module under `packages/board/src/app/lib/` if the listener is extracted
- a domain rule under `packages/domain/src/rules/` for the throttle, and its test
- tests under `packages/board/test/unit/` and `packages/board/test/integration/`
- the changeset

Branches in flight, verified 2026-10-10 against `git ls-remote --heads origin 'feature/*'` and `gh pr list`: no open PR touches `server/index.ts`, `App.tsx` or the channel files. Wave 6 (`feature/the-board-shows-the-new-readings`) has no branch yet; it adds `defaultBranch` to the `/api/board` payload and edits `StatusPanel.tsx` and `AgentList.tsx`. This branch adds no payload field and edits neither file, so the two should merge in either order. Wave 8 waits on `feature/the-controllers-are-commands` (plan `the-fleet-runs-without-the-board`), which edits `packages/fleet/build.mjs` and `packages/board/src/contract/bundles.generated.ts`; this branch edits neither.

Out of scope, owned by other waves, and not to be started here:

- Any new field in `/api/board` or `/api/fleet`, `checksVerdict`, `defaultBranchStatus` and `StatusPanel.tsx` (wave 6).
- The mod (wave 7) and the merge controller (wave 8).
- Any change to the channel, `channel-client.ts`, the IndexMonitor, the desk relay or the monitors. If the channel's wire cannot serve the board as it is, report it.
- A new finding name, a new monitor name or a change to `READINGS`.

If you find something the plan did not anticipate, report it rather than improvising outside scope. Two cases to expect: the page's `load()` sets `pulse` state in its `finally` block, so an event-driven refetch also moves the refresh button's counter — check that this reads as intended and say so in the PR; and if the board server cannot read `.plot/fleet.sock` because `opts.repoRoot` differs from fleetd's checkout (a board started from a worktree), report that rather than guessing a path.
