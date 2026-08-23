# The plan the board holds

> The plan already has a domain model with 26 fields and a contract test. The board reads five of them and re-derives things the other twenty-one already answer.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The board reads the plan facts it needs from the plan-format contract rather than re-deriving them, so a plan's approval, assignee and story reach the row that renders them.

<!-- Board impact: this IS the board. packages/board/src/contract/schema.ts and
     src/server/fleet.ts — which PlanMeta fields reach an AgentRow. Rebuild. -->

## Motivation

Asked while designing a domain model: *what properties do we model for a plan?*

**A plan is the one entity here that already has one.** `plot-plan-meta.sh` emits
**26 fields**, CLAUDE.md names it *"the plan-format contract"*, and
`pnpm run test:reconcile` tests it. It is authoritative and shell-based so any
model tier can read it.

So the question is not what to model. It is **which of the 26 the board needs,
and what it re-derives that they already answer.**

### What the parser answers

```
identity     file · format · title · type
lifecycle    phase · phase_raw · phase_alt · phase_alt_raw
transitions  design_raw · approved_raw · started_raw · delivered_raw · released_raw
ceremony     review · review_raw · impl · impl_raw
belonging    sprint · story · assignee
work         waves[] · branches[] · prs[] · issues[] · malformed_prs[]
release      changelog[]
```

### What the board reads

Five: `plan`, `planFile`, `phase`, `brief`, `version`.

**Twenty-one fields the plan states about itself never reach a row.** The ones
that matter for what the board is currently getting wrong:

| field | what it would answer |
|---|---|
| `approved_raw` | *who approved this, when, through which channel* |
| `started_raw[]` | *which branches were actually started, and when* |
| `assignee` | *whose plan is this* |
| `sprint` · `story` | *what does this belong to* |
| `impl` | *own branches / same branch / other repo* — where work happens |
| `review` | *pr / in-session / ballot* — how approval is given |

### Phase is already modelled, and modelled well

`toBoardPhase(helperPhase)` in `contract/schema.ts` is a total mapping with a
recorded rationale for every arm:

```
draft     → Discovery    "a plan under review is the investigation deciding
                          whether there is a commitment at all"
design    → Design
approved  → Development  "an approved-but-unstarted plan is work waiting for an
                          agent … not Design, whose name means the approach is
                          still open"
delivered → Endgame
released  → Released
```

**This is what the wave lacks and the plan has**: one named function, one place,
every case argued. Worth saying plainly because it changes the shape of the work
— *the plan does not need a domain model built; it needs its existing one
consumed.*

### What the plan genuinely lacks

Two, and both are real:

**1. Approval is a boolean by omission.** The board sees `phase`, which folds
approval into a five-valued lifecycle. It cannot say *who* approved, *when*, or
*through which channel* — all three are in `approved_raw`, unread. This is why
`a-draft-plan-claims-no-approvals` had to check the plan file by hand to answer
*is it partially approved*: the board could not have said.

**2. `started_raw` is unread, so the board infers what it could count.** A plan
records `Started:` per branch and the parser emits them as an **array** — so
*has this started* is `started_raw.length > 0`, a structural question needing no
string handling at all. The board instead derives *started* from branch state,
which is why an approved-but-unstarted plan and one whose worker died look alike.

Measured: of 10 approved plans, **5 have started and 5 have not** — the same
`phase`, the same `Development` column, and opposite answers to *can I pick this
up*. `toBoardPhase` still carries the scar of an earlier attempt at this
distinction: its second parameter is `_started`, underscore-prefixed and unused,
removed because forking the PHASE on it manufactured a Design column. The fact
is worth having; the phase was the wrong place to put it.

## Design

### The records are DETAIL, in text — and the phase is the fact

The `*_raw` fields are exactly what their name says: **the raw line a human or a
command wrote**, kept for a reader who wants the detail. They are not a second
encoding of the lifecycle, and the board must not treat them as one.

Measured across all 104 plans, 2026-08-23:

| field | filled | shape |
|---|---|---|
| `approved_raw` | 78 | 66 as `date, who, channel`; **12 as prose** — `2026-08-20 by jwloka (in-session) — <sentence>` |
| `delivered_raw` | 71 | **nine distinct shapes**, from bare date to `date + 7 fields` where a PR list's commas are indistinguishable from separators |
| `released_raw` | 67 | 66 as `date, version` — the only near-uniform one |
| `design_raw` | **0** | the Design phase exists in `toBoardPhase` and no plan has ever entered it |
| `phase_alt` | 0 here | guards a **front-matter** disagreement; our estate is 104/104 canonical, so it is empty by construction rather than by neglect |

**So a typed `approved` record is not available today.** A parser would be wrong
on 12 plans immediately and unpredictably on `delivered_raw`. The board carries
the string and renders it as prose — which is what it is.

### Why the phase stays the authority

The records do **not** determine the phase, and the estate proves it:

```
phase=released   records = approved+delivered+released   62
phase=released   records = delivered+released             5
phase=released   records = approved only                  3   ← records incomplete
phase=approved   records = (none)                          1
```

**Three released plans carry no released record**, and one approved plan carries
no approval record. Deriving the phase from the records would demote all four.
`Phase:` is the structured fact; the records are the story behind it, written by
hand and sometimes not written at all.

That is the split the board should carry:

