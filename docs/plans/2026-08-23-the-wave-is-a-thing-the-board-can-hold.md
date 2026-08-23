# The wave is a thing the board can hold

> A wave exists nowhere in the contract. It is rows that happen to share a string, re-derived at every call site with a different predicate — and five of today's defects are those derivations disagreeing.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-23, Jan Wloka, in-session
- **Started:** 2026-08-23, Jan Wloka, `feature/the-classifier-is-total`
- **Started:** 2026-08-23, Jan Wloka, `bug/a-wave-is-one-row`

## Approval

- **Assignee:** Jan Wloka

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

### The invariant

Two clauses, at two levels, and keeping them apart is what makes the rule
implementable:

> **A plan may appear in several sections — but only as ONE row per section.**
> **A wave may appear in only ONE section — as one row.**

The plan-level clause is already satisfied and must stay that way: 43
`(plan, section)` pairs render today, 4 plans span more than one section, and
each has a single head where it appears. A plan legitimately has work in several
states; splitting its head per section is how the board says so. Nothing here
changes that, and `a-split-plan-says-it-is-split` is what makes the split
legible.

The wave-level clause is the one being broken, in two ways at once.

### The starting rule: one wave, one row, one section

**A wave renders as exactly one row.** Not one row per branch that happens to
share the name — one row, in one section. This is the operator's rule and it is
the right first move, because it forces every disagreement into the open: a
single row must pick a single state, so the question *which answer wins* can no
longer be avoided by rendering both.

**The repetition is INSIDE one section, not across sections** — which is why the
plan-level clause survives untouched:

```
the-agent-panel-shows-the-agent  / done    6 rows, 2 distinct waves
a-held-branch-says-who-holds-it  / done    5 rows, 2 distinct waves
opus5-longhorizon-hardening      / quiet   6 rows, 2 distinct waves
waiting-on-you-says-…            / done    6 rows, 3 distinct waves
working-shows-the-agent          / done    6 rows, 6 distinct waves   ← correct
```

Four rows of pure duplication under one head in the first case, and the last line
shows the shape when it is right: six waves, six rows. The rule does not thin a
plan that genuinely has six waves; it removes the branches a wave repeats itself
over.

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

### Should the constraint model come first? Yes — and it mostly exists

The states that decide where a wave shows up, measured on the live payload:

```
state      wip · open · deferred · merged                        (4)
verdict    eligible · blocked · complete · null                  (4)
phase      Discovery · Development · Endgame · Released · null   (5)
waitingOn  click · time · null                                   (3)
pr         6 states plus absent                                  (7)
worker     8 states                                              (8)
booleans   localDirty · localLocked · localAhead · stuck         (2^4)
```

The cross-product runs to tens of thousands of combinations. **The live board
exercises roughly forty.** That gap is precisely where the defects have been:
every one found today was correct for the shapes someone had an example of and
wrong for a region nobody had looked at.

**The decision point is already a single pure function.** `classify(state,
verdict, ageMinutes, …, phase, workerState, …)` returns `{group, note, verdict}`
in one place, and `fleet.ts` says of a neighbour that it is kept *"pure enough to
assert exhaustively"*. Four test files already loop over state vocabularies.

So this is not machinery to build. It is **an existing habit applied to the
function that needs it**, and it is the cheapest of the three things this plan
proposes:

1. enumerate the input space and assert `classify` is **total** — every
   combination yields a group, and the same combination always yields the same
   one
2. assert the **invariant** on the output: no `(plan, wave)` reaches two groups
3. then change the model, with the enumeration as the safety net

**This repo has already proved the technique twice, on this exact code.**
`waitingOnFor` was evaluated over its whole input space and found to return
`'you'` for exactly one input — while a comment beside it described a case that
no longer existed. `canCommissionDesign` was proven satisfiable by **no**
combination at all: a feature that could never fire, invisible to every
example-based test and obvious the moment the space was enumerated.

