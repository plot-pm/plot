# The controller answers every asker

> A controller layer between the callers and the domain — the board's HTTP routes ask it, and so does the master agent. The driven side gains mock adapters, so a mock board serves mock data to every controller above it without any controller knowing.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-domain-is-one-implementation
- **Issue:** <!-- optional -->
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

- The board's HTTP routes and the master agent ask one controller layer for fleet state instead of each reaching for the estate itself; mock adapters on the driven side let a mock board serve any controller.

<!-- Board impact: YES. Every route gains a controller between it and the work
     it does today. The payload does not change: the same values arrive by a
     different path. Rebuild the artifact on every branch. -->

## Motivation

> **Depends on [`2026-08-28-the-domain-runs-the-workflows-in-a-sandbox.md`](2026-08-28-the-domain-runs-the-workflows-in-a-sandbox.md)**
> for its driven ports and adapters. Those seven exist as of
> `feature/the-ports-have-adapters`; the rest of that plan is in flight.

**The driven side is built and the driving side is missing.** The seven ports
are all *world → domain*: `PlanStore`, `Refs`, `Host`, `Processes`, `Trees`,
`Clock`, `Machine`. Nothing yet answers the other question —
[Ports §3](../stories/the-master-agent-holds-the-fleet/DESIGN-ports.md#3-the-driving-ports-who-asks-the-domain)
calls it *who asks the domain*.

**Today the answer is: everyone, separately.** The board's 19 HTTP routes each
compose their own reading-plus-decision inline, and **10 skills invoke a scan
script directly**. That scan costs **18.3 s** — measured, with 12.7 s of it in
git alone — and every asker pays it in full, while the board is already holding
the same answer in memory from its last pulse.

**The master agent is a first-class asker, not an afterthought.** When it wants
to know what the fleet is doing, which slices are eligible, what a plan says or
which story a branch belongs to, it should ask the same layer the browser asks
and get the same answer. **Two askers deriving the same fact independently is
the duplication this whole sequence exists to remove**, one level above the
rules.

## Design

### The controller is the driving port, and it lives in the board

`packages/board/src/server/controllers/` — not in the domain package.

**A controller knows about requests and callers; the domain must not.** It
takes a question in caller-shaped terms, gathers readings through the driven
ports, asks the domain to decide, and returns an answer. That knowledge of
*being asked* is exactly what the purity gate keeps out of
`packages/domain/src`, so the controller sits on the board side of the seam
while the rules stay on the other.

**It is not HTTP.** A controller function takes typed arguments and returns a
typed result. HTTP is one caller; the master agent is another; a test is a
third. **The route becomes a translation** — parse the request, call the
controller, serialise the answer — and nothing else.

### The mock is a driven adapter, and no controller knows it exists

**This is the shape that makes mock data cost nothing.** The mock is not
injected into controllers and is not a mode a controller checks. It is a
**specialised adapter on the driven side**: a `PlanStore` that answers from
fixtures instead of `plot-plan-meta.sh`, a `Refs` that answers from a table
instead of git.

```
mock board  ──starts──►  mock adapters  ──feed──►  every controller above
                                                    (which cannot tell)
```

**So starting a mock board serves mock data to every controller, unchanged.**
A controller written against the ports gets fixtures or the real estate
depending only on which adapters were constructed — and that is the same
substitution the ports were built for, used for a second purpose.

**This replaces the env-var mock rather than extending it.** `mock-fleet.ts`
switches the whole server through `PLOT_BOARD_MOCK=1`, which means one global
state per process: two tests cannot hold different estates at once, and a test
that forgets to unset it poisons its neighbours. Mock adapters are constructed,
not signalled, so a caller holds exactly the estate it built.

### The name, and the one it collides with

**`fleet-controls.ts` already exists and is not this.** It holds two
configuration values — auto-dispatch on/off, parallel-agent cap — and reads and
writes a file. It is fleet *settings*, not fleet *control*.

**It is renamed to `fleet-settings.ts` in the first branch that touches it**,
because two modules whose names differ by one letter, one holding config and
one answering every question about the estate, is a confusion that will cost
somebody an hour. The rename is mechanical and its tests move with it.

### What a controller must not become

**A controller composes; it does not decide.** The eligibility rule, the
deliver rule, the reap refusals belong in the domain — a controller that starts
holding an `if` about lifecycle has recreated the problem one layer up. **The
test is the same one this sequence has been using:** does this code answer
*what is true?* (adapter), *what should happen?* (domain), or *who wants to
know, and in what shape?* (controller).

## Slices

**The first slice proves the shape on one question; the rest follow it.** No
big-bang: each slice moves one controller's worth of question, and the route
above it becomes a translation.

### Naming (Branch: feature/fleet-settings-is-not-fleet-control)

`fleet-controls.ts` → `fleet-settings.ts`, tests and imports with it.

**Done when** no module named `fleet-controls` remains, `pnpm test:board` passes
unedited, and the name `controllers/` is free for what follows.

### Asking (Branch: feature/one-controller-answers-the-board)

The first controller — fleet state, the question `/api/board` and `/api/fleet`
both serve — with `/api/board` reduced to parse-call-serialise.

**Done when** `/api/board` contains no estate access of its own, the controller
is callable from a test with no server, and the board payload is unchanged.

### Mocking (Branch: feature/the-mock-is-an-adapter)

Mock adapters for `PlanStore` and `Refs`; the mock board constructs them.
`PLOT_BOARD_MOCK` keeps working and is implemented through them.

**Done when** a mock board serves the first controller with no controller code
mentioning the mock, and two tests can hold different estates simultaneously.

### Asking again (Branch: feature/the-master-agent-asks-the-controller)

The master agent reaches the same controller — one entry point, callable
without HTTP, returning the same typed answer the route serialises.

**Done when** a skill can obtain fleet state without spawning
`plot-fleet-scan.sh`, and the answer is identical to the board's.

## Notes

**This plan does not migrate the 65 server-starting tests.** Measured
2026-08-30: 65 test files start an HTTP server to exercise logic — 42 in
`test/integration/`, 23 at the test root. Once controllers exist, most of that
is unnecessary, and rewriting them is a large, mechanical, separately reviewable
change. **It gets its own plan**, and this one states the risk of deferring it:
a controller layer whose tests still go through HTTP has paid for the seam
without collecting on it.

**Open: how the master agent reaches the controller.** In-process is not
available to a skill written in shell. The candidates are a small `node` entry
point (the precedent exists — seven scripts already invoke node) or an HTTP call
to a board that is already running. **The second has a hidden dependency** — it
answers only while a board is up — and the first re-derives what the board
already computed. This is the plan's one genuinely open question and it should
be settled before the Asking-again slice starts.
