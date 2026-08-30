# The board decides nothing

> Every verdict, phase and pulse derivation is a domain function; the board renders and routes.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-domain-is-one-implementation
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

The verdicts, phases and pulse derivations the board computes become domain
functions. The board keeps the fetching, the caching and the rendering.

## Motivation

### The operator's statement, 2026-08-30

> *We need to make sure the board is using the domain and that **all decision
> making, all stage changes, all updates, even the pulse** happens in the domain,
> and the board is simply the view of things, or the controller.*

### The domain knows the pulse's SHAPE and none of its meaning

`packages/domain/src/entities/fleet.ts` exports `FleetPulseSchema` and
`FleetPulse` — a Zod schema and a type. **Everything that happens to a pulse
lives in the board:**

```
fleet.ts   5953 lines, 49 exports
board.ts   1979 lines, 15 exports
```

Their names are the argument. Among the 49: `startabilityVerdict`,
`waveVerdict`, `rowPhase`, `prGateOpen`, `waitingOnFor`, `prAsksNobody`,
`pulseShrink`, `deriveWaves`, `doubleClaimedBranches`.

**Those are judgements.** A verdict is a rule about a Slice; a phase is a rule
about a Plan; *who is waiting on whom* is a rule about an Agent. None of them is
a rendering concern, and all of them are in the view layer.

### What the existing plans do and do not cover

| plan | covers | leaves |
|---|---|---|
| `production-calls` | rules that exist **twice** — deliver, eligibility, refusals | rules that exist **only** in the board |
| `the-controller-answers-every-asker` | who is **asked**, and by what path | what the answer is **computed from** |
| `the-sprint-proves-its-own-goal` | reaching the world outside `adapters/` | logic that reaches nothing and still decides |

**The gap is the third row of each.** `production-calls` is a de-duplication —
its unit is *a rule found in two places*. A verdict written once, in the board,
is not duplicated and so is not its subject. The layering gate cannot see it
either: computing `waveVerdict` in TypeScript spawns nothing, writes nothing and
fetches nothing.

**So this is the condition with no owner**, and the plans say so themselves:
*"There is no domain-specific code or behaviour that is not implemented by the
domain"* is stated in `CLAUDE.md` and enforced by nothing.

### The pulse is the master clock, and it is not the board's

**Corrected 2026-08-30 by the operator**, and it changes what this plan asks
for:

> *The pulse is a core domain concept, which basically is the **master clock**
> in our system. This cannot be part of the board. This thing runs on a machine.*

**A first draft of this plan treated the pulse as a data structure** the board
derives things from, and left the fetching cadence with the board as
"machinery". That is wrong in the same way calling `waveVerdict` a rendering
concern would be. **A clock is not machinery — it is the thing every other
component reads to know when it is.**

**Measured 2026-08-30, and no spec covers it:** the domain exports
`FleetPulseSchema` and `FleetPulse` — a shape and a type. The beat itself is
`setInterval` in `fleet.ts:2447` and `:2452`, and **no DESIGN document in the
story mentions the pulse as a cadence at all.** It is a load-bearing concept
nobody wrote down.

**What follows for the design.** The derivations move because they are
judgements. But the *pulse itself* — when it beats, what a beat means, what it
is a reading OF — is an entity question, and this plan is not the place to
settle it. It belongs beside `Machine` in `DESIGN-*.md`: **a pulse runs on a
machine, like a worker does.**

**So this plan moves the derivations and names the gap** rather than filling it.
Cutting a clock out of the board is a bigger change than moving three verdicts,
and doing both in one plan would hide the second inside the first.

### Why the derivations in particular

Every derivation over a pulse is a statement about Slices, Agents and Plans.
`deriveWaves` groups slices into cohorts; `doubleClaimedBranches` finds a
conflict between two plans. **A board that computes those is not a view.**

## Design

### The unit is a verdict, not a file

`fleet.ts` is 5953 lines and cannot move at once — that is the shape of change
this story exists to avoid. **Each slice takes one named verdict**, moves it to
`packages/domain/src/rules/`, and leaves the board calling it.

**The board keeps three things** *in this plan*, and the first is provisional:

- **fetching** — the scan, the host, the caches, the timers. **Provisional,
  because the operator has since called the pulse the system's master clock**;
  the cadence stays with the board here only because moving a clock is its own
  plan (see above), not because the board owns it
- **caching and rate limiting** — `prGateOpen`, `prNextDueAt`,
  `rateLimitBackoffMs` are policies about a *service*, not about a Slice.
  **Provisional too:** if the PR poller becomes a domain monitor calling an
  adapter (`two-monitors-watch-the-agent` § *Watching the build*), the policy
  may follow it. This plan draws the line; that slice should not redraw it
  alone
- **rendering** — every `.tsx`, and the payload assembly that feeds it

