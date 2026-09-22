# A panel leaves a record

> `/plot-panel` produces verdict files and a moderation and writes no `Rounds:` field, so a plan four lenses rejected reads on the board as one nobody has questioned.

> **SUPERSEDED 2026-09-22 by `a-round-is-a-domain-fact.md`.** This plan proposed adding the write as an INSTRUCTION to `/plot-panel` step 5. That is a rule in CLAUDE.md's sense, and the estate already measured what rules are worth here: four panels ran that day and four writes were skipped. The successor makes it a controller call with five named refusals, one of which (`no-moderation`) is exactly what prose cannot enforce. **The diagnosis in this file stands and is the successor's evidence.**

## Status

- **State:** Superseded
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A plan that has been through a panel records it. The board shows a rounds badge from the plan's `Rounds:` field and a panel wrote none, so three plans questioned by four lenses each — two of them rejected outright — displayed as unquestioned. Measured 2026-09-22: four plans written that day, four panels run, zero `Rounds:` fields.

Board impact: none in code. The badge already renders from the field; what was missing is anything writing it.

## Design

### What was measured

Four plans written 2026-09-22, three of them put through panels of three or four lenses. Verdicts: two `reject`, one `amend`, and the rejections each named a defect that would have shipped.

**All four carried no `Rounds:` field**, and the template is explicit about what that means:

> **Absent means nobody has questioned the plan**; `0` says it was questioned and nothing came of it, so leave the line out rather than writing zero.

So the board told an operator the opposite of the truth about the three most heavily questioned plans on the estate.

### Why nothing wrote it

**`/plot-panel` is a mechanism and refuses lifecycle writes by design:**

> It moves no plan between phases, writes no `State:` line, and decides nothing about a plan's fate — it produces verdict files and a reconciliation **for a caller to act on**. `/challenge-the-plan` and `/plot-deliver` are the intended callers; both own their own decisions.

That refusal is right and must not be relaxed. **The gap is that the panel was extracted from `/challenge-the-plan` and the bookkeeping did not come with it.** `/challenge-the-plan` writes `Rounds:` itself — its own table lists *"Open Points + `Rounds:`"* as its output. The parallel counterpart produces the same evidence and records none of it.

**And a third caller exists that neither anticipated: a person, or a master agent, invoking `/plot-panel` directly.** That is how all four panels ran on 2026-09-22. The skill names two intended callers and there is nothing to stop a third, so *"the caller owns it"* leaves the record unwritten whenever the caller is not one of the two.

### Where the write belongs

**Not in `/plot-panel`.** Its refusal to touch the plan is load-bearing: the same mechanism serves `/plot-deliver`, where the subject is a delivered plan and a `Rounds:` increment would be meaningless.

**In the moderation step, which every caller performs.** `/plot-panel` step 5 already requires the caller to write `.plot/panels/<subject>/panel.md`. A panel that reconciled and moderated has, by definition, completed a round — so the instruction to record it belongs beside the instruction to write the moderation, in the skill that owns the moderation.

**The number is the count of panels, not of lenses.** Four lenses in one sitting is one round; the field answers *how many times has this been questioned*, and `/challenge-the-plan` counts its own four-question rounds the same way.

### What must not break

**`0` must never be written.** A panel that produced no findings still produced a reconciliation, so it is a round; and the template says `0` means *questioned and nothing came of it*, which a rejection emphatically is not.

**A plan that already carries `Rounds: N` is incremented, not set to 1.** A plan can face a panel twice — `a-waiting-loop-has-not-finished` is the rewrite of one that already had — and each is a round.

**The field is optional and stays optional.** A plan built without a panel carries none, which is the honest reading. `a-failed-tick-must-not-end-the-daemon` was built directly and correctly has no field.

**No phase moves.** Recording a round is not approval, and a rejected plan keeps `Rounds:` alongside its rejection note.

## Slices

### The moderation records its round (Branch: bug/the-moderation-records-its-round) <!-- deferred: superseded by a-round-is-a-domain-fact — the write becomes a controller call rather than a skill instruction -->

- `bug/the-moderation-records-its-round` — `/plot-panel` step 5 gains the instruction to write or increment the subject plan's `Rounds:` field beside the moderation, stated as the caller's act rather than the mechanism's; the skill names that a direct invocation is a caller too. `/challenge-the-plan`'s own write is untouched, and the shape is pinned by the unattended sweep that already checks every skill

## Notes

- Found by an operator asking why the board showed no rounds badge on plans that had just been through four lenses each.
- **The three plans from 2026-09-22 were back-filled by hand** before this plan was written, so the estate is correct today and the defect is about what happens next time.
