# The controller answers every asker

> A controller layer between the callers and the domain — the board's HTTP routes ask it, and so does the master agent. The driven side gains mock adapters, so a mock board serves mock data to every controller above it without any controller knowing.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** the-domain-is-one-implementation
- **Issue:** <!-- optional -->
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-30, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-08-30, Jan Wloka, `feature/fleet-settings-is-not-fleet-control`
- **Started:** 2026-08-30, Jan Wloka, `feature/one-controller-answers-the-board`
- **Started:** 2026-08-31, Jan Wloka, `feature/the-mock-is-an-adapter`
- **Started:** 2026-08-31, Jan Wloka, `feature/the-master-agent-asks-the-controller`

## Approval

- **Assignee:** Jan Wloka

## Changelog

- The board's HTTP routes and the master agent ask one controller layer for fleet state instead of each reaching for the estate itself; mock adapters on the driven side let a mock board serve any controller.

<!-- Board impact: YES. Every route gains a controller between it and the work
     it does today. The payload does not change: the same values arrive by a
     different path. Rebuild the artifact on every branch. -->

## Motivation

> **Depends on [`2026-08-28-the-domain-runs-the-workflows-in-a-sandbox.md`](2026-08-28-the-domain-runs-the-workflows-in-a-sandbox.md)**
> for its driven ports and adapters. Those seven exist as of
> `feature/the-ports-have-adapters`; the rest of that plan is in flight.
>
> **This plan runs SECOND of three, before
> [`production-calls-the-domain-one-rule-at-a-time`](2026-08-28-production-calls-the-domain-one-rule-at-a-time.md).**
> Measured 2026-08-30: **26 of that plan's 51 spawn call sites are in the route
> handlers this plan rebuilds** — `board.ts` 4, `fleet.ts` 4, `idea.ts` 8, and
> six more. Repointing them at adapters before the controller exists means
> moving the same lines twice. **The layer comes before the callers are
> repointed**, so every call site is touched once.
>
> One plan at a time: fifteen slices across three plans sharing files cannot run
> concurrently without colliding.