### How to tell a verdict from a policy

**A verdict answers a question about a domain entity.** *Is this slice
startable? What phase is this plan in? Which agent is waiting on whom?*

**A policy answers a question about the machinery.** *May I ask the host again
yet? How long should I back off? What may I drop from an oversized payload?*

The first belongs to the domain. The second belongs where the machinery is.
**`pulseShrink` is the hard case** and is named here so it is argued rather than
assumed: dropping fields from a payload is a transport decision, but *which*
fields may be dropped without lying is a statement about what a Slice means.

### The order is by dependency, not by size

A verdict that another verdict calls moves first, or the mover has to leave a
call reaching backwards across the seam.

### Not chosen: move `fleet.ts` wholesale

5953 lines in one branch is the failure this story is named for. Measured
2026-08-30: seven workers hit their bound in one day on slices a tenth that
size.

### Not chosen: wait for `production-calls`

They do not collide. That plan repoints callers at rules that already exist in
two places; this one creates rules that exist in one place — the wrong one.
**The overlap is `deliver`, and it is already moved.**

## Slices

### Verdicts (Branch: feature/a-verdict-is-a-domain-rule)

`startabilityVerdict` and `waveVerdict` become domain rules; the board calls
them.

**Done when** both are in `packages/domain/src/rules/`, unit-tested there at the
package's threshold; `fleet.ts` holds no copy; and **the board payload is
unchanged byte for byte** — everything here is a move, so any difference is a
defect.

### Phases (Branch: feature/a-phase-is-a-domain-rule)

`rowPhase` and the plan-status derivations follow.

**Done when** the same three conditions hold, and **a phase asked of the domain
gives the same answer the board gave** for every plan in `docs/plans/` — asserted
against the real estate, not a fixture.

### The pulse (Branch: feature/the-pulse-derives-in-the-domain)

`deriveWaves` and `doubleClaimedBranches` move. `pulseShrink` is **argued in the
PR** and moved only if the argument holds.

**Done when** the two derivations are domain functions with the board calling
them; the pulse contract is unchanged; and **the PR states, for `pulseShrink`,
which half is transport and which is meaning** — a decision recorded either way.

## Done when

1. No verdict about a Slice, Plan or Agent is computed in `packages/board/src`.
2. Each moved rule is unit-tested in the domain at its threshold.
3. The board payload is unchanged, asserted byte for byte per slice.
4. Fetching, caching and rate-limiting stay in the board, and the PRs say why.
5. `pnpm test`, `pnpm run typecheck`, `pnpm run test:board` green.

## Follow-on: the pulse needs an entity

**Named, not planned.** *When does the pulse beat, what is a beat a reading of,
and which machine does it run on?* Those are entity questions with no DESIGN
document — the story defines `Machine`, `Agent`, `Slice` and `Worktree`, and
says nothing about the clock they all live under.

### The three cadences are already one clock, and nobody wrote that down

**Measured 2026-08-30**, and the operator named the ratios before they were
checked:

```
pulse          5 s    1x
monitor       30 s    6x pulse
PR refresh    60 s   12x pulse   (2x monitor)

remainders:  30 % 5 = 0    60 % 5 = 0    60 % 30 = 0
```

**Every remainder is zero.** Three cadences chosen independently — two in
`fleet.ts:67,83`, one in `plot-worker-monitor.sh:165` — and they form an exact
divisor ladder.

**That resolves the objection this section would otherwise have had to answer.**
A master clock driving monitors looked like it would force one frequency on
subscribers whose questions need different ones: the monitor plan argues 30 s
because *"a CPU delta over two samples 0.4 s apart says whether a process is
busy now, which is noise on its own"*. But a clock does not have to offer many
frequencies — **it beats once and each subscriber names its divisor.** Every
current consumer already has an integer one.

**And half the mechanism exists.** `plot-worker-monitor.sh --once` takes a
single sample and exits, built for tests and used by nothing else. A
pulse-driven monitor is that flag plus a subscription.

**The one real obstacle, stated so the plan does not discover it late:** the
monitor is **stateful**. Its own help says *"a single pass can never publish
`idle` — that needs two"*, because `idle` compares this pass against the
previous one. A `--once` process started fresh each beat has no memory. So a
pulse-driven monitor either keeps its state outside the process, or stays a
process and swaps its `sleep` for a subscription. **Both are workable; the
choice is the plan's.**

**That plan should be cut before the derivations land**, so this one knows
whether it is moving rules out of a view or out of a clock.

## Notes

Cut 2026-08-30 from the operator's statement, after checking it against the
twelve plans then in the sprint. Two conditions had owners; **this one is what
they leave behind** — a rule that exists once, in the wrong layer, is invisible
to a de-duplication plan and to a gate that counts world-reaching calls.
