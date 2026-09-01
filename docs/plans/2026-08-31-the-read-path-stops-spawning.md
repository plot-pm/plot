# The read path stops spawning

> Every `/api/board` request runs ~20 synchronous child processes on the event
> loop, so the board cannot answer anything while it answers that. The ports
> that replace them already exist and are already async; this moves the READ
> path onto them and leaves the write routes for a later slice.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-domain-is-one-implementation
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-31, Jan Wloka, in-session
<!-- Transition records — written by the workflow commands, not by hand:
- **Started:** <date>, <who>, <branch>   (one line per started branch)
- **Started:** 2026-08-31, Jan Wloka, `feature/the-board-reads-through-the-port`
- **Started:** 2026-09-01, Jan Wloka, `feature/the-fleet-reads-through-the-port`
- **Started:** 2026-09-01, Jan Wloka, `feature/the-registry-reads-through-the-port`
-->

## Changelog

- The board answers while it reads: `/api/board` and `/api/fleet` no longer run
  child processes on the thread that serves HTTP, so a slow git call delays the
  data it fetches instead of every request in flight.

Board impact: this IS the board. `packages/board/src/server/` read path only;
the plan format, template, helper scripts and `docs/plans` layout are untouched.
Rebuild the artifact.

## Motivation

**Measured 2026-08-31 with `sample <pid> 5`, on a board refusing every request.
Main thread, 4258 of 4262 samples:**

```
uv_run → uv__io_poll → http_parser::on_headers_complete()
 → v8::Function::Call → (the request handler)
   → node::SyncProcessRunner::Spawn        ← execFileSync
```

**A synchronous spawn cannot yield.** While it runs the event loop serves
nothing — a STATIC FILE timed out at 15 s beside it, and that is the reading
which finally separated this from every "the board is slow" theory. A slow
computation does not stop `/` from being served; a blocked loop does.

### Four causes were named from reading the source, and all four were wrong

Recorded because it is the argument for this plan's shape, not as history:

| named | refuted by |
|---|---|
| `publishPartial()` recomposing per scan line | stalls 3× MORE likely with NO scan running (23 % vs 8 %, 238 samples) |
| the host call (`pr-list --rich`, 22 s at 0 % CPU) | an outage with `children=0` — no child existed to wait on |
| a feedback loop (response > poll interval) | after killing leftovers the sequence DESCENDED, 17→12→8.6→8.3 s |
| machine contention | 25 s timeouts at load 4.26 with zero test processes |

Each was plausible from the code. The stack took five seconds.

### Two caches already removed the cheap half

Shipped 2026-08-31 as deliberate stopgaps:

| | removed |
|---|---|
| `readConfig` (`bash plot-config.sh`, 58 ms × 5) | **318 ms/request** |
| `rev-parse --show-toplevel` (89 ms), `origin/HEAD` (44 ms × 5 sites) | the static git answers |

`/api/board` went from a 1.2 s floor with 4–6 s spikes and 15–25 s wedges to
**~0.77 s warm**, with no signature changed — caching a synchronous function
keeps it synchronous.

**What remains is the part a cache cannot touch:** `ls-tree`, `for-each-ref`,
`show`, `cat-file --batch`. Those answer differently on every commit, so caching
them would make the board display an estate that no longer exists — the failure
`plot-fleet-scan.sh` avoids by re-deriving from git every pass. A second
`sample` after the caches shows the profile changed SHAPE rather than emptied:
**20 separate spawns in a 4 s sample**, the largest holding 49.

## Design

### The population splits cleanly, and the split is the plan

Measured 2026-08-31 across `packages/board/src/server/`:

| | files | spawns | blocks whom |
|---|---|---|---|
| **READ path** | `board.ts` 5, `registry.ts` 5, `fleet.ts` 3, `server-info.ts` 3, `agent-panel.ts` 3, `agent-log.ts` 2 | **21** | **every poll, every viewer** |
| write routes | `idea.ts` 7, `deliver.ts` 3, `dispatch.ts` 3, `reslice.ts` 3, `continue.ts` 3, `transition.ts` 2, `approve.ts` 2, `commission.ts` 1 | 24 | only the operator who clicked |

**This plan takes the 21 and leaves the 24.** They are not the same problem: a
write route blocking for two seconds is a button that feels slow to one person,
while a read-path spawn blocks *every* request in flight, including the static
files and the other tab.

The existing `feature/one-place-reaches-a-process` slice in
`production-calls-the-domain-one-rule-at-a-time` covers all 45 in ONE branch,
and its own text explains why that is a problem: *"this story exists because
agents stall on branches that size."* This plan is that slice's read half,
sized to finish.

### The ports already exist and are already async

Nothing is designed here. `packages/domain/src/ports/` holds `refs`, `trees`,
`plan-store`, `processes`, `machine` — every method returns a `Promise`, and
`refs-git.ts` / `trees-git.ts` implement them.

**And `refs-fixture.ts` already sits beside `refs-git.ts`**, which is the second
prize: a board on the ports takes an injected fixture and needs no repository,
no subprocess and no estate. That is the same round-trip property
`a-browser-test-serves-its-own-state` chases one layer up, reached from
underneath.

### `buildBoard` becomes async, and the blast radius was measured rather than feared

`buildBoard` is synchronous today, so this is the change that propagates. The
plan it is split from estimates *"48 functions here and 54 test files"* — that
counts every helper INSIDE `board.ts` plus every test that touches spawning
anywhere.

