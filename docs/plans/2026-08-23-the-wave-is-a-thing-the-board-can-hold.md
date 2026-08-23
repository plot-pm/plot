# The wave is a thing the board can hold

> A wave exists nowhere in the contract. It is rows that happen to share a string, re-derived at every call site with a different predicate — and five of today's defects are those derivations disagreeing.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A wave is a thing the contract carries, with one answer to which section it belongs in, whether it is complete, and what it is waiting for — instead of a string re-grouped independently by every part of the board.

<!-- Board impact: this IS the board. packages/board/src/contract/schema.ts (a
     Wave in the payload), src/server/fleet.ts (deriving it once), and
     src/app/components/AgentList.tsx (consuming it instead of re-grouping).
     Rebuild the artifact. -->

## Motivation

Five defects were reported from the running board today. They were filed as five
plans because each has a distinct symptom, and they share one cause:

| reported | plan | what disagreed |
|---|---|---|
| a merged branch of an open wave sits in DONE | `done-holds-what-is-still-yours` | `state` (branch) vs `verdict` (wave) |
| a plan's waves split across sections, silently | `a-split-plan-says-it-is-split` | section membership vs plan membership |
| a draft plan's head says *work landed* | `a-draft-plan-claims-no-approvals` | head's note vs its own rows |
| the blocked (i) finds nothing | `the-blocking-wave-is-found-wherever-it-is` | a wave assumed to be in one list |
| DONE wears an activity mark | `done-holds-what-is-still-yours` | worktree state vs finished work |

**Every one is two answers to a question about a wave, computed in two places.**

### The wave is not in the contract

```ts
// schema.ts — AgentRow
wave: z.string(),
```

A row is a **branch**. `wave` is a string attribute on it. So a wave exists only
as *rows that happen to share a name*, and everything a wave has — a verdict, a
section, a note, a count, a completeness — is re-derived wherever it is needed.
Measured: **33 call sites** reach for `.wave`.

### The derivation differs per section, by design

`waveGroupsFor(rows, section)` decides which rows a wave claims, and the
predicate is chosen by the section asking:

```ts
section === 'waiting-on-you' ? (r) => r.state !== 'merged'
  : section === 'not-started' ? (r) => r.state !== 'merged'
    : section === 'quiet'     ? (r) => r.state !== 'merged'
      : section === 'done'    ? (r) => r.state === 'merged'
```

**A two-branch wave with one merged branch and one open branch satisfies both
predicates.** Neither is wrong; nothing owns the question *which section does
this WAVE belong to*, so both claim it and neither knows.

Measured on the live board:

```
(plan,wave) pairs rendering in >1 section:  1 of 81   → every-section-has-one-subject / Inverted
waves rendering as more than one row:      13 of 81
```

Thirteen waves are already several rows. One is already in two places. The
estate is growing multi-branch waves faster than the board's per-row model can
describe them.

### Why this is an abstraction gap and not five bugs

Each of the five plans is a correct local fix and each would work. But every one
adds a **sixth** place that knows how to derive a wave — a new predicate, a new
tuple numerator, a new completeness test — and the next report will be a seventh
derivation disagreeing with those.

The board has learned this exact lesson one level down. `one-component-renders-every-row`
collapsed two row components into one `TupleRow` because *"a ticket row was laid
on the branch's, wearing a wave, a worker and a branch it does not have."* The
fix there was to make the row a thing with a type rather than a shape three
components each assumed. **This is the same argument about the level above the
row.**

## Design

### The starting rule: one wave, one row, one section

**A wave renders as exactly one row.** Not one row per branch that happens to
share the name — one row, in one section. This is the operator's rule and it is
the right first move, because it forces every disagreement into the open: a
single row must pick a single state, so the question *which answer wins* can no
longer be avoided by rendering both.

It is also cheap, which the measurement decides rather than intuition:

```
waves rendering as >1 row:   14 of 82
rows they occupy:            38  →  14
board total:                106  →  82   (-23%)
```

**13 of those 14 are internally uniform** — every branch in one state, in one
group:

```
the-agent-panel-shows-the-agent / Says    5 rows  all merged   all done
a-held-branch-says-who-holds-it / Said    4 rows  all merged   all done
opus5-longhorizon-hardening / Implement…  5 rows  all wip      all quiet
a-folded-row-still-says-what-matters      3 rows  all open     all waiting-on-you
```

For those, the extra rows are **pure repetition**: five rows saying `merged`
where one would. Collapsing them loses nothing and removes a quarter of the
board — which also answers the density question asked earlier today more
directly than folding does. *A fold hides repetition; not emitting it is better.*

**One wave is mixed, and it is the whole problem in miniature.**
`every-section-has-one-subject` / `Inverted`: one branch merged, one open — so
it renders twice, in DONE and in NOT STARTED. Under this rule it must render
once, which forces the rule the board currently lacks:

> **A wave is where its unfinished work is.** A wave with any unmerged branch is
> not done, whatever its merged branches say. `Inverted` goes to NOT STARTED and
> DONE does not claim it.

That is the same answer `done-holds-what-is-still-yours` reaches from the DONE
boundary. Here it falls out of the wave having one place to be.

**What the row must then carry**, since it now speaks for several branches: the
count, and the fact that its branches disagree where they do. A row saying
`merged` for a wave that is half open would be the same lie in fewer rows — the
collapse must not buy density with accuracy.

### A wave in the payload, derived once on the server

