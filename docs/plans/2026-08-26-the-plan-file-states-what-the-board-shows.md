# The plan file states what the board shows

> A plan states its interrogation rounds in `## Status`, where every other
> lifecycle fact is stated and where a person reading the file will see them.

## Status

- **Phase:** Draft
- **Type:** infra
- **Sprint:** <!-- not a member; the sprint closed 2026-08-26 -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

- A plan states its interrogation rounds as `Rounds:` in `## Status`.
  `/challenge-the-plan` writes it; `plot-plan-meta.sh` prefers it and keeps
  reading the metadata comment, so the 40 plans that carry only a comment go on
  reporting correctly.

## Motivation

### One file, two records, neither visible together

A plan's interrogation is recorded **twice in the same file**, by the same agent,
in the same run — and the two writes are independent:

| record | where in the file | who writes it | a reader sees it |
|---|---|---|---|
| prose | `## Notes`, mid-document | Phase 5 | **yes** |
| `CHALLENGE-THE-PLAN-METADATA` | HTML comment, last lines | Phase 5b | **no** |

The comment is what the board reads. Every markdown renderer hides it, so the
number the board displays appears nowhere a person reading the plan can see.

### Measured on the estate, 2026-08-26

```
both prose and block:  6
block only:           34   ← the board shows a count; the prose says nothing
prose only:            7   ← the prose says "Interrogated 2026-08-22"; the board shows nothing
```

Seven plans state an interrogation the board cannot see — including
`an-interrogation-leaves-a-record`, the plan that introduced the block. It
documents its own interrogation in prose and never got one.

Two of those seven are a recorded decision: the back-fill brief
`the-six-say-they-were-challenged` names `an-approved-plan-offers-its-two-starts`
and `approval-hands-the-work-to-agents` as deliberately excluded. The other five
are not.

### Why a third location is the right answer, having considered it not being one

The obvious objection to this plan is that a plan file already carries two
records of one fact, and adding a `Rounds:` field makes three. That objection
was taken seriously and does not survive:

- **The prose is not a record of the count.** It is narrative — *"Interrogated
  2026-08-22"* — and the back-fill had to READ it to derive counts, which is
  precisely why `questionHistory` was left empty: *"the questions and answers
  cannot be reconstructed from prose after the fact."* Prose is where the
  interrogation is described; it is not where the count is stated.
- **The comment is not a record for a person.** It is the skill's resumable
  state, and its `"round"` line exists so the parser can read it. No reader
  sees it.

So the file has a *narrative* and a *machine state*, and no place where a person
can read the count. `## Status` is that place — it already holds Phase, Type,
Sprint, Story, Review, Impl and every transition record.

### It is a fact of the same kind as the ones already there

`Approved:`, `Started:`, `Delivered:` and `Released:` are all transition records
written by tooling into `## Status` and read by people. `Rounds:` is the same
shape: written by a command, read by whoever is deciding whether a Draft plan is
ready to approve. That decision is made while reading the plan, and today the
plan does not say.

## Design

### The field

```markdown
- **Rounds:** 2
```

Optional and absent by default, like `Sprint:` and `Story:`. A plan never
interrogated says nothing — which is not `0`. `0` would read as *interrogated and
found nothing*, a distinction both the parser and `roundsBadgeText` already
protect, and this must not contradict them.

**A bare count.** No date: the plan's git history holds when, `## Notes` holds
what the rounds settled, and a field that duplicates either invites the drift
this plan is about.

### The field wins; the comment still counts

`plot-plan-meta.sh` reads `Rounds:` when present and falls back to the metadata
block otherwise. Both, in that order, permanently — this is not a migration
window:

- **40 plans carry only the comment.** A parser that stopped reading it would
  blank 40 plans' rounds on the board the day this lands.
- The comment remains `/challenge-the-plan`'s **resumable state**: it holds
  `questionHistory` and `categoriesCovered`, re-read at the start of a run so a
  second interrogation continues rather than restarting. That is not a
  plan-format record and does not move.

### Phase 5b writes both, from one value

The skill already reads the block, increments `round`, and writes it back in
place. It additionally sets `Rounds:` **from the same incremented value**, in the
same step. One write, one source, so the two cannot disagree by construction —
which is the answer to *why will these not drift like the other two do*.

