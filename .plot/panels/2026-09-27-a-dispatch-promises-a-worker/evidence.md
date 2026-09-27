# Evidence lens — a dispatch promises a worker

Position: amend
Evidence: executed

## The plan's own opening sentence is false as of yesterday

> *"`POST /api/dispatch` returns 202 when a claim is pushed and a desk exists."*

**No claim is pushed and no desk exists when the 202 is written.** I read `dispatch.ts` end to end (472 lines) and traced the ordering:

- `dispatch.ts:471` — `json(202, { slug, log, implementLog: implLog })` is the LAST statement of `handleDispatch`.
- `dispatch.ts:407` — `startImplement(...)` spawns `/plot-implement` **detached** (`implement.ts:223-228`, `detached: true`) and returns immediately.
- `dispatch.ts:418` — inside that child's `exit` listener: `if (code !== 0) return;`
- `dispatch.ts:448-451` — only after a zero exit does `recordActionReceipt` + `scriptsFor(opts).start(DISPATCH_SCRIPT, ...)` run. `plot-dispatch.sh` is what pushes the claim and creates the desk.

So at 202 time `plot-dispatch.sh` **has not been invoked at all**. A real `/plot-implement` takes minutes. The 202 means *the implement child was spawned* — nothing more. The docblock says so itself (`:262-276`):

> *"This docblock read 'the implement step is SYNCHRONOUS: the 202 is written only after it completes successfully'. **It no longer is, and the 202 no longer means the brief exists.** ... So the 202 now means **the implement was started**."*

`git log origin/main` confirms `a-dispatch-does-not-hold-the-loop` shipped as **#1018** (`f1c81383`), delivered (`a5113e41`), touching `dispatch.ts` by +209/-... lines.

**This does not refute the plan's complaint — it makes it worse, and makes the proposed remedy unbuildable as written.**

## Why the three proposed outcomes cannot be answered at 202 time

The plan asks the endpoint to answer one of `started` / `queued` / `claimed only`. Every one of them is a fact about a world that does not exist yet when the response is written:

- **`started`** — "a worker is running, verified rather than assumed." The worker is started by `plot-dispatch.sh`, which runs in a listener *minutes later*, after a detached implement exits 0. To verify a worker at response time the handler would have to await the implement — which is exactly and only what #1018 removed. The plan's own "does NOT do" list forbids this: *"It does not block on a worker starting. `a-dispatch-does-not-hold-the-loop` shipped precisely so the endpoint stops holding the event loop."* **The plan forbids the one thing that would let it keep its main promise.** That is an internal contradiction, not a detail.
- **`claimed only`** — a claim exists and nothing is coming. At 202 time no claim exists, so this cannot be distinguished from anything.
- **`queued` / `no-headroom`** — I traced this. `no-headroom` is produced at `packages/domain/src/rules/supervision.ts:205` (`if (readings.headroom !== 'clear') return 'no-headroom'`), reached from the supervisor's tick, and `headroom` is a **machine reading** (`machine-system.ts:40`: *"the headroom verdict is deliberately not computed here"*; `fleet-size.ts`/`assign.ts` consume it). It is a fact about the machine **at the tick that considers the desk** — and the desk does not exist yet. A headroom reading taken at 202 time would be a reading about a moment the assignment is not made in, and would go stale before `plot-dispatch.sh` even starts. (Note: the plan cites `supervision.ts:130`; the causes union is at `:139` in `rules/supervision.ts`, not a workflow. Minor, but the line reference does not resolve.)

So all three outcomes are answers the *endpoint* structurally cannot give. The plan half-senses this — *"whether the dispatch waits a tick or reports pending and lets the row carry the cause is the slice's design question"* — but that sentence is doing the load-bearing work of the entire design, and the only two options it names are the one #1018 forbids and the one that belongs to #1030.

## What survives, and it is real

The complaint underneath is sound and I verified its cost:

```
$ wc -l < .plot/state/unowned-action-writes.tsv
24
$ grep -c dispatch .plot/state/unowned-action-writes.tsv
24
```

24 of 24 escapes are `dispatch`. The plan's Notes are right: *"an endpoint that returns success for three different outcomes teaches its callers to guess."* Since #1018 it is worse than three — 202 now means only *a child was spawned*, and a caller reading it as *work is running* is wrong in strictly more cases than the plan measured.

The plan is also commendably honest where its own issue was wrong (*"An earlier framing of this issue was wrong ... False, and corrected on the issue"*), and correctly declines to add a `restart` verb.

## The amendment

Rewrite the Motivation and Design against the post-#1018 code, because the plan is written against an endpoint that no longer exists:

1. **Correct the opening claim.** A claim is not pushed and a desk does not exist at 202. State what 202 means now: an implement child was spawned.
2. **Drop `started` as a response field, or drop "does not block".** These cannot both hold. The honest shape is that the *response* cannot carry a worker outcome at all — the same conclusion `dispatch.ts:464-470` already reaches for the dispatch script: *"the response CANNOT carry a result: the script's summary line only exists once the run has finished. That is not a gap to paper over ... it is why the row moving is the answer rather than the reply being one."* The plan should either argue against that paragraph or adopt it.
3. **Relocate the promise to the read-back.** `GET /api/implement/<slug>` already exists and already reports `running`/`failed` with the log's last lines; #1018 built it precisely as *"the refusal's first working route to a person."* Three outcomes belong there, or on the row, where the fact is knowable when it is true. That makes the #1030 boundary the plan defers (*"the slice states the boundary with that plan before building"*) the **primary** design question rather than a footnote — and quite possibly makes this plan a field on #1030 rather than a plan of its own.
4. **Fix the response's honesty separately and cheaply.** One thing IS buildable at 202 time and worth doing: stop calling it success-shaped. The 202 body could name what it actually achieved (`implement-started`) so a caller cannot read it as *work is running*. That is a small, real, non-blocking fix and it addresses the measured cost directly.

## Why amend and not reject

The defect is measured, the cost is measured, and the author already corrected one false claim on this issue in public. What is wrong is that the plan was written against yesterday's endpoint — its sibling landed hours earlier and moved the ground under it. The Done-when list is testable and the scope discipline is good. Rewrite the premise and relocate the answer; do not build the three outcomes into the response.

## Position

Position: amend
