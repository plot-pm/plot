# A row is owned by more than its PR

> *Only my work* hides a row only where ownership answers `theirs`. The rule knows two kinds — `pr` and `agent` — and answers `unknown` for the rest, which `isMine` keeps. So the filter removes other people's PRs and other agents' rows, and nothing else.

## Status

- **State:** Delivered
- **Approved:** 2026-09-29, jwloka, in-session
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1046
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 1
- **Started:** 2026-09-29, jwloka, `bug/a-row-is-owned-by-more-than-its-pr`
- **Delivered:** 2026-09-29

## Changelog

- *Only my work* hides branches, plans and builds that belong to someone else, not just their PRs.

Board impact: the filter starts removing rows. No payload change — the facts it needs are already on the wire.

## Motivation

`packages/domain/src/rules/ownership.ts:77`:

```ts
export const ownership = (row: OwnedRow, reader: Reader): Ownership => {
  switch (row.kind) {
    case 'pr':    return prOwnership(row.author, reader);
    case 'agent': return agentOwnership(row.identity, row.state);
    default:      return 'unknown';
  }
};
```

`isMine` is `ownership(...) !== 'theirs'`, so **`unknown` is kept**. The mapping seals it — `app/lib/agent-rows/mine-filter.ts:86`:

```ts
row.pr ? { kind: 'pr', author: row.pr.author } : { kind: 'other' };
```

**A row without a PR is `other`, always.** Measured: the only three kinds in the row code are `agent`, `pr`, `other`.

Against what the operator asked for:

| population | today |
|---|---|
| my PRs | ✅ by `pr.author` |
| PRs **assigned** to me | ❌ `assignee` never read |
| my branches | ❌ no branch ownership exists |
| plans on main or my branches | ❌ falls through |
| builds of main/develop or my branches | ❌ falls through |

One and a half of five. On a board that is mostly plans and branches, turning the filter on changes almost nothing — which reads as broken.

### The facts are NOT already on the wire, and this is the correction

An earlier draft claimed `contract/schema.ts` carries `assignee` (`:70`, `:403`), `branches` (`:71`, `:88`) and `author` (`:310`) on a row, so nothing new need be fetched. **Measured 2026-09-28 against the live board, that is false for two of the three.**

`:70` and `:403` are `PlanMetaSchema` and `CardSchema` — a **plan's** `Assignee:` field. `:71` and `:88` are `PlanMetaSchema` too. Only `author` at `:310` is a PR fact, and it is the one already read.

```
occurrences of "assignee" in /api/fleet: 0      <- where rows live
occurrences of "assignee" in /api/board: 111    <- plan cards
```

`CardPrSchema` (`:262-311`) and `AgentRowSchema.pr` (`:2595-2624`) carry no assignee, and `plot-host.sh` never fetches one.

**So an assigned-PR rule is the LARGEST of the populations, not the smallest.** It needs a host fetch, a field on two schemas, one on `fleet.ts`'s `PrRecord`, and a branch in `pr-list --rich` for both hosts — and this plan's own `Done when` rule (*"No new field is added to the payload"*) puts it out of scope.

### The rule mis-answers nothing. It is never asked.

**This is the framing correction, and every real gap is on the other side of it.**

| population | renders through | reaches `ownership`? |
|---|---|---|
| PR rows | `fleet.rows` → `AgentList.tsx:556` | **yes** — and answers correctly |
| agents | `fleet.agents` | **no** — `ownedFromAgent` (`mine-filter.ts:95`) has ZERO callers |
| plans | `columns[].cards` → `App.tsx:687` | **no** — grep for `mineOnly\|isMine\|rowsForReader` in `App.tsx` returns nothing |
| builds | `tuple-row.ts:1552`, rendered `:759` | **no** — an existing row kind the mapping discards |

`rowsForReader` (`mine-filter.ts:128`) maps every row through `ownedFromRow` (`:86`), a ternary emitting `pr` or `other` and never `agent`. So `agentOwnership` is unreachable in production, and the claim *"agent rows already work"* is false — they are never asked.

