# A dispatch says what it started

> `POST /api/dispatch` returns 202 when the implement child has been **spawned** — no claim is pushed, no desk exists, and no worker runs. Every caller reads it as *work is running*. Measured 2026-09-27: four desks, **two live workers**; one carried `exit=124`, one had no `.plot-worker.log` at all, and the endpoint had answered success for both.

## Status

- **State:** Released
- **Approved:** 2026-09-29, jwloka, in-session
- **Started:** 2026-09-29, jwloka, `bug/a-dispatch-promises-a-worker`
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1027
- **Sprint:** plot-works-in-the-repos-that-adopt-it
- **Rounds:** 1
- **Delivered:** 2026-09-29
- **Released:** 2026-10-01, v2.22.0

## Changelog

- A dispatch's response names what it actually achieved, so a caller stops reading 202 as *work is running*. The worker's fate is read back, not promised.

Board impact: the dispatch response names its outcome. No scan change, and no row moves.

## Motivation

### What 202 actually means since #1018

`handleDispatch` ends at `dispatch.ts:471` with `json(202, { slug, log, implementLog })`. Traced backwards:

- `:407` — `startImplement(...)` spawns `/plot-implement` **detached** (`implement.ts:223-228`), and returns immediately.
- `:418` — inside that child's `exit` listener: `if (code !== 0) return;`
- `:448-451` — only after a **zero exit** does `recordActionReceipt` run and `plot-dispatch.sh` start. That script is what pushes the claim and creates the desk.

**So at 202 time `plot-dispatch.sh` has not been invoked at all.** A real `/plot-implement` takes minutes. The docblock at `:262-276` says so itself:

> This docblock read "the implement step is SYNCHRONOUS: the 202 is written only after it completes successfully". **It no longer is, and the 202 no longer means the brief exists.** … So the 202 now means **the implement was started**.

`a-dispatch-does-not-hold-the-loop` shipped this as **#1018** (`f1c81383`, delivered `a5113e41`), hours before this plan was first drafted.

**This makes the complaint worse, not weaker.** 202 once meant *a claim exists*; it now means only *a child was spawned*. A caller reading it as *work is running* is wrong in strictly more cases than the first draft measured.

### Why the three outcomes cannot be answered in the response

An earlier draft asked the endpoint to answer one of `started` / `queued` / `claimed only`. **Every one is a fact about a world that does not exist when the response is written:**

- **`started`** — the worker is started by `plot-dispatch.sh`, in a listener minutes later. Verifying it at response time means awaiting the implement, which is exactly and only what #1018 removed. The plan's own *"does NOT do"* list forbids that. **The first draft therefore forbade the one thing that would let it keep its main promise** — an internal contradiction, not a detail.
- **`claimed only`** — at 202 time no claim exists, so this cannot be distinguished from anything.
- **`queued` / `no-headroom`** — produced at `rules/supervision.ts:205` from a **machine** reading, at the tick that considers the desk. The desk does not exist yet, and a headroom reading taken now would go stale before `plot-dispatch.sh` starts.

### The fleet handles both, and that is not visible

Measured afterwards: of two desks that looked stuck, the fleet had **already restarted one** — running 20 minutes, predating the operator's attempt by sixteen — and **deferred the other on the machine bound**. Neither needed a person, and nothing in the 202, or after it, said so.

### What the ambiguity cost

`.plot/state/unowned-action-writes.tsv` holds 24 rows, all `dispatch`. **18 of them name a blocked `/api/dispatch` event loop** — the condition #1018 fixed — and one names `--restart has no controller endpoint`. The ledger is consistent with the endpoint being unusable, and does not isolate the cost of its response being ambiguous.

### An earlier framing of this issue was wrong

The issue originally claimed *"no controller verb can recover a desk that did not start."* **False**, and corrected on the issue: the fleet had restarted one desk and correctly deferred the other. This plan adds no `restart` verb.

## Design

### The rule

**The response names what it achieved, and the worker's fate is read back rather than promised.**

Two halves, and only the first is in this plan's scope:

1. **The response stops being success-shaped for an outcome it cannot know.** The 202 body names the act it performed — the implement was started — so a caller cannot read it as *work is running*. This is buildable at response time, costs nothing, and addresses the measured complaint directly.
2. **The three outcomes live on the read-back.** `GET /api/implement/<slug>` already exists and already reports `running` / `failed` with the log's last lines — #1018 built it as *"the refusal's first working route to a person."* A worker's fate belongs there, or on the row, where the fact is knowable when it is true.

### The code already reached this conclusion

`dispatch.ts:464-470`, on the dispatch script:

> So the response CANNOT carry a result: the script's summary line only exists once the run has finished. That is not a gap to paper over — it is the same shape as `start_worker`'s own detached spawn, and **it is why the row moving is the answer rather than the reply being one**.

**This plan adopts that paragraph rather than arguing against it.** A slice that wants the response to carry a worker outcome must first refute it.

### What this leaves to #1030

Whether a deferred desk's row shows the reason is `a-desk-says-who-owes-it`'s question, and the measurement there found no misplaced row to fix. **That makes #1030 the primary route by which an operator learns a desk is queued**, and this plan deliberately does not duplicate it.

**It is worth stating plainly**: once the response is honest and the row carries the cause, what remains of this plan may be a field on #1030 rather than a plan of its own. The slice should check that before building.

### What this does NOT do

- **It does not block on a worker starting.** #1018 shipped precisely so the endpoint stops holding the event loop.
- **It does not add a `started` field to the response.** The fact is not knowable there.
- **It does not add a controller verb.** No `restart`, no `release`.
- **It does not change the row.** That is #1030.

## Done when

- The 202 body names the act performed, and no field in it can be read as *a worker is running*.
- A test asserts the response shape against a stubbed implement that has not yet exited.
- The plan's own claim about `GET /api/implement/<slug>` is verified against the shipped endpoint before anything is added to it.
- The slice records whether what remains belongs here or on #1030, and stops if it is the latter.

## Slices

### A dispatch says what it started (Branch: bug/a-dispatch-promises-a-worker, PR: #1076)

The three outcomes, verification without blocking, and the #1030 boundary settled first.

## Notes

The measurement that produced this issue also refuted half of it, within twenty minutes. The remaining half is narrow and real: **an endpoint that returns success for three different outcomes teaches its callers to guess**, and fifteen hand-interventions in one session is what guessing looks like.

**Amended after round 1 (2026-09-27).** The evidence lens committed `amend` having executed, and its central finding was that **this plan was written against an endpoint that changed hours earlier**: #1018 made the implement detached, so the 202 no longer means a claim exists. Three changes followed:

- The premise was corrected. No claim is pushed and no desk exists at 202; it means an implement child was spawned.
- The three response outcomes were dropped. Each is a fact about a world that does not exist when the response is written, and `started` in particular could only be answered by re-introducing the blocking #1018 removed — which this plan's own scope list forbids.
- The answer was relocated to the read-back, adopting `dispatch.ts:464-470`'s existing argument rather than arguing against it. What survives is one small honest fix to the response body, plus an explicit check that the remainder is not simply #1030.

The branch name is kept as filed so the issue and the ref still match, though the title changed.

Verdict and full reading: `.plot/panels/2026-09-27-a-dispatch-promises-a-worker/evidence.md`.
