# A connector declares its ceiling

> The cadence rule stretches polling against observed spend alone, because the ceiling every connector already reports reaches the concurrency bound and never the cadence.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** plot-gates
- **Review:** in-session
- **Impl:** own branches

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
