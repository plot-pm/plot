## Implementation brief — a-browser-stub-beats-the-first-fetch (slice: The routes are installed before the page can fetch)

- **Plan (canonical):** `docs/plans/2026-09-07-a-browser-stub-beats-the-first-fetch.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `bug/a-browser-stub-beats-the-first-fetch` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

One slice. Read the plan's Notes — *"Why this looked like load"* — before you start; it explains why this was misdiagnosed twice.

## The defect, at the line

`packages/board/test/integration/fleet-settings.browser.test.ts:87-92`, in `open()`:

```ts
const page = await cat.open('an-empty-estate', { tab: 'agents' });   // ← navigates
await page.route('**/api/fleet', ...);                               // ← too late
await page.route('**/api/fleet-controls', ...);
```

**The page navigates on line 88 and the routes install on 90.** Whether the stub is in place before the app's first fetch is a race the test never declares. When it loses, `/api/fleet` reaches the real server, the app renders `FLEET_CONTROLS_DEFAULT` (`parallelAgents: 3`), and an assertion expecting `1` fails.

## Three constraints, all from the plan

**PLAYWRIGHT SUPPORTS THIS DIRECTLY.** Route on the **context** (`cat.context.route(...)`), or on a blank page before `goto`. What must not survive is *navigate, then route*.

**THE CALLBACK MUST STAY SYNCHRONOUS.** The file's own comment records the cost, at line 84: *"a synchronous route callback, because an async one fails tests that already passed."* Moving where the route is installed does not license changing what it is.

**IT MUST NOT BECOME A WAIT.** Sleeping until the fetch has surely happened trades a race for a slower race. **The route exists before the navigation, or the fix is not one.**

## Why it looked like load, and why that matters here

This failure moves between runs, which is the signature of fleet load on this machine — and it was read that way twice. It is not load: the assertion reads `parallelAgents: 3` against an expected `1`, which is `FLEET_CONTROLS_DEFAULT` exactly. A loaded machine makes the race lose more often; it does not create it.

**So do not verify by re-running until green.** A pass under no load proves nothing. Verify by making the stub's presence a precondition rather than a timing outcome.

## Verification

- The file's tests pass **with the fleet working and the machine at load** — that is the condition the defect appears under.
- `the stepper refuses to go below 1` reads its own `parallelAgents: 1`, not the default 3.
- **No test in the file waits on a timer.** Grep your own diff for `setTimeout`, `waitForTimeout`, and bare sleeps.

## Repo gates

```bash
nvm use              # Node 24 — pnpm crashes on 26
pnpm install
pnpm run test:board  # rebuilds the artifact, then runs its tests
pnpm run typecheck
```

**Do NOT run `pnpm run test:e2e`.** CI's gate, not a local one.

**Browser tests fail under fleet load for unrelated reasons too.** A *different* browser test failing each run is load; *this* test failing on `parallelAgents: 3` is the defect. Check `uptime` before concluding either way.

**`test:board` dirties a fixture** — it rewrites `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json` with this machine's estate. Revert it before staging.

## Done when

The file's tests pass with the fleet working and the machine at load, `the stepper refuses to go below 1` reads its own `parallelAgents: 1`, and no test in the file waits on a timer.
