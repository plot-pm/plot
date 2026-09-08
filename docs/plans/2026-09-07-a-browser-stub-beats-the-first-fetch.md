# A browser stub beats the first fetch

> `fleet-settings.browser.test.ts` navigates the page, then installs its routes. The page's first `/api/fleet` fetch races that installation, and when it wins the test reads `FLEET_CONTROLS_DEFAULT` instead of its own stub — `parallelAgents: 3` where the test asked for `1`.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-09-07, Jan Wloka, plan-PR #762 merged
- **Started:** 2026-09-07, Jan Wloka, `bug/a-browser-stub-beats-the-first-fetch`
- **Delivered:** 2026-09-07
- **Released:** 2026-09-08, 2.14.0

## Changelog

- A browser test's routes are installed before the page can fetch, so a stub cannot lose to the server it replaces.

<!-- Board impact: none. This is a test-harness ordering defect; nothing the
     board serves changes. -->

## Motivation

**Measured 2026-09-07, on two different branches within an hour.** `the stepper refuses to go below 1` failed with `expected '3' to be '1'` on #746 and again on #750 — and passed in isolation both times.

**The value is not arbitrary.** `contract/schema.ts:3251` declares `FLEET_CONTROLS_DEFAULT = { autoDispatch: false, parallelAgents: 3 }`, and `3` is exactly what the test read. **It was reading the real server's default, not its own stub.**

**THE ORDER IS THE DEFECT.** `open()` does this:

```ts
const page = await cat.open('an-empty-estate', { tab: 'agents' });   // navigates
await page.route('**/api/fleet', …);                                 // stubs
```

The page begins fetching as soon as it loads. Under load the fetch wins, the route arrives too late, and the test asserts against a payload it never supplied.

**IT IS NOT A STUBBING GAP AND THAT IS WORTH SAYING.** The file stubs `/api/fleet` and `/api/fleet-controls` properly and says so in a comment. **The stub is correct and installed too late** — which is why the failure looks like flake and reads like contamination.

**THE ESTATE IS OTHERWISE WELL STUBBED.** Measured: **51** board tests run against `an-empty-estate` or `tiny-garden` fixtures; **3** read the live estate, and two of those do it deliberately.

## What this is not

**Not a fix for `monitors-real-estate.test.ts`.** That file reads the real estate on purpose and states why — *"a fixture with a handful of branches is not an estate, and a test that quietly passes on one would be asserting nothing while looking green."* Its failure — `warm.stats.spawns` of 1 rather than 0 — is a ref changing between the cold and warm pass while agents push. **The test is right; the estate moved.** Making it deterministic is a different question about whether a live-estate test can run beside a working fleet.

**Not a fix for the `refs` corpus.** Same shape: it compares the adapter against `plot-fleet-scan.sh` over live `docs/plans` and remote refs, and both move.

**Not a retry.** Re-running until green hides an ordering bug that is fixable.

## Slices

### The routes are installed before the page can fetch (Branch: bug/a-browser-stub-beats-the-first-fetch)

`open()` installs its routes on a page that has not yet navigated.

**PLAYWRIGHT SUPPORTS THIS DIRECTLY** — route on the context, or on a blank page before `goto`. What must not survive is *navigate, then route*.

**THE FIX MUST NOT MAKE THE CALLBACK ASYNC.** The file's own comment records the cost: *"a synchronous route callback, because an async one fails tests that already passed."*

**AND IT MUST NOT BECOME A WAIT.** Sleeping until the fetch has surely happened trades a race for a slower race. The route exists before the navigation or the fix is not one.

**Done when** the file's tests pass with the fleet working and the machine at load, `the stepper refuses to go below 1` reads its own `parallelAgents: 1`, and no test in the file waits on a timer.

## Notes

### Why this looked like load — 2026-09-07

It failed only when the fleet was busy, alongside two tests that genuinely do read the live estate. Three files failing together under load reads as one environmental cause.

**The three have three causes**, and only this one is a bug: a cache correctly invalidated by a moving ref, a corpus correctly comparing a moving estate, and a stub installed after the fetch it was meant to intercept.
