# A dispatch promises a worker

> `POST /api/dispatch` returns 202 when a claim is pushed and a desk exists, which is a weaker promise than every caller reads it as. Measured 2026-09-27: four desks, **two live workers**. One carried `exit=124`; one had no `.plot-worker.log` at all. The endpoint had answered success for both.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1027
- **Sprint:** plot-works-in-the-repos-that-adopt-it
- **Rounds:** 0

## Changelog

- A dispatch says whether a worker started, and where it did not, whether the fleet will start one. A caller stops reading 202 as *work is running*.

Board impact: the dispatch response gains a field the row can render. No scan change.

## Motivation

### What 202 means today

A claim ref pushed and a desk created. **Not** that a worker runs.

Measured 2026-09-27, minutes after three dispatches each returned success:

```
infra/a-decision-reads-rather-than-asks    LIVE 89424
docs/the-rule-is-written-down              LIVE 56390
bug/a-claim-is-released-not-deleted        dead/73177     ← stale pid, exit=124
infra/a-brief-is-named-by-the-rule         dead/none      ← no log, never started
```

### The fleet handles both, and that is not visible

Twenty minutes later: the `exit=124` desk **had been restarted by the fleet** — a new worker running 20 minutes, predating the operator's own `--restart` by sixteen. The never-started desk was **deferred on the machine bound**:

```
plot-registryd tick agents=3 ... defer=1
  : defer (no-headroom)
```

**Neither needed a person.** But the dispatch response said nothing, so the operator could not know.

### What the ambiguity cost

**24 unowned-action escapes in `.plot/state/unowned-action-writes.tsv`, all `dispatch`. 15 of them in one session** — eleven claim refs cleared by hand and four `--restart` calls made directly against the script, on a machine where the board was answering.

An unknown share were desks the fleet would have served.

### An earlier framing of this issue was wrong

#1027 was filed claiming *"no controller verb can recover one that did not start."* **False, and corrected on the issue**: the fleet recovers a died worker and defers a never-started one legitimately.

**What survives is the promise, not the recovery.** A caller told 202 reasonably concludes work is running, and that conclusion is unsupported.

## Design

### The rule

**A dispatch answers what it actually achieved**, in three outcomes:

- **started** — a worker is running, verified rather than assumed
- **queued** — no worker yet, and the fleet will start one, with the reason (`no-headroom`)
- **claimed only** — a desk and a claim exist and nothing is coming; this asks a person

The third is the only one a caller must act on, and today all three answer 202.

### Verification, not assumption

`plot-boardctl.sh --start` already sets the precedent: *"the server reports a busy port and exits 0, so the exit code answers a different question"* — so it **fetches `/api/board`** and reports the checkout it serves.

A dispatch should prove the worker the same way rather than infer it from a spawn returning.

### Where the queued answer comes from

The supervisor computes it every tick — `supervision.ts:130` types nine causes including `no-headroom`. **This plan does not recompute it**; whether the dispatch waits a tick or reports *pending* and lets the row carry the cause is the slice's design question, and it overlaps `a-desk-says-who-owes-it` (#1030).

**The slice states the boundary with that plan before building.** Two plans writing one field is the collision to avoid.

### What this does NOT do

- **It does not add a `restart` verb.** Whether the controller should expose one is a separate question this plan's measurement no longer supports — the fleet restarts died workers itself.
- **It does not change what the fleet recovers.**
- **It does not block on a worker starting.** `a-dispatch-does-not-hold-the-loop` shipped precisely so the endpoint stops holding the event loop; verification must not reintroduce that.

## Done when

- A dispatch that starts a worker says `started`, verified.
- A dispatch deferred on headroom says `queued` with the reason.
- A dispatch that leaves a claim with nothing coming says so, distinctly.
- The endpoint does not block the event loop while verifying.
- The boundary with #1030 is stated: which component owns the cause, and who renders it.

## Slices

### A dispatch promises a worker (Branch: `bug/a-dispatch-promises-a-worker`)

The three outcomes, verification without blocking, and the #1030 boundary settled first.

## Notes

The measurement that produced this issue also refuted half of it, within twenty minutes. The remaining half is narrow and real: **an endpoint that returns success for three different outcomes teaches its callers to guess**, and fifteen hand-interventions in one session is what guessing looks like.
