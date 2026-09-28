Position: amend
Evidence: executed

# ESTATE lens — #1046, a row is owned by more than its PR

I agree with the evidence juror's `amend` and with all three of its false-claim findings; I re-derived its headline (`assignee` is a plan field, not a PR field) and its live tally, and will not spend words re-arguing them. **My position rests on different grounds, and one of them is stronger than anything in the first verdict: the plan has a delivered predecessor it never cites, and that predecessor already answered — on the record, with argument — two of the three questions this plan reopens as if they were new.**

## 1. THE PRIOR ART THE PLAN DOES NOT CITE

`docs/plans/2026-09-24-the-board-shows-me-only-my-work.md` — **State: Released, 2026-09-28, 2.21.0.** Released *today*. It is the plan that built `ownership.ts` and `mine-filter.ts`, in three slices (#992, #993, #1006). The new plan names neither the plan, its issue (#967), nor any of its three PRs.

That matters because the predecessor is not merely related — **it explicitly deferred the exact populations this plan now proposes, and gave reasons**:

| this plan's population | the predecessor's disposition | line |
|---|---|---|
| assigned PRs / `Assignee:` | **Option A, considered and REJECTED as a first slice** — "requires every plan author to maintain a field ignored for a month" | `:77-78` |
| branch ownership | **Open Question, left open by name**: *"Is an unowned row mine if I dispatched its agent? Locality and authorship disagree"* | `:143` |
| plan ownership | `Assignee:` "left alone… deleting a field 71 plans carry is not this plan's call" | `:174` |
| identity spellings | **Open Question, left open**: *"Which identity is canonical when the two disagree?"* | `:141` |

So the gap is real and the predecessor knew it was leaving one. **This is not a duplicate plan.** But a plan that reopens three deferred decisions without quoting the argument that deferred them is a plan that will re-litigate them from a worse position — and the estate has a documented habit here: the predecessor's own note `:97` reads *"This is the fifth plan today whose first slice already exists somewhere on the estate."*

**Amendment 1: cite the predecessor, and for each of the four populations say whether the predecessor's reason for deferring still holds.** For `Assignee:` it demonstrably does *not* (see §2), and that is a finding worth the plan's space.

## 2. THE PARSER DEFECT THE PREDECESSOR NAMED HAS BEEN FIXED — AND THAT CHANGES THE ANSWER

The predecessor rejected `Assignee:` partly on a number, and flagged the number as wrong (`:50-56`): *"115 plan files carry an `Assignee:` line. `plot-plan-meta.sh` reports 71"* — section-gated, so 44 plans writing it under `## Status` were dropped. It called that *"a defect in its own right and this plan does not fix it."*

**It has since been fixed.** `plot-plan-meta.sh:493`:

```
if (fm_assignee == "" && assignee == "") assignee = status_assignee
```

Measured just now, parsing every plan:

```
plans carrying Assignee: in the file    115
parser reports assignee on              115
```

115 of 115. The under-read is gone. **So the predecessor's headline objection to option A — the field is invisible — is no longer true**, and the new plan is entitled to reconsider it. It does not, because it is looking at the wrong `assignee`.

## 3. THE NUMBER THAT SHOULD DECIDE THE PLAN'S ORDERING

This is the measurement I contribute, and I believe it is the most consequential thing either juror found.

The plan proposes `assignee` as the smallest, safest first move. **A naive `assignee` rule would hide 55 of this operator's own 115 assigned plans**, because one human is spelled three ways:

```
=== assignee spellings across ALL plans, via the parser ===
{ "eins78": 4, "jwloka": 60, "Jan Wloka": 51 }
total: 115
exact-match mine: 60   would-be-HIDDEN: 55
```

On the live board, same story on the Kanban cards:

```
total plan cards: 341
cards with assignee: 111 of 341 (32.6%)
spellings: {"eins78":4,"jwloka":57,"Jan Wloka":50}
cards matching hostUser jwloka exactly: 57
cards NOT matching (would be HIDDEN): 54  ["eins78","Jan Wloka"]
```

**`Jan Wloka` and `jwloka` are the same person**, and the reader's `hostUser` is `jwloka`. So the plan's "smallest real win" is, on the only estate available to test it, a filter that hides **48% of the operator's own assigned plans**. That is precisely the failure the plan's own Design section warns against — *"A guess encoded here hides rows a person needed"* — arriving through the population it nominated as safest.

**The mechanism to prevent it exists, is tested, and is unwired.** `packages/domain/src/entities/person.ts:42`:

```ts
export const resolvePerson = (raw: string, directory: PersonDirectory = {}): Person => {
```

`ownership.ts:54` calls it with **no directory**:

```ts
return samePerson(resolvePerson(login), resolvePerson(by)) ? 'mine' : 'theirs';
```

Grepped across `packages/`: the only `PersonDirectory` ever supplied is in `packages/domain/test/person.test.ts:21` — and it is, verbatim, the mapping this estate needs:

```ts
const directory: PersonDirectory = { 'jan wloka': 'jwloka', jwloka: 'jwloka' };
```

`person.ts:3-5` states the gap in its own docstring: *"State source: none; a Person is not derived from anywhere, because nothing in the estate resolves one human's two spellings to one identity."*

This is the estate's recurring shape — `setSprintState`'s nine refusals with zero callers; `ownedFromAgent` with zero callers, which the first juror found. **A third instance: a resolution mechanism, fully tested, never handed the data it needs.**

**Amendment 2 (the one I would make blocking): the plan must state that spelling resolution is a precondition for ANY assignee- or name-based population, not a refinement of one.** Either a slice supplies a `PersonDirectory` (a `## Plot Config` key, or derived from the host — the predecessor's `:105` argues against a config key for *identity*, but a spelling directory is a different fact and that argument does not automatically transfer), or every name-based population is out of scope. Shipping the assignee rule without it inverts the filter for the majority of the operator's own plans.

## 4. THE OPERATOR ASKED ABOUT TWO BOARDS. THE PLAN ADDRESSES ONE.

The operator's four populations, against the render paths that exist:

```
board top-level keys: generatedAt, columns, planSource, dispatch, server, ...
```

- **`/api/fleet` → `fleet.rows` → `AgentList.tsx:556`** — the ONLY site `rowsForReader` is called. 17 rows, kinds `{"release":1,"wave":16}`.
- **`/api/board` → `columns[].cards` → `App.tsx:687, :831, :901`** — 341 plan cards. Grepped: `mineOnly|isMine|rowsForReader` in `App.tsx` → **no matches. The Kanban has no ownership filter at all.**

**The operator said "plans on main branch or my branches."** Plans render as 341 cards in `columns[]`, and the checkbox does not reach them. So for the plan population the defect is not that `ownership` answers `unknown` — it is that **nothing asks**. The plan's table row *"plans on main or my branches — falls through"* describes the wrong mechanism; it does not fall through the rule, it never enters it.

This changes the slice shape materially: plans need a **second filter site** in `App.tsx`, with its own control semantics (does one checkbox govern both views?), not a new arm in `ownedFromRow`. The first juror found the same shape for agents (`fleet.agents`, not `fleet.rows`). **That is now two of five populations that need a new call site rather than a new rule arm**, and the plan's single-slice framing — "Read `assignee` in `prOwnership`, then take branches, plans and builds in order" — cannot express it.

**Amendment 3: the plan must distinguish *populations the rule mis-answers* from *populations the rule is never asked about*.** Today: rule mis-answers → none. Never asked → agents, plans, builds. The plan's whole framing is the first category and every real gap is in the second.

## 5. BLAST RADIUS — MEASURED

Replicating `ownership` + `ownedFromRow` against the live `/api/fleet` with the live reader (`hostUser: "jwloka"`, from `/api/board`'s `server` block):

```
reader: hostUser="jwloka" gitEmail="jan.wloka@quatico.com"
fleet.rows = 17   fleet.agents = 7
row kinds: {"release":1,"wave":16}
rows with pr: 9   authors: ["app/github-actions","jwloka"]
TODAY ownership tally: {"mine":8,"theirs":1,"unknown":8}
TODAY hidden: [ 'release/changeset-release/main author=app/github-actions' ]
```

**1 of 17, and it is a bot.** I confirm the first juror's figure (it read 7/1/9 against my 8/1/8 — a live board that moved between our two fetches, not a disagreement; both show exactly one hidden row and it is the same bot PR).

All 8 `unknown` rows are the operator's own `bug/*` branches. So on this estate the proposed change would remove **zero additional rows** — every unknown is already the operator's. The defect is invisible here by construction, and the plan should say so rather than implying a visible win.

**On the contributor question I part company with the first juror slightly.** It reported the estate as single-operator. At the branch level that is not quite right:

```
=== all remote branches by author ===
  10 Max Albrecht
   4 Jan Wloka
   1 github-actions[bot]
```

Ten of fifteen remote branches are a second contributor's. **They produce no rows** — they are all `fork/*` refs on a separate remote, and none appears in `fleet.rows` — so the operational conclusion (this estate cannot demonstrate the fix) survives. But *"single-operator"* is the wrong reason; the right one is *"the second contributor's refs are not in the plan estate."* A plan that records the first reason will look for the wrong fixture.

## 6. LAYERING AND THE DOMAIN RULE — CLEAN, AND THE PLAN SHOULD SAY SO

I checked the three things the panel brief asked about, and found nothing to amend:

- **Arrow functions**: `ownership.ts` has 5 `const` bindings and **zero `function` declarations**. Compliant.
- **Purity**: its only import is `../entities/person.js`. No `zod`, no adapter, no I/O. Compliant with the `ci.yml:186` gate.
- **Is `mine-filter.ts` duplicating a domain decision?** **No.** It is the mapping layer the layering rule wants: `ownedFromRow`/`ownedFromAgent`/`readerFrom` convert board schema types to the domain's `OwnedRow`/`Reader`, and `rowsForReader` applies `isMine` without re-deciding anything. Every judgement is in the domain. This satisfies *"Every rendered state is a domain property."*

**This is the plan's strongest ground and it does not claim it.** The architecture is right; only the mapping's coverage is short. **Amendment 4: say that, because it bounds the change** — no new port, no new adapter, no schema-purity question. A reviewer who does not know this will re-audit it.

## 7. TESTS THAT PIN THE CURRENT BEHAVIOUR

Ran the domain suite alone (per the load constraint):

```
 Test Files  1 passed (1)
      Tests  14 passed (14)
```

The pins, with lines:

| test | file:line | pins |
|---|---|---|
| `shows a plan card, an issue row and a bare branch row` | `packages/domain/test/ownership.test.ts:68` | **`{kind:'other'}` → `unknown` → kept.** The direct pin on the population this plan targets. |
| `shows a PR whose author the host did not answer` | `:56` | `''`/`undefined` author stays unknown |
| `shows an agent in state elsewhere` | `:62` | `elsewhere` → unknown |
| `is unknown where an older server sent no identity or no state` | `:89` | the cast-not-parsed payload path |
| `hides only the rows somebody else owns` | `packages/board/test/unit/agent-list.test.ts:4067` | `['feature/mine','feature/unowned']` — unowned survives |
| `hides NOTHING when the reader has no identity` | `:4077` | *"THE WHOLE-BOARD FAILURE"* |
| `never reads the branch name for ownership` | `:4085` | **directly forbids** a naming-convention branch rule |
| `restores EVERY row when unticked — including the rows that were nobody's` | `packages/board/test/integration/mine-filter.browser.test.ts:164` | full-set restore |

**Two of these are deliberate and adversarial to parts of this plan.**

`agent-list.test.ts:4085` is the sharper one:

```ts
it('never reads the branch name for ownership', () => {
  // `feature/gardener-tidy-up` looks like a claim and is not one.
```

matching `mine-filter.ts:78`: *"**The branch name is deliberately not consulted** — `feature/jw-something` looks like a claim of ownership and is not one."* The plan floats *"a naming convention"* as a branch-ownership candidate (`:73`). **That option is closed by a test and a docstring**; the plan should record it as settled, not offer it.

`ownership.test.ts:68` would need editing for any new arm — and that is the one edit a reviewer must scrutinise, because it is the regression the whole design says must not happen.

**Amendment 5: name these two tests in the plan.** `Done when` says *"`isMine`'s permissive default is unchanged, asserted by a test naming it"* — that test already exists at `:68`, and the plan should say which tests it expects to keep versus extend.

## Against my own position

**The strongest case for `proceed`** is that the plan's *design* section is right where it matters most, and the amendments I want are corrections to its evidence rather than to its direction. `unknown` must stay permissive; the ordering advice — *"stop where the answer stops being obvious"* — is exactly the discipline that prevents the 55-plan disaster I measured; and the plan explicitly licenses stopping after one population. An implementer who follows the plan's *judgement* while ignoring its *citations* would likely discover the assignee problem in the first hour and stop, which is the plan working as designed. I still say `amend`, because the plan nominates the one population that fails worst as the one that is safest, and "the implementer will catch it" is not a property of a plan.

**The strongest case for `reject`** — and I considered it seriously — is §4: if two of the five populations need a new call site rather than a new rule arm, and the third needs a spelling directory that does not exist, then the plan's single slice describes work that is not the work. A plan whose one slice is *"read `assignee` in `prOwnership`"* is, measured, a plan to read a field that object does not have. That is close enough to unbuildable to justify rejection. I do not reject because the **problem statement, the mechanism trace, and the permissive-default reasoning are all correct and re-usable** — the plan needs its evidence replaced, not its thinking. Rejecting would throw away the half that is right.

**Where I am least sure**: whether the spelling directory belongs in this plan or is its own. I have argued it is a precondition, but an equally honest reading is that it is a third plan (`a person is spelled three ways`), and this plan should simply declare every name-based population out of scope until it exists. Either resolution is defensible; **what is not defensible is shipping a name match with no directory**, and that is the part I would hold the line on.

## Summary of amendments

1. **Cite the released predecessor** (`2026-09-24-the-board-shows-me-only-my-work.md`, 2.21.0, #967, #992/#993/#1006) and say, per population, whether its deferral reason still holds.
2. **Spelling resolution is a precondition, not a refinement.** 55 of 115 assigned plans would be hidden from their own author. `resolvePerson` takes a directory; nothing supplies one.
3. **Separate *the rule mis-answers* from *the rule is never asked*.** Today: mis-answers = none; never asked = agents (`fleet.agents`), plans (`columns[].cards`, no filter at all in `App.tsx`), builds. Plans and agents need new call sites, not new rule arms.
4. **Record that the layering is already correct** — domain-pure, arrow-compliant, mapping-only in `app/`. It bounds the change.
5. **Name the pinning tests**, and record that branch-naming-convention ownership is *closed* by `agent-list.test.ts:4085`, not open as `:73` implies.
6. Carry the number — **1 of 17 rows hidden today, and it is a bot** — and say the estate cannot demonstrate the fix because the second contributor's refs are `fork/*` and produce no rows.
