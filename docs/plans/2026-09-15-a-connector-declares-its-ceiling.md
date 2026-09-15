# A connector declares its ceiling

> The board stretches its polling against what others are spending and never against what the account is allowed, because no connector but GitHub reports a limit.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** plot-gates
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A connector's rate ceiling can be declared in config, so the board's polling backs off against the budget it actually has. Bitbucket and Jenkins report no limit headers, so until now their cadence was tuned only by observed spend.

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
`Pick<SpendRate, 'perHour'>`. **One field. No ceiling.**

So the cadence answers *"how much is everyone else spending?"* and stretches to
share fairly, bounded at `MAX_CADENCE_STRETCH = 8`. It never answers *"how close
am I to the wall?"*

Measured live on this estate, 2026-09-15:

```json
{"connector":"github","perHour":157.09,"limit":null,"remaining":null,"basis":"unknown"}
```

**157 calls an hour against a limit the record cannot state.** For GitHub that is
harmless — the real ceiling is 5000/hour and a fair-share stretch is the right
policy well below it. For the connectors that hurt it is not.

### The three connectors differ, and only one can self-report

`plot-host.sh` records a budget line per call for all four backends, and
`BudgetKeySchema` is keyed `connector` / `account` / `bucket` — built for exactly
this. But the reading depends on the vendor answering:

| connector | limit headers | today's record |
|---|---|---|
| GitHub | yes | real `limit`/`remaining`/`reset` |
| Bitbucket | no | rate only |
| Jenkins | no | `limit: 60` hardcoded at `plot-host.sh:3760` |

`plot-host.sh:1648` makes the Jira case explicit: it appends `- - -` with basis
**`unknown`** — *a call was spent and we cannot see what remains*. That is honest
and it is a dead end for tuning.

**So the ceiling is declared rather than discovered.** A config key per connector,
read where the rate is read, passed into the same rule. A connector that reports
a real limit keeps using it; one that cannot falls back to the declared value;
one with neither behaves exactly as today.

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

**It hardcodes no vendor's number.** `limit: 60` for Jenkins is a default in the
shell today; whether that matches a given instance is a question only its
operator can answer, which is the argument for declaring it.

## Slices

### A connector declares its ceiling (Branch: feature/a-connector-declares-its-ceiling)

- `feature/a-connector-declares-its-ceiling` — read an optional per-connector rate ceiling from `## Plot Config`, prefer a vendor-reported limit where one exists, and pass it into `refreshIntervalMs` beside the observed rate

**Done when** a declared ceiling reaches `refreshIntervalMs`; a connector
reporting a real limit prefers it over the declared one; a connector with
neither produces an interval **byte-identical** to today's, pinned by a test
across gh, bb and jen; the ceiling is keyed by connector and account rather than
connector alone; no new host call is made to discover a limit, checked by
asserting the spend-rate path still asks no host; `MAX_CADENCE_STRETCH` and
`CADENCE_DAMPING` are unchanged; and `pnpm run test:contracts` and the board
suite pass.

## Notes

**Drafted after measuring, and the measurement replaced the plan.** The first
shape of this was *"wire `cadence.ts` into the PR refresh, keyed by connector"* —
which would have re-implemented `prRefreshMsFor`, working code called at both
refresh sites since before this was written. What is actually missing is one
input to a rule that already runs.

**The operator's report was `bb` polling too hard.** GitHub at 157/hour against
5000 is comfortable; Bitbucket's window is tighter and its limit unreportable, so
a fair-share stretch against observed spend is the only signal the board has
there today.
