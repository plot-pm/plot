# An interrogation leaves a record

> The board has a field for how many rounds a plan has been challenged, the
> parser reads it, the card renders it — and nothing has written it since
> 2026-08-17. Eight interrogations on 2026-08-22 recorded nothing at all.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** working-shows-the-agent
- **Story:** plot-planning-model
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-22, Jan Wloka, in-session
- **Started:** 2026-08-22, Jan Wloka, `bug/the-skill-records-its-rounds`
- **Started:** 2026-08-22, Jan Wloka, `bug/the-skill-records-its-rounds`
- **Started:** 2026-08-22, Jan Wloka, `docs/the-six-say-they-were-challenged`

## Approval

- **Assignee:** jwloka

## Changelog

- A plan that has been through `/plot:challenge-the-plan` says so: the round
  count reaches the plan file, so the board can show it and a reader can tell
  an interrogated plan from an unexamined one.
- The eight plans interrogated on 2026-08-22 carry their counts.

<!-- Board impact: none to the contract. `PlanMetaSchema.rounds`, `Card.rounds`
     and `roundsBadgeText` all exist and work; what is missing is a writer. The
     plan format gains nothing new — the metadata block is already specified. -->

## Motivation

**Every layer of this is built except the one that produces the value.**

| Layer | State |
|---|---|
| `plot-plan-meta.sh` → `rounds` | parses the block, omits the key when absent |
| `PlanMetaSchema.rounds` / `Card.rounds` | on the wire, deliberately optional |
| `roundsBadgeText` in `PlanCard.tsx` | renders `1 round` / `N rounds` |
| **something that writes the block** | **nothing** |

Measured 2026-08-22 across all 90 plan files: **24 report a round count, and
every one of them was written between 2026-08-15 and 2026-08-17.** Nothing
since. The eight plans interrogated on 2026-08-22 — including two approved that
same day on the strength of those interrogations — report nothing.

**Where it shows, and where it does not.** `PlanCard.tsx:288` renders the count
as a neutral badge on the plan card — the Board tab, beside the phase. Measured
against the live board on 2026-08-22:

    cards on the board                91
    cards showing a rounds badge      24
    of those, in Released             24
    in any OPEN column                 0

Every badge on the board is on work that already shipped. **Not one open plan
shows one** — not the eight interrogated that day, not the two approved on the
strength of those interrogations. The badge is visible only where it can no
longer inform a decision, which is the defect stated exactly: the field is not
merely unwritten, it is absent precisely where it would be read.

**The field's design makes the silence worse, not milder.** `rounds` is
optional and *never defaulted to zero*, and the contract says why: *"`0 rounds`
reads as interrogated and found nothing; a missing block means nobody has
looked. Those want opposite reactions from a reader."* So an interrogated plan
and an unexamined one currently render identically, which is precisely the
confusion the field was designed to prevent.

### Why it stopped

`/plot:challenge-the-plan` — the **slash command** — specifies the record in
detail: a `CHALLENGE-THE-PLAN-METADATA` HTML comment holding `round`,
`questionHistory`, `deferredItems` and `categoriesCovered`, with instructions to
reconstruct state from it and write it back after each round.

`challenge-the-plan/SKILL.md` never mentions that block — zero occurrences in
this repo, in the user-level copy, and in the shipped
`plot-marketplace/plot/2.7.0` plugin, all three checked on 2026-08-22.

**It is not that the skill has no notion of a round.** It has nine: *"4
questions per round"*, *"Round 1: Surface Scan"*, *"Round 2+: Adaptive
Deepening"*, *"After each round, append new deferred items"*. The whole skill is
structured as a loop over rounds. What it never does is **persist the count** —
so the fix is a write step inside a loop that already exists, not teaching the
skill what a round is.

**Three artifacts assumed a writer that was never there.** The command
specifies the block in full. `plot-plan-meta.sh` documents `rounds` as read from
*"the `CHALLENGE-THE-PLAN-METADATA` block the skill writes"* — a sentence
written against behaviour the skill has never had. The contract designs the
optional-vs-zero distinction around a value it therefore never receives. Three
readers, one missing writer, and each of the three reads as though the gap were
somebody else's to close.

So the count did not degrade; it **stopped**, when the work moved from the
command to the skill. The command describes state persistence the skill never
implements, and the dates match exactly: the last plan with a count is
2026-08-17.

**It is a rule without a gate**, of the purest kind — the instruction lives in
one artifact and the work happens in another, so nothing can even notice the
omission. The reader cannot notice either, because a missing badge looks like a
plan nobody has challenged.

### What the absence cost, on the day it was found

Asked twice on 2026-08-22 which plans were safe to approve, the answer was
assembled by grepping plan prose for the string `Interrogated 2026-08-22` — a
convention invented that afternoon, in one session, unknown to every script and
to the board. The estate has a field for exactly that question and it was empty.

## Design

### The skill writes what the command specifies