**The driven side is built and the driving side is missing.** The seven ports
are all *world → domain*: `PlanStore`, `Refs`, `Host`, `Processes`, `Trees`,
`Clock`, `Machine`. Nothing yet answers the other question —
[Ports §3](../stories/the-master-agent-holds-the-fleet/DESIGN-ports.md#3-the-driving-ports-who-asks-the-domain)
calls it *who asks the domain*.

**Today the answer is: everyone, separately.** The board's 19 HTTP routes each
compose their own reading-plus-decision inline, and **6 skills invoke the scan
script directly, from 12 call sites** — `plot-reconcile` at three, four others
at two each. That scan costs **18.3 s**, 12.7 s of it in git alone, so a skill
that asks twice in one run pays 36.6 s for an estate that did not change in
between. Meanwhile the board holds the same answer in memory from its last
pulse.

> Corrected 2026-08-30 from "10 skills". The count came from `grep -l` across
> every skill file, which caught prose mentions as well as invocations. The
> figure that matters is not how many skills know the script's name — it is how
> often one run asks the same question, and that is 12.

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
third.

### The route translates and enriches; it does not decide

**Measured 2026-08-30, `/api/board` does not just call `buildBoard()`.** It
spreads six more things onto the payload: five `*Availability(HOST)` flags and
`serverInfo(opts, boundPort)`.

**`serverInfo` is transport knowledge and stays on the route.** It answers *which
port did this server bind, and how would you start it again* — facts a
controller called by the master agent does not have and would not want. So the
route is parse, call, **enrich**, serialise: the controller returns the core
answer, and each caller adds what only it knows.

**That is deliberately not a `Transport` port.** A port that exactly one caller
can ever populate is a parameter wearing a costume, and it would force the
master agent to pass an empty one forever.

### The availability flags are one question copied four times

**They are not what they look like.** All four distinct implementations —
`dispatchAvailability`, `continueAvailability`, `ideaAvailability`, and
`approveAvailability`, which merely calls the first — test the same condition:

```ts
if (host === 'localhost' || host === '127.0.0.1' || host === '::1')
```

**So today they answer a TRANSPORT question, not a lifecycle one**: *did this
request come from this machine?* That is the browser-origin check, four times.

**The question they are NAMED for does belong in the domain.** *May this action
run?* is a lifecycle rule of the same family as eligibility and the deliver
rule — and once a controller exists, the master agent will ask it too, where
`host` means nothing.

**So the slice splits them rather than moving them wholesale**: the domain
answers *may this action run given the plan's state*, the controller answers
*may this caller run it*, and the four copies of the origin check become one.
**Anything else would move a `localhost` comparison into a package whose purity
gate exists to keep exactly that out.**

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

**`PLOT_BOARD_MOCK` keeps working, and moves.** Today it is read *inside the
route* — measured 2026-08-30, `/api/board` carries
`mockRequested() ? { columns: mockCards() } : {}`, so the mock is a branch in
the request path. After this slice the variable is read **once, at server
start**, and decides which adapters get constructed. Everything that sets it
today keeps working; nothing above the adapters mentions it.

**That is a smaller change than replacing it, and it buys most of the same
thing.** The variable stays one global per process, so two *servers* still
cannot differ — but a test that constructs adapters directly bypasses it
entirely and holds exactly the estate it built. The env var becomes the
convenience path rather than the only one.

**What it does not fix, stated:** a test that forgets to unset the variable
still poisons its neighbours in the same process. That is the cost of keeping
the existing entry point, and it is accepted because breaking every current
caller to fix it would be a migration this slice is not.

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

`fleet-controls.ts` → `fleet-settings.ts`, tests and imports with it. Measured
2026-08-30: **31 mentions across 13 files** — 7 source, 6 test.

**It is its own slice because a pure rename is the one thing a reviewer can
check completely.** Nothing but names changes, so the review question is
"did anything else change?" and the diff answers it at a glance. Folded into
the Asking slice, the same diff would carry a rename *and* a new layer, and
neither could be read without the other.

**Done when** no module named `fleet-controls` remains, `pnpm test:board` passes
**unedited**, and the name `controllers/` is free for what follows. Tests
passing unedited is the assertion that carries this slice: a rename that needed
a test changed is not a rename.

### Asking (Branch: feature/one-controller-answers-the-board)

The first controller — fleet state, the question `/api/board` and `/api/fleet`
both serve — with `/api/board` reduced to parse-call-serialise.

**Done when** `/api/board` contains no estate access of its own, the controller
is callable from a test with **no server and no `host` argument**, the origin
check exists once rather than four times, and the board payload is unchanged
byte for byte.

**The payload assertion is what makes the rest safe.** Everything in this slice
is a move, so any difference in what the browser receives is a defect — and the
board is a surface somebody is watching while it lands.

### Mocking (Branch: feature/the-mock-is-an-adapter)

Mock adapters for `PlanStore` and `Refs`; the mock board constructs them.
`PLOT_BOARD_MOCK` keeps working and is implemented through them.

**Done when** a mock board serves the first controller with no controller code
mentioning the mock, and **a test that constructs adapters directly is
unaffected by `PLOT_BOARD_MOCK`** whatever its value.

**That is deliberately weaker than "two tests hold different estates at once",
which an earlier draft asserted and this plan cannot deliver.** The env var
stays one global per process, so two tests *relying on it* still cannot differ —
the Design section says so. What the slice does buy is an escape from it:
construct the adapters and the variable stops mattering. Asserting the stronger
claim would have shipped a done-when that fails on its own design.

### Asking again (Branch: feature/the-master-agent-asks-the-controller)

The master agent reaches the same controller — one entry point, callable
without HTTP, returning the same typed answer the route serialises.

**Done when** `plot-deliver`'s delivery-landed gate — which re-runs the scan
after applying a fix and repeats until its grep is empty — measures the estate
**once per unchanged estate**, and the answer is identical to the board's.

**Named rather than left general, because the recount above left one witness.**
"A skill that reads fleet state twice in one run" was written when the plan
believed five skills did; four of those turned out to be prose or a help block.
An assertion aimed at a population that does not exist passes vacuously — the
defect this repo has now found three times.

**The earlier wording — "without spawning `plot-fleet-scan.sh`" — was
unachievable as written.** The scan IS the adapter: it reads git, and a
controller beneath the skill still calls it. What changes is who calls it and
how often.

**Recounted 2026-08-30, and the 12 does not survive — the same counting error
one level down.** The plan already corrected *"10 skills"* to 12 call sites
because `grep -l` caught prose. The recount catches prose again: it moved from
counting FILES that name the script to counting LINES that name it, and neither
is *invokes*.

```
raw grep across skills/            25
lines in a SKILL.md                14
lines with a path prefix            5   ← plot-reconcile 3, plot-deliver 1, plot-release 1
```

`plot-deliver` had two of its three "call sites" in prose (lines 130 and 141
describe what the scan does; only 311 runs it). And **`plot-reconcile`'s three
are one invocation shown three ways** — a help block listing the full sweep,
`--no-fetch` and `--offline`, not three scans in a run:

```
../plot/scripts/plot-reconcile-scan.sh            # full sweep
../plot/scripts/plot-reconcile-scan.sh --no-fetch # skip the fetch
../plot/scripts/plot-reconcile-scan.sh --offline  # no network at all
```

**So "a skill that asks twice in one run" has exactly one witness**, and it is
not in the list: `plot-deliver`'s delivery-landed gate, which re-runs the scan
after applying a fix and repeats until the grep is empty. That is a real second
18.3 s, and it is conditional on drift rather than a property of every run.

**What this changes, and what it does not.** The Asking-again slice's assertion
must be restated against a case that exists — *the gate's second scan reads a
cached estate* — rather than against a per-run repetition that turned out to be
a documentation artefact. The plan's other motivation stands untouched: 19
routes each composing their own reading, two askers deriving the same fact,
26 of 51 spawn call sites sitting in the handlers this plan rebuilds. Those were
counted from source, not from prose.

**Worth stating as a rule, since this plan has now made the same mistake
twice:** a count of *how often something is invoked* cannot be taken with
`grep` over documentation. Three greps gave 25, 14 and 5 for one question.

**That is the assertion, because it is reproducible.** "Several skills in the
same window" depends on what an operator happens to run; "this skill asks twice
in one run" is a property of the skill and holds every time.

## Notes

**This plan does not migrate the 65 server-starting tests.** Measured
2026-08-30: 65 test files start an HTTP server to exercise logic — 42 in
`test/integration/`, 23 at the test root. Once controllers exist, most of that
is unnecessary, and rewriting them is a large, mechanical, separately reviewable
change. **It gets its own plan**, and this one states the risk of deferring it:
a controller layer whose tests still go through HTTP has paid for the seam
without collecting on it.

### How the master agent reaches the controller: a `node` entry point

**Settled 2026-08-30.** A skill runs `node` and gets its answer; no board need
be running.

**The alternative was an HTTP call to a live board**, which is faster when one
exists — the answer is already in memory from the last pulse — and answers
nothing when one does not. **Measured while deciding this: no board was
running.** Seven skills would have gained a dependency on a service that has
always been optional, and the failure would arrive as a skill that works on the
operator's machine and not in a worker's.

**The cost is stated: the `node` path re-derives what a running board already
computed.** It does not make anything slower than today — a skill pays the same
18.3 s it pays now — but it forgoes a saving that was available. **An HTTP fast
path can be added later without changing any caller**, because the entry point
is the seam: it can consult a board first and fall back. Adding it now would
mean two paths to the same answer before either is proven.

**The precedent is settled rather than proposed**: seven scripts already invoke
`node`, and `plot-sprint-candidates.sh` argues for it in its own comment —
*"node is already required to run the board and every test suite."*

### Why the slices run in this order

**Naming → Asking → Mocking → Asking again**, and only the middle pair could
plausibly swap.

- **Naming first** because it frees the word `controllers/` and touches nothing
  else; running it later would mean renaming files the other slices had just
  created.
- **Asking second** because it is the slice that proves the shape. Everything
  after it either serves a controller or calls one.
- **Mocking third** because a mock adapter needs a controller to serve. Written
  first it would be verified against nothing.
- **Asking again last** because its entry point returns whatever the controller
  returns, so the controller must be settled — including the enrichment split,
  which is what makes an answer meaningful without a `server`.

**They are not parallelisable in practice**, even though Mocking and Asking
again touch different files. Both consume the first controller's shape, and that
shape is what the Asking slice is discovering; running them alongside it would
have two branches building against a contract still being written.