**The Kanban has no ownership filter at all.** 341 plan cards, and the checkbox does not reach them. *"Plans on main or my branches"* does not fall through the rule; it never enters it.

**Two of four populations therefore need a new CALL SITE, not a new arm in `ownedFromRow`** — and a second site raises its own question the slice must answer: does one checkbox govern both views?

### `RowKindSchema` has eight values, not three

An earlier draft said *"the only three kinds in the row code are `agent`, `pr`, `other`."* Those are `OwnedRow`'s arms (`ownership.ts:36-38`) — the rule's own union, true by definition. The board's row kind is `RowKindSchema` (`contract/schema.ts:1415`): `ticket`, `plan`, `pr`, `build`, `agent`, `branch`, `release`, `wave`. **A `build` row exists**, which is why builds are a discarded kind rather than an unrepresentable population.

### What turning the filter on costs today: one bot row

```
TOTAL ROWS: 17   ownership: {"mine":7,"theirs":1,"unknown":9}
REMOVED TODAY: 1 (5.9%) — release/changeset-release/main, author=app/github-actions
```

On a single-operator estate the filter removes **zero human rows**. The number belongs here rather than the adjective *"almost nothing"*.

## Design

### The rule

**A row is classified by whatever ownership fact it carries, and `unknown` stays permissive.**

`unknown` keeping the row is correct and is not the defect — a filter must never hide work it cannot classify. **That is also why the gaps are invisible**, and it means every new kind needs a deliberate answer rather than a default.

### Assigned PRs first, and possibly alone

`prOwnership` reads `author`. `assignee` is in the schema and unread. That is the smallest change, needs no new concept, and covers a population the operator named explicitly.

**The slice may stop there and still be worth shipping.** The rest each need a decision:

- **Branches.** Owned by what — the last committer, the claiming agent's identity, or a naming convention? This estate's branch rows carry no author of their own, so this is a new fact, not an unread one.
- **Plans.** *On main or my branches* means a plan's ownership derives from where its slices live. That is a join the row may not have, and the plan's `assignee` field may be the better answer.
- **Builds.** Same shape as plans: ownership comes from the branch the build ran on.

**Take them in that order and stop where the answer stops being obvious.** A guess encoded here hides rows a person needed.

### What this does NOT do

- **It does not change what `unknown` means.** Widening it to hide would be worse than the bug.
- **It does not add a fact to the payload.** If a population needs one, that is its own plan.
- **It does not change `agentOwnership`'s rule** — but it must WIRE it. `ownedFromAgent` has zero callers today.

### Spelling resolution is a PRECONDITION, not a refinement

**This is blocking, and it is measured.** One human is spelled three ways across the estate:

```
=== assignee spellings across ALL plans, via the parser ===
{ "eins78": 4, "jwloka": 60, "Jan Wloka": 51 }   total: 115
exact-match mine: 60   would-be-HIDDEN: 55
```

The reader's `hostUser` is `jwloka`. **A naive name rule hides 48% of the operator's own assigned plans** — exactly the failure this plan's Design warns against (*"A guess encoded here hides rows a person needed"*), arriving through the population nominated as safest.

**The mechanism exists, is tested, and is unwired.** `entities/person.ts:42` exports `resolvePerson(raw, directory)`; `ownership.ts:54` calls it with **no directory**. The only `PersonDirectory` ever supplied is in `test/person.test.ts:21`, and it is verbatim what this estate needs:

```ts
const directory: PersonDirectory = { 'jan wloka': 'jwloka', jwloka: 'jwloka' };
```

`person.ts:3-5` states the gap itself: *"State source: none; a Person is not derived from anywhere, because nothing in the estate resolves one human's two spellings to one identity."*

**Third instance of this estate's recurring shape** — after `setSprintState`'s nine refusals with zero callers and `ownedFromAgent`'s zero: a fully tested mechanism never handed its data.

**So either a slice supplies a `PersonDirectory`, or every name-based population is out of scope.** The predecessor argued against a config key for *identity* (`:105`); a spelling directory is a different fact and that argument does not transfer automatically — but it must be answered, not assumed.