- **`phase`** — structured, five values, total mapping, drives grouping and every
  decision
- **`*_raw`** — text, optional, shown as detail, drives nothing

**A field that drives nothing cannot be wrong in a way that misroutes a row**,
which is the whole reason to keep them apart. `absent is not false` applies to
the records specifically: an empty `delivered_raw` on a delivered plan means
*nobody wrote it down*, never *it was not delivered*.

### Carry the plan's own records, do not re-derive them

Add to the payload's plan facts, from `PlanMeta`, unchanged:

**The board never parses a record. It reads what the parser already structured.**

That distinction is the whole of this section, and it is easy to lose: *"read
`started_raw`"* sounds like string handling and is not. `plot-plan-meta.sh`
already did the parsing — it emits `started_raw` as a **JSON array**, one entry
per `Started:` line. So:

| question | answered by | is it parsing? |
|---|---|---|
| has anything started? | `started_raw.length > 0` | **no** — array emptiness |
| how many branches started? | `started_raw.length` | **no** |
| who approved, when, how? | the text of `approved_raw` | **not answered** — shown, not read |

The two fields carry the same suffix and are not the same kind of thing.
`started_raw` is a **list the parser built**; `approved_raw` is **one line
somebody wrote**. The board may count the first and may only display the second.

Add to the payload's plan facts, from `PlanMeta`:

- `started` — the **array**, carried as-is. Its LENGTH is the fact the board
  uses; its entries are detail.
- `approved` — the record **as text**, `""` where absent. Never split into
  date/who/channel: 12 of 78 use a different grammar today, so any parser is
  wrong on twelve plans the day it ships.
- `assignee`, `sprint`, `story` — as the plan states them, `""` where absent
- `review`, `impl` — the two ceremony answers

**Verbatim, never interpreted.** The parser is the contract; a second reading of
`Approved:` in TypeScript is the drift this repo keeps paying for. Where the
parser says `""`, the board says absent — it does not guess.

### The rule this settles

**A plan is Approved or it is not.** There is no partial approval, and the board
should be able to say so from a field rather than from a phase. With `approved`
present, `a-draft-plan-claims-no-approvals`'s check becomes a lookup instead of
an investigation.

### What NOT to model

Recorded so the next reader does not add them:

- **A plan's own section.** A plan appears wherever its waves are; giving it a
  section would contradict *a plan may appear in several sections*.
- **A plan's completeness as a separate field.** It is a function of its waves —
  derive it there, once, per `the-wave-is-a-thing-the-board-can-hold`.
- **A second phase vocabulary.** `toBoardPhase` is the mapping. Anything wanting
  a different granularity should read the transition records, which are the
  finer-grained truth the phase summarises.

### Open Questions

- [ ] Does `changelog[]` belong on the row? It is release-note text, read by
      `/plot-release`. Probably not — the board is not where release notes are
      composed — but it is the one substantial field this plan does not place.
- [ ] `malformed_prs` is a parser diagnostic. Surfacing it would make plan-format
      drift visible on the board rather than only in the sweep. Attractive, and
      out of scope here.

## Done when

- **No `*_raw` string is split, matched or destructured anywhere in the board.**
  Asserted by construction — the only permitted operations on a record are
  *render it* and, for the array-valued `started`, *count it*. This is the
  assertion that keeps the next reader from adding a date parser.
- A row carries the plan's `approved` record **as text**, and it is empty for a
  Draft — the live shape is `a-dispatch-hands-over-a-brief`, Draft with an empty
  `Approved:`.
- **No record drives a decision.** Asserted by construction: grouping, section
  and phase read `phase`, never a `*_raw`. A test that renders the records but
  also routes on them passes every display assertion and reintroduces the
  coupling this split exists to prevent.
- A **released** plan with no `released_raw` still reads as released — three
  such plans exist today, and deriving phase from records would demote them.
- A row carries `started[]`, and an approved-but-unstarted plan is
  distinguishable from one whose branches merely have no activity. That pair is
  indistinguishable today, and a test that only checks the field exists misses it.
- `assignee`, `sprint`, `story`, `review`, `impl` reach the row as the parser
  states them, with `""` rendering as absent rather than as a value.
- **No field is re-parsed.** Asserted by construction: every new field traces to
  a `PlanMeta` key, and a test fails if a plan fact is read from anywhere but the
  parser's output.
- `toBoardPhase` is unchanged — this plan adds records beside the phase, it does
  not touch the mapping.
- `pnpm run test:board` and `pnpm run test:reconcile` green.

## Branches

### Carried

- `feature/the-row-carries-the-plans-records` — `approved`, `started[]`, `assignee`, `sprint`, `story`, `review`, `impl` reach the row verbatim from `PlanMeta`

### Read

- `feature/the-board-reads-approval-not-phase` — the places that infer approval from phase read the record instead; absent stays absent

## Notes

Asked as *"lets start with plan — what properties do we model in the domain for a
plan?"*, following the entity inventory in `docs/board-entity-properties.md`.

The answer turned out to be smaller than the question implies, and that is the
finding: the plan's model exists, is tested, and is good — `toBoardPhase` argues
every one of its five arms. What is missing is consumption. Twenty-one of
twenty-six fields never leave the parser.

This is the opposite of the wave, where the model is genuinely absent. Recorded
side by side because the two entities need different work and the same question
produced both.