The server already computes wave verdicts — `plot-fleet-scan.sh` answers
`complete | eligible | blocked` per wave and the board carries it as `verdict` on
every row of that wave. The information exists; what is missing is a place to put
it.

A `Wave` carries what a wave is asked about:

- its **identity** — plan plus name, the pair `openWaves` already keys on because
  wave names repeat across plans
- its **branches** — the rows that belong to it, whatever their individual state
- its **verdict** — `complete | eligible | blocked`, from the scan
- its **section** — ONE answer, derived once
- its **completeness** — every non-deferred branch merged

The row keeps `wave` as its identity string. Nothing about branch rendering
changes; what changes is that a consumer asking a wave-shaped question has
somewhere to ask it.

### One section per wave, and the rule is the wave's

The five plans have already settled what the rule should say; this gives it one
home:

- a wave whose every branch is merged → `done` (subject to the plan's phase, per
  `done-holds-what-is-still-yours`)
- otherwise the wave goes where its **unfinished** work is

`Inverted` — one merged branch, one open — is then in NOT STARTED, once, and DONE
does not claim it. That is the outcome `done-holds-what-is-still-yours` reaches by
a verdict check at the DONE boundary; here it falls out of the wave having a
section at all.

### What this does NOT do

**It does not replace the five plans.** Four of them fix things a domain model
does not touch: a name overlapping its cell, a `default:` that asserts, a query
scoped to one list, an activity mark reading a worktree. Those are real and local.

What it replaces is the *membership* half of `done-holds-what-is-still-yours` and
the *counting* half of `a-split-plan-says-it-is-split` — both of which currently
have to re-derive a wave to do their job.

**Sequencing matters and is the main risk.** If this lands first, two of those
plans get simpler. If they land first, this arrives to find two more derivations
in place. Decide the order deliberately; do not run both.

**It does not move the derivation into the client.** The server already owns
wave verdicts and the client already casts rather than parses (see
`FLEET_CONTROLS_DEFAULT`, fixed 2026-08-22). A wave computed client-side would be
a second answer to a question the scan already answers.

### Open Questions

- [ ] Does `Wave` go in the payload, or does the client build it once from rows
      and pass it down? The payload is more honest (one answer, server-owned) and
      costs contract churn plus a schema migration; a single client-side
      derivation is cheaper and keeps the answer where it can drift from the
      scan's. Lean payload, but measure the payload-size cost first — the scan
      already runs 18s and the board polls it.
- [ ] What happens to `waveGroupsFor`? It should become a lookup rather than a
      computation, but its per-section predicates encode real distinctions
      (QUIET's *stalled* is not DONE's *merged*) that must survive the move.
- [ ] Do **tickets** and **PRs** need the same treatment? They are also rows
      today. Out of scope here — but if the answer is yes, this plan is the first
      of a pattern rather than a one-off.

## Done when

- **A wave renders as exactly one row.** Asserted by counting rendered wave rows
  against distinct `(plan, wave)` pairs — they must be equal. The live board has
  14 waves occupying 38 rows, so this fails loudly today.
- A wave has **one** section. Asserted on `every-section-has-one-subject` /
  `Inverted` (one merged branch, one open): it appears once, and in NOT STARTED,
  because a wave with unmerged work is not done.
- A collapsed row states how many branches it speaks for, and says so when they
  disagree. Asserted on `Inverted` — a row reading plain `merged` for a
  half-open wave is the same falsehood in fewer rows, and would pass a
  count-only test.
- A wave's completeness is asked once and answered the same everywhere. Asserted
  by a test that reads it from two consumers and compares — the point is not the
  value but that there is only one.
- `.wave` string lookups in the client fall. Counted before and after, with the
  numbers quoted: 33 today, and a fix that leaves 33 has added a type without
  removing a derivation.
- No regression in the 13 waves that already render as several rows — each still
  renders its branches, and the count under each plan head is unchanged except
  where a wave legitimately moved section.
- `pnpm run test:board` green; artifact rebuilt and committed.

## Branches

### One row

- `bug/a-wave-is-one-row` — a wave renders as exactly one row in exactly one section; a wave with any unmerged branch is where its unfinished work is, and the row states its branch count and any disagreement between them

### Modelled

- `feature/the-contract-carries-a-wave` — a `Wave` with identity, branches, verdict, section and completeness, derived once where the verdicts already are

### Consumed

- `feature/the-sections-ask-the-wave` — `waveGroupsFor` becomes a lookup; the per-section predicates that encode real distinctions move onto the wave rather than being repeated
- `feature/the-head-asks-the-wave` — the plan head's count, tuple and note read the wave instead of re-grouping rows

## Notes

Asked from the board, 2026-08-23: *"we do have a state problem again. WAVES show
up in different sections where they don't belong… There seems a concept missing
or an abstraction? Do we need a domain model?"*

The answer from the measurement is yes, and narrowly: the missing concept is the
**wave**, and it is missing from the contract rather than from anyone's
understanding. Every skill, script and comment in this repo talks about waves
fluently; `packages/board/src` is the one place where a wave is not a thing.

Recorded because the tempting version of this plan is much larger — a domain
model for the whole board, plans and tickets and PRs included. The measurement
supports exactly one gap: 13 waves already render as several rows, 1 already
renders in two sections, and 5 defects trace to re-derivation. Nothing measured
here says a plan or a ticket needs the same, so nothing here proposes it.