### Not chosen: migrate the 40

A script could back-fill every plan carrying a block. Rejected: the fallback
makes it unnecessary, and rewriting 40 plan files to add a field no reader has
yet missed is churn against a repo where the plan file is the record. They gain
it on their next interrogation and read correctly until then.

### Not chosen: report prose/comment disagreement as drift

`plot-reconcile-scan.sh` could add a section comparing the prose paragraphs to
the block, the way section 9 reports sprint drift. Tempting — the 34/7 split
above is exactly the kind of thing that scan surfaces well.

Rejected as this plan's subject: it measures a divergence between a NARRATIVE
and a COUNT, which cannot be made exact. *"Interrogated again 2026-08-22"* is one
round; a paragraph merely mentioning the word is not. A scan section that
mis-classifies prose would report drift nobody can act on. Worth its own plan if
the estate ever needs it; not a prerequisite for stating the count.

### Not chosen: have the board write the field

The board displays the number today. Teaching it to write into plan files would
make it a producer of plan facts rather than a reader of them — the inversion
this plan exists to remove, applied in the other direction.

## Waves

### Stated (Branch: infra/a-plan-states-its-rounds)

`plot-plan-meta.sh` reads `Rounds:` from `## Status`, preferring it over the
metadata block and falling back to the block when the field is absent. The
template declares the field. Contract tests cover the four cases.

### Written (Branch: infra/challenge-the-plan-states-its-rounds)

`skills/challenge-the-plan/` Phase 5b writes `Rounds:` into `## Status` from the
same value it writes into the block. Only the repo skill: a personal
`~/.claude/skills/challenge-the-plan/` override exists on at least one machine
and records an `## Open Points` section instead of a block — it is not Plot's to
change.

## Done when

1. **A plan with `Rounds: 3` in `## Status` parses as `rounds=3`** with no
   metadata block present at all.
2. **A plan with only the metadata block still parses**, unchanged — asserted
   against one of the 40 real ones. This is the item a fix that REPLACES the
   source fails, and it would silently blank 40 plans on the board.
3. **The field beats the block** where a plan carries both and they disagree.
   They will disagree during the transition, and a reader trusts what the file
   says.
4. **Neither present → absent, not zero.** Asserted directly, because `0` and
   absent are different answers and the board renders them differently.
5. **Phase 5b writes both from one value** — asserted by running a round on a
   plan with no field and checking that the field and the block's `"round"`
   agree afterwards.
6. **The 40 existing plans are untouched.** Asserted by the diff: the waves
   change scripts, template, skill and tests, and no `docs/plans/*.md`.
7. `pnpm test`, `pnpm run test:reconcile` green.

## Notes

### Interrogated 2026-08-26

One round, in-session. It changed the plan twice.

The first version proposed the field on the strength of *"44 plans carry the
block and all 44 hide it"* — true, but it treated the comment as the only
existing record. Reading `skills/challenge-the-plan/` and the back-fill brief
`the-six-say-they-were-challenged` showed a second one: the prose paragraphs in
`## Notes`, which the back-fill used as its SOURCE and refused to invent beyond.
So the question became whether a third location is defensible at all, and the
plan now argues that explicitly rather than assuming it.

The second change came from measuring the two existing records against each
other: 34 plans have a count with no narrative, 7 have a narrative with no count.
That divergence is the evidence that neither existing location is a reliable
place for a reader to look — and it is also why the reconcile-scan idea was
considered and rejected, since comparing prose to a count cannot be made exact.

The wave `Written` was narrowed in the same round: two `challenge-the-plan`
skills exist on this machine and they persist state differently. Only the repo's
is Plot's to change.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "Which challenge-the-plan skill should write Rounds:?", "a": "The repo skill only; the userSettings override is out of Plot's scope", "category": "technical"},
    {"q": "How is the metadata block updated with respect to the plan file?", "a": "Two independent writes by the same agent in one run — Phase 5 rewrites the prose, Phase 5b rewrites the comment; no code writes either, and nothing binds them", "category": "technical"},
    {"q": "Both records are in the same file — does a third location still make sense?", "a": "Yes: the prose is narrative and the comment is machine state, so neither is a place a person reads a count. Status is.", "category": "tradeOffs"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": false,
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
