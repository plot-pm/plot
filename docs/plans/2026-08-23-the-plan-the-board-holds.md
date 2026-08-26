# The plan the board holds

> The plan already has a domain model with 26 fields and a contract test. The board reads five of them and re-derives things the other twenty-one already answer.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** the-board-serves-an-enterprise-stack
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Rounds:** 1
- **Started:** 2026-08-26, Jan Wloka, `feature/the-board-reads-approval-not-phase`

## Changelog

- The board carries no plan field it does not read: `impl` either reaches a
  reader or leaves the schema, `review` states its contract, and the last fact
  inferred from a phase is settled.

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

### What the board reads — RE-MEASURED 2026-08-26

**The claim below was true when written and is not now.** Measured against main
by grepping every `meta.<field>` in `board.ts` and `fleet.ts`:

```
parser emits          27 fields   (26 when this plan was written; `long_wave_names` since)
board consumes        16 of them
still unread          11
```

Every field this plan's original table named — `approved_raw`, `started_raw`,
`assignee`, `sprint`, `story` — **is already consumed**. They were delivered by
sibling work between 2026-08-23 and today (the plan-status and sprint-membership
plans in particular), not by this one.

The eleven unread fields are mostly internal by design: `phase_raw`,
`phase_alt_raw`, `review_raw` and `impl_raw` are the un-normalised twins of
fields the board already reads; `format`, `long_wave_names` and `malformed_prs`
are parser diagnostics; `branches` and `changelog` are covered by `waves` and by
the release flow.

### What actually survives — two facts and one inference

**1. `impl` is declared and read NOWHERE.** Measured: it appears exactly once in
the whole board, at `contract/schema.ts:65`:

```ts
impl: z.string().default('NONE'),
```

No producer, no consumer, no renderer. **This is the failure this very sprint
shipped a warning about**: `setup-names-an-unread-key` (PR #452) now warns a
user when `/plot-board-setup` writes a key no backend reads. Plot is doing to
its own schema what the setup skill now warns users about.

**2. `review` is consumed but never surfaced.** One use, at `board.ts:507`:

```ts
return meta.review === 'pr' ? 'open' : 'draft';
```

That is an internal decision about how to render a plan PR's state. The plan's
recorded answer to *how is approval given* never reaches a reader.

**3. One fact is still inferred from phase**, at `board.ts:956`:

```ts
if (phase === 'Development') card.started = started;
```

The comment defends it deliberately — the Ready/In-progress badge is a
Development affordance that must not ride into Testing. **That is a real
argument**, and this plan should test it rather than assume it wrong: the
question is whether the gate belongs on the phase or on `started_raw` being
present, which are the same set today and diverge on a plan bumped out of
Development with started branches.

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

1. **`impl` either reaches a reader or leaves the schema.** A field declared and
   read nowhere is the defect `setup-names-an-unread-key` warns users about;
   Plot should not carry one itself. Either outcome closes it — what is refused
   is leaving it declared and unread.
2. **`review` reaches a reader, or its single internal use is the whole of its
   contract and says so.** Today it decides a PR's rendered state at
   `board.ts:507` and answers nothing a reader can see.
3. **The `phase === 'Development'` gate at `board.ts:956` is settled either
   way** — kept with its argument tested, or moved onto `started_raw`. It is
   NOT assumed wrong: the existing comment gives a reason, and the two
   conditions differ only for a plan bumped out of Development that still has
   started branches.
4. **No field is added to the schema without a consumer in the same change.**
   The rule this plan's own finding argues for.
5. `pnpm run test:board`, `pnpm run typecheck` green.

## Waves

### Carried (Branch: feature/the-row-carries-the-plans-records) <!-- deferred: delivered by siblings 2026-08-26 — approved/started/assignee/sprint/story all reach the row already -->
- Retired. Measured 2026-08-26: every field this wave named is already consumed
  by `board.ts`. What it asked for exists.

### Read (Branch: feature/the-board-reads-approval-not-phase)
- `impl` reaches a reader or leaves the schema; `review` reaches a reader or
  states its contract; the one `phase === 'Development'` inference is settled
  with its argument tested rather than assumed.

## Approval

- **Assignee:** Jan Wloka

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

### Interrogated 2026-08-26 — and most of it had already shipped

One round, spent counting rather than designing.

The plan's headline — *"the board reads five of them and re-derives things the
other twenty-one already answer"* — was true on 2026-08-23 and is not now.
Measured by grepping every `meta.<field>` on main: the parser emits **27** and
the board consumes **16**. Every field the plan's own table named as missing
(`approved_raw`, `started_raw`, `assignee`, `sprint`, `story`) already reaches a
row, delivered by sibling plans in the intervening three days.

So wave 1 was retired unbuilt: what it asked for exists.

What the count *did* find is sharper than what the plan was looking for.
**`impl` appears exactly once in the entire board** — its own schema
declaration — with no producer, consumer or renderer. That is precisely the
defect this sprint shipped a warning for in PR #452: a key recorded and never
read. Plot was doing to its own schema what `/plot-board-setup` now warns users
about.

`review` is the softer version of the same thing: consumed once, internally, to
decide how a plan PR renders — and never surfaced as the fact it records.

The one inference that survives (`phase === 'Development'` gating
`card.started`) is deliberately **not** assumed wrong. Its comment gives a real
argument, and the two conditions differ only for a plan bumped out of
Development with started branches. The wave settles it either way rather than
presuming the record must win.

**The lesson is the same one three plans hit today**: a plan is a measurement
with a shelf life. This one cost a single grep to re-date, and the re-dating
turned a large stale plan into a small true one.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {
      "q": "Does the board still read only five of the parser's fields?",
      "a": "No — 16 of 27 on main; every field the plan named as missing is already consumed, so wave 1 was retired unbuilt",
      "category": "technical"
    },
    {
      "q": "What survives the re-measurement?",
      "a": "impl is declared and read nowhere (the unread-key defect #452 warns about), review is consumed but never surfaced, and one phase-derived fact remains",
      "category": "technical"
    },
    {
      "q": "Is the phase === Development gate wrong?",
      "a": "Not assumed so — its comment argues a real case; the wave settles it either way",
      "category": "tradeOffs"
    }
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": { "stack": false, "architecture": true, "implementation": true },
    "domain": true,
    "ux": { "happyPath": false, "edgeCases": true, "errors": false, "accessibility": false },
    "nonFunctional": { "security": false, "performance": false, "scalability": false },
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