Two of today's five defects are the same shape. `groupedNote`'s `default:`
returning *work landed* is a total-function defect — wrong for every word it does
not know. DONE admitting a `Discovery` plan is another — wrong for a region of
`phase` nobody had a fixture for.

**Order, and it is the answer to "which first":** the enumeration is written
against today's behaviour first, so it records what the board currently does
before anything moves. Then the wave collapse runs against it, and every
difference is either an intended fix or a regression the enumeration names. Doing
it the other way round means changing the model with no map of what the change
touched.

**What it does not do.** An enumeration proves totality and consistency; it does
not know which group is *right*. `Inverted` belonging in NOT STARTED is a
judgement — the model can only insist the answer be single and stable. Keep
those apart: the constraint model is a gate, the section rule is a decision.

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

**Sequencing is settled: this plan lands FIRST.** Decided 2026-08-23, and the
reason is that `Inverted` is the pivot — once a wave has one section, DONE's
verdict rule is already satisfied and the split tuple's numerator becomes
well-defined. Both dependent plans shrink rather than being written around a
placement that is about to change.

The order, and each arrow is a real dependency:

```
bug/a-wave-is-one-row
   ↓ Inverted now has exactly one section
done-holds-what-is-still-yours     — its verdict rule is already met
   ↓ DONE's membership is settled
a-split-plan-says-it-is-split      — (2/3) numerator is now well-defined
```

**Do not run them concurrently.** All three edit `AgentList.tsx`, and the two
downstream plans would each add a wave derivation this one exists to remove.

**A second ordering crosses plans, and it is NOT enforced by these waves.**
`bug/done-holds-finished-plans-only` filters on a plan's **phase**, and five
plans carry a stale one — every branch merged, still reading `Approved`
(measured 2026-08-23; it was 16 on 08-21, drained by hand to 2, and refilled to 5
in a day of fleet work). A filter verified against those reads a wrong input.

`done-means-delivered`'s `Reached` wave is what fixes the input. Plot cannot gate
across plans, so this is stated rather than enforced — **and the practical
mitigation is in the assertion, not the schedule**: `done-holds-finished-plans-only`
asserts against a **fixture** with known phases, never against the live estate.
The code is then independent and only the estate-level verification waits.

**It does not move the derivation into the client.** The server already owns
wave verdicts and the client already casts rather than parses (see
`FLEET_CONTROLS_DEFAULT`, fixed 2026-08-22). A wave computed client-side would be
a second answer to a question the scan already answers.

### The six failing rules are xfails with numbers, not skips

Twelve of the eighteen rules pass today and six do not. The six are written
**asserting their current measured value**:

```ts
it('DONE => verdict complete', () => {
  // Fails 60/61 today: every-section-has-one-subject / Inverted.
  // `a-wave-is-one-row` makes this 61/61 — and this test will FAIL when it does,
  // which is the point: the number must be raised deliberately, in the commit
  // that earns it.
  expect(rows.filter(complete).length).toBe(60);
});
```

**Not `it.skip`.** A skipped test is invisible in a green run, and this estate has
already been bitten by that — the whole reason the section rules exist is that
seven defects were found by screenshots rather than by tests. A skip would make
the rules a document again.

**Not a red suite either.** Asserting all eighteen truthfully would leave CI red
for the sprint's whole duration, and this repo gates merges on it — so the sprint
would be unable to land its own fixes.

The xfail's cost is stated: a test that passes for the wrong reason if someone
changes the estate rather than the code. Guard by asserting the **rule's
outcome** over a fixture rather than a live count wherever the fixture can carry
the case.

### Open Questions

- [x] Does `Wave` go in the payload, or does the client build it once from rows?
      **The payload, server-derived** — settled 2026-08-23. The scan already
      computes verdicts, so the Wave is assembled where its status already lives
      and the client keeps casting rather than deriving. A client-side derivation
      would put the answer where it can drift from the scan's, which is the exact
      failure class this plan documents.

      **Cost accepted knowingly:** a schema migration, a larger payload, and every
      board version agreeing on the shape. Measure the payload growth during
      implementation and report it — if a wave costs more than the branch rows it
      replaces, say so rather than shipping it silently.
