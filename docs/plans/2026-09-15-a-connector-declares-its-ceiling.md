# A connector declares its ceiling

> The cadence rule stretches polling against observed spend alone, because the ceiling every connector already reports reaches the concurrency bound and never the cadence.

## Status

- **State:** Rejected
- **Type:** feature
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** plot-gates
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2
- **Rejected:** 2026-09-15, jwloka, the cadence is already clamped; the output cannot move

## Changelog

- The board's polling cadence reads the rate ceiling its connectors already report. The ceiling reached the concurrency bound and never `refreshIntervalMs`, so cadence stretched on observed spend alone.

<!-- Board impact: the board reads a new optional config key and passes a
     ceiling into an existing rule. No plan format, no template, no layout. -->

## Design

**The throttle is built, wired and working — and it is blind in one direction.**
That is the finding, and it is narrower than *"the board polls too hard"*.

`prRefreshMsFor(backend, rate, currentMs)` at `fleet.ts:1724` is called at both
refresh sites with a real backend. Cost per refresh varies per connector through
`PR_REQUESTS_PER_REFRESH`. The rate comes from `plot-host.sh spend-rate`, which
reads a local append-only file and **asks no host** — consulting the throttle is
free. Bitbucket already stretches independently of GitHub.

### What it cannot see

`refreshIntervalMs` (`cadence.ts:244`) takes exactly four things: the base
interval, the cost per refresh, a `rate` — and the rate is
`Pick<SpendRate, 'perHour'>`. **One field. No ceiling.** That reading is correct
and it is the whole gap.

### The ceiling is ALREADY REPORTED, and already consumed — by something else

**This section replaces a false one.** An earlier draft of this plan claimed the
record could not state a limit, and quoted a `spend-rate` line showing
`limit: null, basis: unknown`. Re-measured live:

```json
{"connector":"github","account":"jwloka","spent":1083,"perHour":1085.72,
 "limit":5000,"remaining":3229,"resetAt":1789468250000,"basis":"actual"}
```

**`limit: 5000`, `basis: actual`.** And the other two connectors declare one too,
in the shell rather than from a header — `plot-host.sh:1984` answers
`bitbucket → 1000 predicted`, and Jenkins `60 predicted`. So the claim that only
GitHub reports a limit was false for all three.

**The ceiling already has a consumer.** `limitReadingOf` (`fleet.ts:1619`) shapes
`prLimit`/`prResetAt`/`prLimitBasis` into a `LimitReading`; `boundFromLimit`
(`concurrency.ts:139`) turns an hourly ceiling into a **simultaneous-call bound**;
`withHostSlot` enforces it around every host call (`fleet.ts:2476`).

**So the board is not blind to the ceiling. It reads it and spends it on
concurrency.** The gap is exactly one sentence wide:

> **The cadence does not read the ceiling the concurrency bound already reads.**

### The three bases are not interchangeable

| basis | meaning | source |
|---|---|---|
| `actual` | the vendor said so | response headers (GitHub) |
| `predicted` | the adapter's own number from experience | `plot-host.sh:1984` |
| `unknown` | a call was spent and nothing is visible | the honest dead end |

A declared value is a **fourth** basis and must rank against these rather than
replace them: `actual` wins, then a declared value, then `predicted`. A
declaration overriding a vendor-reported limit would let a typo outrank a
measurement.

### Why a declaration and not a probe

**A probe spends the budget it is protecting.** Asking Bitbucket for its own rate
limit is a request against that limit, on a connector whose scarcity is the
problem. The whole reason `spend-rate` reads a file is to decide without
spending.

**And the ceiling is an account property, not a repository one.** Two
repositories sharing one Bitbucket account share its window — which is precisely
what `BudgetKey`'s `account` field already models, and why the declaration is
keyed by connector and account rather than baked into a table.

### What this does not do

**It does not change the stretch policy.** `MAX_CADENCE_STRETCH = 8` and
`CADENCE_DAMPING = 0.25` are reasoned through in `cadence.ts` and stay. This
gives the existing rule a second input; how it weighs that input is the rule's.

**It does not refuse a call.** A board that stops asking has stopped spending,
which `cadence.ts:15` names as the loop that makes an unbounded stretch a trap.
A ceiling makes the stretch better informed; it never becomes a gate.

**It does not touch the concurrency bound.** `boundFromLimit` reads the same
ceiling and converts it to a simultaneous-call cap. A ceiling arriving through a
new path must not move that number — a declared `1000` proposes
`floor(1000/900) = 1`, which is `MIN_CONCURRENCY` and would serialise every call
on that connector. **That is a regression this plan must pin against, not a
benefit.**

**It does not read the ceiling with a new host call.** `cadence.ts:9-31` warns
that reacting to an error here *"would compound with the division already
happening and drift the cadence down with nothing to bring it back."* The
ceiling comes from the reading already taken.

**It hardcodes no vendor's number.** `limit: 60` for Jenkins is a default in the
shell today; whether that matches a given instance is a question only its
operator can answer, which is the argument for declaring it.

## Slices

### A connector declares its ceiling (Branch: feature/a-connector-declares-its-ceiling)

- `feature/a-connector-declares-its-ceiling` — read an optional per-connector rate ceiling from `## Plot Config`, prefer a vendor-reported limit where one exists, and pass it into `refreshIntervalMs` beside the observed rate

