# Panel — a row is owned by more than its PR (#1046)

Subject: `docs/plans/2026-09-28-a-row-is-owned-by-more-than-its-pr.md`
Round 1, 2026-09-28. Two jurors, all four commitments gated.

| Juror | Position | Evidence |
|---|---|---|
| evidence | amend | executed |
| estate | amend | executed |

**Unanimous: amend.** Both executed against the live board. The estate juror re-derived the evidence juror's headline before adding its own, so the two agree on findings as well as verdict.

## The defect is real; three supporting claims were false

`ownership.ts:77` returns `unknown` for any row that is neither `pr` nor `agent`, and `isMine` keeps it. That diagnosis holds.

**1. `assignee` is not a PR fact.** The plan's sharpest sentence — *"`prOwnership` reads `author`. `assignee` is in the schema and unread. That is the smallest change"* — points at `PlanMetaSchema:70` and `CardSchema:403`, both plan objects. `CardPrSchema` and `AgentRowSchema.pr` carry none, and `plot-host.sh` fetches none.

```
occurrences of "assignee" in /api/fleet: 0      <- where rows live
occurrences of "assignee" in /api/board: 111    <- plan cards
```

**So the smallest win is the largest of the five**, needing a host fetch, two schema fields, a `PrRecord` field and a `pr-list --rich` branch on both hosts — and the plan's own `Done when` (*"No new field is added to the payload"*) excludes it.

**2. The agent arm is dead, not working.** `ownedFromAgent` (`mine-filter.ts:95`) has **zero callers**. `rowsForReader` maps everything through `ownedFromRow` (`:86`), a ternary emitting `pr` or `other` and never `agent`. The live board carries 4 registry agents that `agentOwnership` would answer `mine`; none reaches the filter, because `AgentList.tsx:556` filters `fleet.rows` and agents live in `fleet.agents`.

**3. `RowKindSchema` has eight values, not three.** The plan's "only three kinds" are `OwnedRow`'s own arms — true by definition, measuring nothing. `contract/schema.ts:1415` lists `ticket, plan, pr, build, agent, branch, release, wave`, and `AgentRowSchema.kind`'s docstring already says *"see RowKindSchema for the seven"*, stale by one. **A `build` row exists** (`tuple-row.ts:1552`, rendered `:759`).

## THE FRAMING CORRECTION — the rule mis-answers nothing

The estate juror's contribution, and it changes the slice shape:

| population | renders through | reaches `ownership`? |
|---|---|---|
| PR rows | `fleet.rows` → `AgentList.tsx:556` | **yes**, answered correctly |
| agents | `fleet.agents` | **no** |
| plans | `columns[].cards` → `App.tsx:687` | **no** — no ownership filter exists in `App.tsx` |
| builds | `tuple-row.ts:1552` | **no** |

**Populations the rule mis-answers: none. Populations it is never asked about: three.** The plan's entire framing is the first category and every real gap is in the second. Two of the three need a new **call site**, not a new arm — which the plan's single-slice shape cannot express.

The operator said *"plans on main branch or my branches."* Those are 341 Kanban cards and the checkbox does not reach them.

## THE BLOCKING FINDING — spelling resolution is a precondition

```
assignee spellings across ALL plans: { "eins78": 4, "jwloka": 60, "Jan Wloka": 51 }  total 115
reader hostUser = jwloka  →  exact-match 60,  WOULD BE HIDDEN 55
```

**A naive name rule hides 48% of the operator's own assigned plans** — the failure the plan's own Design warns against, arriving through the population it nominated as safest.

`entities/person.ts:42` exports `resolvePerson(raw, directory)`. `ownership.ts:54` calls it with no directory. The only `PersonDirectory` in the estate is `test/person.test.ts:21`, and it is verbatim what is needed. `person.ts:3-5` states the gap itself: *"nothing in the estate resolves one human's two spellings to one identity."*

**Third instance of the estate's recurring shape**, after `setSprintState`'s nine refusals with zero callers and `ownedFromAgent`'s zero.

## THE UNCITED PREDECESSOR

`docs/plans/2026-09-24-the-board-shows-me-only-my-work.md` — **Released 2026-09-28 in 2.21.0, the same day this plan was written.** It built `ownership.ts` and `mine-filter.ts` in #992, #993 and #1006. The plan cited neither it, its issue (#967), nor any PR.

It deferred these exact populations with reasons: assigned PRs were **Option A, considered and rejected** (`:77-78`); branch ownership and identity spellings are **named Open Questions** (`:143`, `:141`).

**One reason has expired, and that is the plan's strongest argument.** The predecessor rejected option A partly because the field was invisible — *"115 plan files carry an `Assignee:` line. `plot-plan-meta.sh` reports 71"* — and called the under-read *"a defect in its own right."* It has been fixed (`plot-plan-meta.sh:493`); the parser now reports **115 of 115**. So the deferral is reopenable, and the plan must reopen it by quoting what it overturns.

## What the filter costs today

```
17 rows · {"mine":7,"theirs":1,"unknown":9} · REMOVED: 1 (5.9%)
hidden: release/changeset-release/main, author=app/github-actions
```

One bot row. On a single-operator estate, **zero human rows**. The number belongs in the plan rather than the adjective *"almost nothing"*.

## Amendments folded in

1. The wire claim corrected; assigned PRs reclassified as the largest population and out of scope without a deliberate schema change.
2. The mis-answers/never-asked distinction, with the four-population table and the two new call sites.
3. `RowKindSchema`'s eight values and the `build` row.
4. Spelling resolution made a blocking precondition, with the measurement.
5. The predecessor cited, with its four deferrals and the one that expired.
6. `Done when` rewritten: the directory, a caller for `ownedFromAgent`, and an explicit answer on the Kanban.
