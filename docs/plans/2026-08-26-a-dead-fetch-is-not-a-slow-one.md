# A dead fetch is not a slow one

> The plan viewer waits forever on a request that will never answer, and shows
> the same "Loading…" it shows for one that is merely slow.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-board-serves-an-enterprise-stack
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

- The plan and story viewers bound how long they wait, so a request whose
  connection dies mid-response says so instead of showing "Loading…" forever.

## Motivation

### Measured 2026-08-26

A reader opened a plan and the panel sat on `Loading…` indefinitely. The route
was fine — tested the same minute:

```
/plan/2026-08-26-a-degraded-scan-says-why.md          HTTP 200  18345 bytes
/plan/2026-08-26-a-degraded-scan-says-why.md?embed=1  HTTP 200  18263 bytes
```

What happened is that `pnpm board` runs under **`node --watch`**, and the
board's worktree had just been pulled forward 23 commits. That many changed
files restarts the server — **mid-request**. The fetch had already sent its
headers; the socket died before a response arrived.

### The error path exists and does not fire

`DocModal.tsx` handles this properly on paper:

```tsx
{error ? <p …>Failed to load {label}: {error}</p>
 : srcDoc === null ? <p …>Loading…</p>
 : <iframe srcDoc={srcDoc} … />}
```

A rejected `fetch` sets `error` and the red branch renders. **But a connection
that dies mid-response neither resolves nor rejects promptly** — the promise
simply stays pending, `srcDoc` stays `null`, and the `Loading…` arm renders for
as long as the modal is open.

So the component distinguishes *failed* from *loaded* and cannot distinguish
*failed* from *still loading*. There is no timeout anywhere in the path.

### Why this is worth fixing rather than shrugging at

The board restarts itself routinely: `node --watch` is how `pnpm board` is
defined, so **every rebuild, every pull, every artifact write restarts the
server under whatever request is in flight**. This is not a rare network fault;
it is the board's normal operating mode.

And the failure is indistinguishable from the thing it must not be confused
with. A reader who sees `Loading…` waits. A reader who sees *"Failed to load —
the server restarted"* closes and reopens, which is the whole fix.

## Design

### Bound the wait with `AbortSignal.timeout`

`fetch(embedSrc, { signal: AbortSignal.timeout(MS) })` rejects with an
`AbortError` when the bound elapses, which lands in the existing `.catch` and
lights the existing red branch. **No new render state is needed** — the
component already knows how to say *failed*; it just never gets told.

### The message must name the likely cause

*"Failed to load plan: TimeoutError"* is technically true and useless. The board
restarts under `node --watch` constantly, so the message says so and says what
to do:

> Failed to load plan — the request timed out. The board restarts when its
> files change; close and reopen.

This is the same standard `a-degraded-scan-says-why` sets for the scan: report
the CLI's own words rather than a category, and tell the reader what it means.

### How long

Long enough that a genuinely slow render is not cut off, short enough that a
dead socket is not mistaken for one. The largest plan measured here is ~18 KB
served from local disk — milliseconds. **10 s** is roughly a thousand times the
observed load and still well inside a reader's patience.

The number is a CEILING, not a target — the same framing `ci.yml`'s
`timeout-minutes: 25` uses: *a wedged step never returns and sits there looking
like work.*

### Not chosen: retry automatically

A restart-killed request would usually succeed on a retry, and it is tempting.
Rejected: the server may be mid-restart for several seconds and a retry loop
would hide that, which is the failure this plan exists to remove. Say what
happened; let the reader click.

### Every fetch in the app, not just this one

`DocModal` is where it was measured, but the same unbounded shape will exist
wherever the app fetches. Audit them; a timeout that covers one viewer and
leaves the others is a fix that has to be found twice.

## Waves

### Bounded (Branch: bug/a-dead-fetch-is-not-a-slow-one)

The doc viewers bound their fetch and report a timeout as a failure naming the
likely cause; every other client fetch is audited for the same gap.

## Done when

1. **A request that never answers renders the FAILURE branch**, not `Loading…`.
   Asserted with a route that accepts the connection and never responds — a
   rejecting route already works today and does not reproduce the defect.
2. **A slow-but-successful load still succeeds.** The bound must not turn a
   large plan into an error; asserted just under the limit.
3. **The message names the restart**, not just the exception class. A reader who
   cannot act on the message has been told nothing.
4. **Every client `fetch` is bounded**, or the ones deliberately left unbounded
   say why in a comment. Asserted by reading, not by a test.
5. `pnpm run test:board`, `pnpm run typecheck` green.

## Notes

### It was nearly diagnosed as a server bug

The first reading was *"the board does not load artifacts"*, and the route was
tested to check — 200, 18 KB, twice. **The server was never the problem**, and
without that check the investigation would have gone into `/plan/` handling and
found nothing wrong there.

What made it confusing is that the component *does* have an error state, and it
is correct. Reading the code suggests the failure is handled; only the runtime
shows that the handled case is not the case that happens.

### The fourth instance of one shape today

`a-degraded-scan-says-why` (a 429 read as *no CLI*),
`the-adapter-checks-the-cli-it-got` (an unknown flag read as *no PRs*),
`the-header-names-the-branch-it-is-serving` (a bundling error read as *detached
HEAD*), and this: **a failure given the same appearance as a legitimate state**.

Three of those four were silent because something swallowed an error. This one
is silent because nothing ever produced one.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {
      "q": "Is the board failing to serve plan documents?",
      "a": "No — /plan/<file> returns HTTP 200 with 18KB, both plain and ?embed=1. The server was never the problem",
      "category": "technical"
    },
    {
      "q": "Why does the existing error branch not render?",
      "a": "A connection that dies mid-response neither resolves nor rejects, so the promise stays pending and the Loading arm renders forever; there is no timeout in the path",
      "category": "technical"
    },
    {
      "q": "Retry automatically?",
      "a": "No — the server may be mid-restart for seconds, and a retry loop hides exactly what the reader needs to know",
      "category": "tradeOffs"
    }
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": { "stack": false, "architecture": true, "implementation": true },
    "domain": false,
    "ux": { "happyPath": false, "edgeCases": true, "errors": true, "accessibility": false },
    "nonFunctional": { "security": false, "performance": true, "scalability": false },
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