**Done when** the ceiling already in the spend-rate reading reaches
`refreshIntervalMs`; **an interval ACTUALLY MOVES** — a connector near its
ceiling polls measurably slower than the same connector far from it, pinned by
a test asserting two different numbers, since every other gate here can be met
by plumbing a value through and ignoring it; the precedence is `actual`, then
declared, then `predicted`, pinned per basis; a connector with no ceiling at all
produces an interval **byte-identical** to today's, pinned across gh, bb and
jen; **the concurrency bound `boundFromLimit` returns is unchanged for every one
of those inputs**, pinned by a test, because it reads the same ceiling and
`floor(1000/900)` is `MIN_CONCURRENCY`; the interval **converges** rather than
oscillating, pinned by iterating the rule to a fixed point; the board says when
it is at `MAX_CADENCE_STRETCH` rather than silently exceeding a ceiling it
cannot honour; no new host call is made, checked by asserting the spend-rate
path still asks no host; `MAX_CADENCE_STRETCH` and `CADENCE_DAMPING` are
unchanged; and `pnpm run test:contracts` and the board suite pass.

## Notes

**Drafted after measuring, and the measurement replaced the plan.** The first
shape of this was *"wire `cadence.ts` into the PR refresh, keyed by connector"* —
which would have re-implemented `prRefreshMsFor`, working code called at both
refresh sites since before this was written. What is actually missing is one
input to a rule that already runs.

**The operator's report was `bb` polling too hard**, and it remains the one
claim behind this plan that no artefact on this estate records. This repository
is on GitHub, so no Bitbucket cadence is observable here.

**Amended 2026-09-15 after a three-lens panel** (`.plot/panels/2026-09-15-a-connector-declares-its-ceiling/`),
which found the original Design's headline measurement and subtitle false: the
record does state a limit, all three connectors report one, and the ceiling
already has a consumer in `boundFromLimit`. The plan's central code reading —
`refreshIntervalMs` takes one rate field and no ceiling — was correct and
survives, which is why this was amended rather than rejected.

**A likelier root cause is named and not adopted.** `plot-budget.sh:281-283`
drops the limit whenever the newest line's basis is `unknown`, so the ceiling may
never reach the op the board asks. If that is the whole defect it is a plumbing
fix inside one script and this plan is unnecessary. **The reading that decides
it** is `plot-host.sh spend-rate` on the repository whose board polls too hard.

## Why this was rejected

**Two three-lens panels, then a decision panel. Rejected on arithmetic rather
than on judgement.** Full record in
`.plot/panels/2026-09-15-a-connector-declares-its-ceiling/`.

### The cadence is already clamped on every live connector

`targetStretch` returns `MAX_CADENCE_STRETCH` the moment `others >= share`
(`cadence.ts:139`), and `MAX_CADENCE_STRETCH = 8` (`:32`). The share is taken at
the **unstretched** cadence (`:131`), so it is 60/hr on both hosts and **any
account above roughly 120/hr is pinned at 8x**.

Measured 2026-09-15: **Bitbucket 721/hr, GitHub 268/hr** — 6x and 2.2x past the
clamp. The Bitbucket board refreshes **once every 32 minutes.**

**So a ceiling input cannot move the number.** It can only ever say *slow down
further*, which the clamp already refuses. Ship the wiring and the board
refreshes every 32 minutes the day before and the day after — **zero observable
change on this plan's only named beneficiary.**

### The board is not the spender

**The board contributes 7.5 requests an hour — 0.75% of Bitbucket's spend**, while
the account burns 721/hr. This plan touches none of the other 99.25%, because it
refuses no call: *"It does not refuse a call"*, its own words.

**The operator's report was real and this plan was never aimed at it.** The
traffic is eleven scripts, dispatched workers and a person at a terminal — the
population `cadence.ts:150-153` says the record exists to capture.

### No connector needs the declaration

Unanimous across two panels, and **no juror ever chose to ship the config key**.
Bitbucket already answers `1000 predicted` (`plot-host.sh:1984`) on 100% of its
lines; Jenkins has **no arm** in `budget_reading` and reads `perHour: null`
across 8,324 lines, so its cadence never consults a ceiling; GitHub reports
`actual` on **42 of 73,097 lines — 0.057%** — and the field self-evicts hourly.

### The headline measurement was overturned twice, in opposite directions

The original plan quoted `limit: null`; round 1 called it false and the
amendment replaced it with `limit: 5000, basis: actual`; round 2 found **six
consecutive live runs** returning `limit: null` again. **Both readings were true
when taken.** A reading announces the reset window that then evicts it, so a
single sample of this field is never a standing fact — and three of this plan's
versions rested on one.

### What survives, and where it goes

**The code reading is correct and worth keeping:** `refreshIntervalMs`
(`cadence.ts:244`) takes `Pick<SpendRate,'perHour'>` and no ceiling. It is a real
gap with **no consequence** while the cadence is clamped.

**Three candidates that would move an observable number**, none of them this plan:

1. **`MAX_CADENCE_STRETCH = 8` is where every connector sits.** The board is
   clamped, not tuned; revisiting the constant is the only change that alters its
   cadence today.
2. **Attribute the 721/hr to its real spenders.** The board is 0.75% of it, and
   the ledger already carries per-caller lines.
3. **A second Bitbucket account, `plot-pm`, runs at 2030/hr — 203% of its own
   declared ceiling**, and nothing watches it. Found by a juror; nobody had named
   it.

**Nothing was implemented.** No branch, no PR, no `Started:` record.
