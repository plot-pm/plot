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

**2. `started_raw` is unread, so the board infers what it could know.** A plan
records `Started:` per branch. The board instead derives *started* from branch
state — which is why an approved-but-unstarted plan and one whose worker died
look alike.

## Design

### Carry the plan's own records, do not re-derive them

Add to the payload's plan facts, from `PlanMeta`, unchanged:

- `approved` — the record: date, who, channel. `null` where absent.
- `started[]` — the records, one per started branch
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

- A row carries the plan's `approved` record, and it is `null` for a Draft — the
  live shape is `a-dispatch-hands-over-a-brief`, which is Draft with an empty
  `Approved:`.
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