- [ ] What happens to `waveGroupsFor`? It should become a lookup rather than a
      computation, but its per-section predicates encode real distinctions
      (QUIET's *stalled* is not DONE's *merged*) that must survive the move.
- [ ] Do **tickets** and **PRs** need the same treatment? They are also rows
      today. Out of scope here — but if the answer is yes, this plan is the first
      of a pattern rather than a one-off.

## Done when

- The enumeration covers every value of `state`, `verdict`, `phase` and worker
  state in combination, and `classify` yields exactly one group for each —
  asserted before the model changes, so the diff afterwards is readable.
- **A wave renders as exactly one row.** Asserted by counting rendered wave rows
  against distinct `(plan, wave)` pairs — they must be equal. The live board has
  14 waves occupying 38 rows, so this fails loudly today.
- **A plan still renders one head per section it has work in, and several
  sections is legal.** Asserted on the 4 plans that span sections today: each
  keeps a head in each, with one head per section and no head lost. This is the
  clause an over-eager reading of *one row* would break, collapsing a plan into a
  single section and hiding the work elsewhere.
- A plan with six genuine waves in one section still renders six rows
  (`working-shows-the-agent` / done). The rule removes repetition, never waves.
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

<!-- THE WAVES ENCODE THE DEPENDENCY, so it is a gate rather than a note.
     Three branches from two other plans consumed the wave model and were held in
     order by prose alone — which CLAUDE.md says is a rule that will eventually be
     violated. They move here, into waves Plot itself will not release early: a
     wave is eligible only once every non-deferred branch in every prior wave has
     merged.

     The four branches that do NOT depend on the wave model stayed in their own
     plans deliberately — blocking them would buy nothing. They are:
       the-wave-name-stays-in-its-cell   (row geometry)
       the-sweep-names-a-prose-wave      (the parser)
       a-finished-row-is-not-active      (worktree facts)
     Each is independently dispatchable today. -->

### Constrained

- `feature/the-classifier-is-total` — enumerate the state cross-product against `classify`, asserting it is total and stable and that no `(plan, wave)` reaches two groups; plus the eighteen section rules, the six currently-failing ones written as **explicit expected-failures carrying today's measured numbers** (`DONE => verdict complete` expects 60 of 61, not "fails") so that fixing one breaks its test and forces a deliberate update

### One row

- `bug/a-wave-is-one-row` — a wave renders as exactly one row in exactly one section; a wave with any unmerged branch is where its unfinished work is, and the row states its branch count and any disagreement between them → #339

### Modelled

- `feature/the-contract-carries-a-wave` — a `Wave` with identity, branches, verdict, section and completeness, derived once where the verdicts already are, and carried in the payload

### Consumed

<!-- Moved here from done-holds-what-is-still-yours and a-split-plan-says-it-is-split
     on 2026-08-23. Each assumes a wave has ONE section; each would otherwise have
     to add a wave derivation this plan exists to remove. -->

- `feature/the-sections-ask-the-wave` — `waveGroupsFor` becomes a lookup; the per-section predicates that encode real distinctions move onto the wave rather than being repeated
- `feature/the-head-asks-the-wave` — the plan head's count, tuple and note read the wave instead of re-grouping rows
- `bug/done-holds-finished-plans-only` — DONE holds the release scope: plans whose every wave is complete and whose version has not shipped. Depends on a wave having one section, since its verdict rule is otherwise unsatisfiable for a mixed wave — **and on `done-means-delivered`'s `Reached` wave, because the filter reads a plan's phase and five plans currently carry a stale one**
- `feature/a-split-plan-counts-what-is-elsewhere` — each head of a plan spread across sections states how many of its waves are not here, and renders none of them. Depends on the same: the tuple's numerator is undefined while a wave can be in two places

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
