# An interrogation leaves a record

> The board has a field for how many rounds a plan has been challenged, the
> parser reads it, the card renders it — and nothing has written it since
> 2026-08-17. Eight interrogations on 2026-08-22 recorded nothing at all.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** working-shows-the-agent
- **Story:** plot-planning-model
- **Review:** in-session
- **Impl:** own branches

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

`challenge-the-plan/SKILL.md` does not mention it. Not in this repo, not in the
user-level copy, and not in the shipped `plot-marketplace/plot/2.7.0` plugin —
checked all three on 2026-08-22, zero occurrences in each.

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

The eight: `the-plan-is-the-wave`, `an-approved-plan-offers-its-two-starts`,
`waves-name-themselves`, `approval-hands-the-work-to-agents`,
`a-folded-plan-says-what-it-hides`, `done-means-delivered`,
`a-wave-is-one-branch`, `a-dispatch-hands-over-a-brief`.

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
  as absent, which is the parser's existing behaviour and must not regress.

### Recorded

- `docs/the-eight-say-they-were-challenged` — the eight plans interrogated on
  2026-08-22 receive a metadata block with `round: 1` and an empty
  `questionHistory`, each noting that the history was not reconstructable.
  Tests: each of the eight reports `rounds: 1`; no other plan's JSON changes;
  the 24 plans that already carry counts are untouched.

## Notes

Found on 2026-08-22 while answering *"what else can we approve"* for the second
time — the answer depended on a field the estate already has and nobody fills.

The board was restarted during the same investigation: it had exited, most
likely when one of three running workers rebuilt `board-server.mjs` beneath it.
Unrelated to this plan, but worth recording next to it, since a board that is
not running is another way a visible fact becomes invisible.