`challenge-the-plan/SKILL.md` gains the step the command documents: after each
round, write or update the metadata block in the plan file. The block's shape is
not redesigned here — it is specified, parsed and tested already; what is
missing is the writer.

**One specification, two entrances.** The command and the skill must not hold
two descriptions of the same block, for the reason `/plot-approve` gives about
its own two entrances: the skill calls the mechanism, so both paths produce one
shape. The skill is the place the work happens, so the skill carries the
instruction and the command points at it.

**Write it even when a round finds nothing.** That is the case the optional
field exists to distinguish, so it is the case most easily lost: a round that
changes no decision must still increment the count, or the plan reads as
unexamined for having survived scrutiny.

### The eight plans of 2026-08-22 get their counts

A back-fill, and deliberately not an automatic one. Each of the eight was
interrogated once, in a recorded session, and the count is one — but the
`questionHistory` the block also carries cannot be reconstructed from prose
after the fact. So the back-fill writes `round` and leaves the history empty,
and says in the plan that it did.

**Six are on the default branch and get their block; two are not, and are named
rather than waited for.** Measured 2026-08-22:

| on `main` today | pending |
|---|---|
| the-plan-is-the-wave | an-approved-plan-offers-its-two-starts (PR #313) |
| waves-name-themselves | approval-hands-the-work-to-agents (PR #312) |
| a-folded-plan-says-what-it-hides | |
| done-means-delivered | |
| a-wave-is-one-branch | |
| a-dispatch-hands-over-a-brief | |

A branch cut from `main` cannot edit a file that only exists on an unmerged
branch, and coupling this wave to two PRs whose subject is unrelated would
block a five-minute edit behind somebody else's CI. The two are recorded here
by name; whoever merges #312 and #313 adds their blocks, or the next
interrogation of either writes one — which is the mechanism wave 1 delivers
anyway.

### What must not change

- **`rounds` stays optional and stays un-defaulted.** The whole value of the
  field is that absent and zero differ.
- **The parser is not touched.** It reads the block correctly today; 24 plans
  prove it. A parser change here would be fixing the half that works.
- **No gate on approval.** *Interrogated* is not a precondition for approving a
  plan, and this plan does not make it one — it makes the fact visible so a
  person can weigh it.

### Open Questions

- [ ] Should the block also record WHO ran the interrogation? The command's
      shape does not carry it, and the plan's `Approved:` line already names a
      person for the decision that follows.
- [ ] Does a second interrogation of an already-approved plan increment the
      count, or does the count belong to the draft phase only? Today nothing
      would stop it; nothing depends on the answer yet either.

## Branches

### Written

- `bug/the-skill-records-its-rounds` — `challenge-the-plan/SKILL.md` writes the
  `CHALLENGE-THE-PLAN-METADATA` block after each round, and the slash command
  stops duplicating the specification and points at the skill instead. Tests: a
  plan interrogated once reports `rounds: 1` through `plot-plan-meta.sh`; a
  second round reports 2 rather than replacing the block with a fresh one; a
  round that changes no decision still increments; a plan with no block still
  omits the key entirely rather than reporting 0; a malformed block is reported
  as absent, which is the parser's existing behaviour and must not regress. → #323

### Recorded

- `docs/the-six-say-they-were-challenged` — the six interrogated plans that are
  on `main` receive a metadata block with `round: 1` and an empty
  `questionHistory`, each noting that the history was not reconstructable. The
  two on unmerged branches are named in the plan, not blocked on. Tests: each of
  the six reports `rounds: 1` through `plot-plan-meta.sh`; **no other plan's
  JSON changes at all** — the 24 that already carry counts are untouched, which
  is the property that makes a hand-written block safe to add in bulk; a plan
  whose block was added reports the same `branches`, `prs` and `waves` as
  before.

## Notes

Found on 2026-08-22 while answering *"what else can we approve"* for the second
time — the answer depended on a field the estate already has and nobody fills.

The board was restarted during the same investigation: it had exited, most
likely when one of three running workers rebuilt `board-server.mjs` beneath it.
Unrelated to this plan, but worth recording next to it, since a board that is
not running is another way a visible fact becomes invisible.

**Interrogated 2026-08-22**, and the sharpest measurement came from asking where
the badge actually renders: 24 of 91 cards show one, **all 24 in Released, none
in any open column**. The field is not merely unwritten — it is absent exactly
where a reader would use it, and present only where the decision is already
made.

Three corrections. The skill is not silent about rounds: it says *round* nine
times and is structured as a loop over them, so the fix is a write step inside
an existing loop rather than a new concept. Three artifacts assumed the writer —
the command specifies the block, the parser's own docstring calls it *"the block
the skill writes"*, the contract designs the absent-vs-zero distinction around a
value it never receives — which is why nobody noticed: each reads as though the
gap belonged to someone else. And the back-fill covers six plans, not eight: two
live on unmerged branches, and coupling a five-minute edit to unrelated CI would
be the wrong trade.