**Measured for `buildBoard` specifically: 6 test files call it, plus the route
handler.** The helpers are internal to one file and move with it. That is a
contained change, and knowing it is contained is what makes this slice
schedulable at all.

### What must not change

**The board must still show a current estate.** The caches shipped so far are
correct only because they cache facts about the CHECKOUT, never its contents.
This slice must not "fix" latency by caching a tree read — a fast board showing
last hour's plans is worse than a slow one showing this minute's.

**`plot-fleet-scan.sh` stays the fleet's source.** This is about how the board
CALLS things, not about what it believes.

**The two caches are retired by this work, not kept beside it.**
`plan-store.config(key, fallback)` is already the async twin of `readConfig`;
once the board calls the port, an mtime cache around a spawn is dead code
pretending to be an optimisation.

### Open Questions

- [ ] Does `registry.ts` belong in the read path or its own slice? It carries 5
      spawns and is read by the Agents tab, but it also writes manifests. Decide
      by reading its call sites, not by its name.
- [ ] Is one `Refs` call per question the right granularity, or does the board
      need a batched read? `cat-file --batch` exists precisely because per-object
      calls were too slow; a port that re-serialises it per plan would trade one
      blocking spawn for many awaited ones. Measure before choosing.
- [ ] Should `/api/board` gain a response cache once the calls are async? Async
      makes the board RESPONSIVE at the same latency. Whether ~770 ms per request
      is acceptable is a separate question, and answering it before measuring the
      async version would be inventing a requirement.

## Branches

### Reading

- `feature/the-board-reads-through-the-port` — `board.ts` only: `git()` and `gitBuffer()` give way to `Refs`, `buildBoard` becomes async, its route handler awaits it, and the static-git cache is deleted. The largest single file and the one on every request. → #580

### Fleeting

- `feature/the-fleet-reads-through-the-port` — `fleet.ts`, `server-info.ts`, `agent-log.ts`: the `/api/fleet` half. Second because it is smaller and because `board.ts` proves the pattern first.

### Registering

- `feature/the-registry-reads-through-the-port` — `registry.ts` and `agent-panel.ts`, once the open question above has an answer.

### Proving

- `feature/a-read-route-spawns-nothing` — the gate: a test asserting no synchronous spawn occurs while a read route is served, and a `sample`-based measurement in the plan showing the profile after. Last, because a gate over unfinished work is a gate nobody can pass.

### The async ripple is wider than `buildBoard`, and it lands in the tests

**Measured 2026-09-01 while implementing the Reading slice.** The plan named
`buildBoard` becoming async and its route handler awaiting it. What actually
became async, because each awaits the port transitively:

    buildBoard  buildFleet  boardState  askOnce  askOncePerEstate
    planStatusBySlug  collectSprints  activeSprints

Production needed exactly one change — `controllers/fleet-state.ts:115` awaits
`buildBoard` — which is the plan's own prediction holding. **The cost landed in
the tests: 23 failures across 5 files**, all the same shape, none a behaviour
change:

| symptom | cause |
|---|---|
| `f.rows` undefined rather than empty | a Promise read as its value |
| `activeSprints(...).sort is not a function` | ditto |
| a serialised answer comparing as `'{}'` | `JSON.stringify(Promise)` |
| `expected undefined to be true` | `.measured` off a Promise |

**So a later wave should expect its own test-side ripple** rather than reading a
green production diff as done. `fleet.ts`, `registry.ts` and `agent-panel.ts`
have their own callers.

**One fix generalised and the rest did not.** `streaming-scan.test.ts` polls a
producer through a local `until(read, want)` helper; making `until` await its
reader fixed every call site at once, and it is the right place because a poller
that takes a producer owns that producer's asyncness. A predicate handed a
Promise answers false forever, so the poll times out and returns the Promise —
which is how the failure presented as `undefined` rather than as a rejection.

**And the artifact is a test dependency.** `tiny-garden.browser.test.ts` renders
the shipped bundle, so it fails on any `board.ts` change until `pnpm build:board`
runs. It was the last of the 23 to go green and it needed a rebuild, not a fix —
worth knowing before reading it as a regression.

## Done when

- **A `sample` of the board under load shows no `SyncProcessRunner::Spawn` below
  a read route's handler.** This is the measurement that found the defect and it
  is the one that closes it — not a latency number, which contention can flatter
  or spoil.
- `/` answers in single-digit milliseconds **while `/api/board` is in flight**,
  asserted back to back rather than on a timer. A static file served during a
  slow API call is the whole property.
- The board still shows a plan added since the last request — asserted, because
  the tempting wrong fix for latency is a cache that freezes content.
- The static-git and config caches are **deleted**, and their tests with them.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`, changeset.

## Notes

**This is the read half of `feature/one-place-reaches-a-process`.** That slice
stays for the write routes; when both land, `packages/board/src/` runs no child
process on the request path and the grep in its `Done when` passes.

**Why a separate plan rather than a re-slice.** The parent plan is about
LAYERING — production calling the domain, one rule at a time. This is about a
board that stops answering, measured with a stack, and its `Done when` is a
profile rather than a grep. Filing it as a slice of that plan would bury a
performance fix inside an architecture story and make both harder to review.

**Do not run the board suite locally while an operator is using the board.**
Measured three times on 2026-08-31: `pnpm --filter @plot-pm/board test` puts six
board servers on the machine and the operator's own board stops answering.
Verify with the specific vitest files, run `typecheck`, and let CI run the
suite — it is the authority and it has its own machine.
