---
"@plot-pm/board": patch
---

challenge-the-plan: the skill writes the round count it was always read for

Every layer that surfaces a plan's interrogation count was built —
`plot-plan-meta.sh` parses `rounds` from the `CHALLENGE-THE-PLAN-METADATA`
block, `PlanMetaSchema` carries it, `PlanCard.tsx` renders the badge — except
the one that produces the value. Measured 2026-08-22 across 90 plans: 24 report
a count, every one written 2026-08-15 to 2026-08-17, none since, and on the live
board all 24 badges sit in Released — the field is present only where it can no
longer inform a decision. The count stopped exactly when the work moved from the
slash command (which specifies the block) to the skill (which never wrote it).

`challenge-the-plan/SKILL.md` gains **Phase 5b: Record the round** — a
read-modify-write of the metadata block at the end of every round, including a
round that changed no decision, because `0 rounds` (interrogated, found nothing)
and an absent block (nobody looked) are deliberately different and want opposite
reactions from a reader. The block is updated in place, never appended, since
the parser reads only the first `"round":` line it finds.

**One specification, two entrances.** The slash command stops duplicating the
block's description and points at the skill, where the interrogation happens and
the block is written — the same drift `/plot-approve` warns about with its own
two entrances.

The parser is untouched: it reads the block correctly today and 24 plans prove
it. `rounds` stays optional and un-defaulted all the way through.

<!--
bumps:
  skills:
    challenge-the-plan: minor
-->