## Done when

- **A `PersonDirectory` resolves `Jan Wloka`, `jwloka` and `eins78` to one identity, or no name-based population ships.** Asserted on the real spellings: 115 assigned plans, 55 of them hidden without it.
- **`ownedFromAgent` has a caller**, and an agent row reaches `agentOwnership`. It has zero callers today, so the arm the plan called working is asserted for the first time.
- **The Kanban's 341 plan cards reach a filter, or the plan says explicitly that they do not** — and if they do, the PR answers whether one checkbox governs both views.
- Every population the slice does **not** classify still answers `unknown` and is **kept**, asserted explicitly so a later reader cannot mistake silence for coverage.
- The PR names which populations it covered and which it left, with the reason each was left, and **for each deferred one whether the predecessor's reason still holds**.
- **An assigned-PR rule is out of scope unless the payload gains the field deliberately.** `CardPrSchema` and `AgentRowSchema.pr` carry no assignee and no host call fetches one; that is a schema change with a host fetch behind it, not a field already on the wire.
- `isMine`'s permissive default is unchanged, asserted by a test naming it.

## Slices

### A row is owned by more than its PR (Branch: bug/a-row-is-owned-by-more-than-its-pr, PR: #1060)

Read `assignee` in `prOwnership`, then take branches, plans and builds in order, stopping where ownership stops being obvious.

## Notes

### The predecessor, and what it deliberately deferred

[`the-board-shows-me-only-my-work`](2026-09-24-the-board-shows-me-only-my-work.md) — **Released 2026-09-28 in 2.21.0**, the same day this plan was written. It built `ownership.ts` and `mine-filter.ts` across #992, #993 and #1006, and an earlier draft of this plan cited none of them.

It did not miss these populations. It deferred them, with reasons:

| this plan's population | the predecessor's disposition |
|---|---|
| assigned PRs / `Assignee:` | **Option A, considered and REJECTED** — *"requires every plan author to maintain a field ignored for a month"* (`:77-78`) |
| branch ownership | **Open Question by name** — *"Is an unowned row mine if I dispatched its agent? Locality and authorship disagree"* (`:143`) |
| plan ownership | `Assignee:` left alone; *"deleting a field 71 plans carry is not this plan's call"* (`:174`) |
| identity spellings | **Open Question** — *"Which identity is canonical when the two disagree?"* (`:141`) |

**One of those reasons has since expired, and that is this plan's strongest argument.** The predecessor rejected option A partly because the field was invisible: *"115 plan files carry an `Assignee:` line. `plot-plan-meta.sh` reports 71"* — section-gated, 44 dropped, and it called that *"a defect in its own right and this plan does not fix it."* It has been fixed (`plot-plan-meta.sh:493`), and the parser now reports **115 of 115**.

So this plan is entitled to reconsider the deferral. It must do so by quoting the argument it is overturning, not by reopening the question as if it were new.

Reported by the operator as *"Only my work seems not to work correctly"*, with the four populations named. Tracing it took two greps — the rule's `switch` and the mapping's ternary — and both are explicit about handling two kinds.

**The permissive default is good design that hid its own gaps.** Nothing failed, nothing logged, and the filter simply did less than its name promises.


### Round 1, 2026-09-28

Two jurors, both **amend**, both **executed**, both against the live board. Moderation: `.plot/panels/2026-09-28-a-row-is-owned-by-more-than-its-pr/panel.md`.

The defect is real and the diagnosis of `ownership.ts:77` is right. **Three factual claims were false, and the one the plan called its smallest win was the largest of the five.**

The framing changed: the rule mis-answers **nothing**. Agents, plans and builds never reach it — two of them need a new call site rather than a new arm — and the Kanban has no ownership filter at all.

The blocking finding is spelling resolution. `resolvePerson` takes a directory, `ownership.ts:54` passes none, and the only directory in the estate lives in a test file. Without it the *"smallest win"* hides 48% of the operator's own assigned plans.
