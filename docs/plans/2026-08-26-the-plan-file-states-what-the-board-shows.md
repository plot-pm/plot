# The plan file states what the board shows

> A plan's interrogation is recorded where every other lifecycle fact is
> recorded — in `## Status`, visible to a person reading the file.

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

- A plan states its interrogation rounds in `## Status`, where a reader sees
  them. `/challenge-the-plan` writes the field; the parser prefers it and keeps
  reading the metadata comment for the 44 plans written before it.

## Motivation

### The measurement

**44 plans carry a `CHALLENGE-THE-PLAN-METADATA` block. All 44 hide it.**

Not one states its rounds anywhere a person reading the plan would see. The
number lives in an HTML comment below the last paragraph:

```html
<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  ...
END-CHALLENGE-THE-PLAN-METADATA -->
```

Every markdown renderer hides it. On GitHub, in an editor preview, in the board's
own plan view — a plan interrogated four times looks identical to one never
interrogated at all.

### The board says it and the file does not

Since #433 the Agents tab renders `2 rounds` as a badge beside the phase, and the
Board tab has rendered it for longer. So the board is the **only** place a human
encounters the fact, while Plot's stated design is that the plan file is the
source of truth and the board derives from it.

That inverts the direction for exactly one field.

### It is not a parser gap

Worth stating plainly, because the obvious diagnosis is wrong:
`plot-plan-meta.sh` **does** parse the block and emits `rounds`, deliberately and
carefully — `""` means *no readable round*, never zero. `board.ts:950` reads it.
The chain works end to end.

Nothing is broken. The fact is simply recorded where only a machine looks.

### Why it matters more than tidiness

The rounds count is the state of the discovery work. A reader deciding whether a
Draft plan is ready to approve wants to know whether it has been interrogated —
and the file they are reading to make that decision does not say.

The one plan whose block we read closely made the cost explicit in its own note:

> *Back-filled 2026-08-22: this plan was interrogated twice … the round count is
> recorded, but the questionHistory could not be reconstructed from prose after
> the fact, so it is left empty rather than invented.*

Someone had to reconstruct the count from prose because the plan never stated it.

## Design

### A `Rounds:` field in `## Status`

Where `Sprint:`, `Issue:`, `Story:`, `Review:` and `Impl:` already live:

```markdown
- **Rounds:** 2 <!-- interrogation rounds — written by /challenge-the-plan -->
```

Optional and absent by default, like `Sprint:` and `Story:`. A plan that was
never interrogated says nothing, which is the honest reading — and is NOT the
same as `0`, a distinction the parser already protects.

### The field wins; the comment still counts

`plot-plan-meta.sh` reads `Rounds:` when present and falls back to the metadata
block otherwise. Both, in that order, permanently:

- **44 existing plans** carry only the comment. A parser that stopped reading it
  would make 44 plans' rounds vanish from the board the day this lands.
- `/challenge-the-plan` writes the block as its own **resumable state** — it
  holds `questionHistory` and `categoriesCovered`, which the skill re-reads to
  avoid repeating questions across rounds. That is not a plan-format record and
  should not move.

So the comment keeps its job, and the field is added beside it rather than
replacing it. **No migration of the 44.** They gain the field the next time they
are interrogated, and read correctly until then.

### `/challenge-the-plan` writes both

At the end of a round it already rewrites the metadata block. It additionally
sets `Rounds:` in `## Status`, inserting the line after `Impl:` where the
template will declare it.

### Not chosen: migrate the 44 plans

A one-off script could back-fill every existing plan. Rejected: the parser
fallback makes it unnecessary, and rewriting 44 plan files to add a field none of
their readers has missed yet is churn against a repo where plan files are the
record. They gain it naturally on their next round.

### Not chosen: move `questionHistory` into `## Status`

Only the ROUND COUNT is a plan fact. The question history is a skill's working
state — verbose, sometimes empty, and meaningful only to the next interrogation
round. Putting it in `## Status` would make the section unreadable to serve one
consumer that already has what it needs.

### Not chosen: have the board write the field

The board can already display the number. Teaching it to write into plan files
would make it a producer of plan facts rather than a reader of them, which is the
inversion this plan exists to remove.

## Waves

### Stated (Branch: infra/a-plan-states-its-rounds)

`plot-plan-meta.sh` reads `Rounds:` from `## Status`, preferring it over the
metadata block and falling back to the block when the field is absent. The
template declares the field. Contract tests cover: field only, block only, both
(field wins), neither (absent, not zero).

### Written (Branch: infra/challenge-the-plan-states-its-rounds)

`/challenge-the-plan` writes `Rounds:` into `## Status` at the end of each round,
alongside the metadata block it already maintains.

## Done when

1. **A plan with `Rounds: 3` in `## Status` parses as `rounds=3`**, with no
   metadata block present at all.
2. **A plan with only the metadata block still parses**, unchanged — asserted
   against one of the 44. This is the item a fix that *replaces* the source
   fails, and it would silently blank 44 plans on the board.
3. **Field beats block** where a plan carries both and they disagree. They will
   disagree during the transition, and a reader trusts what the file says.
4. **Neither present → absent, not zero.** `0 rounds` reads as *interrogated and
   found nothing*, a rule `roundsBadgeText` already owns and this must not
   contradict.
5. **`/challenge-the-plan` writes the field** on a plan that has none, inserting
   it after `Impl:`, and updates it on a plan that already has one.
6. **The 44 existing plans are untouched** — no migration commit. Asserted by the
   diff: the wave changes scripts, template and tests, no `docs/plans/*.md`.
7. `pnpm test`, `pnpm run test:reconcile` green.

## Notes

### The board was right and the file was quiet

This plan exists because a reader asked, of a rendered board, *"but the plan file
does not state anything about it?"* — and was correct. The badge was real, the
parse was sound, and the file still did not say. A fact can be machine-readable,
correctly derived, honestly displayed, and still absent from the document that is
supposed to be its source.

### It is one instance, and the only one found

The other fields the board shows — phase, type, sprint, story, review, impl, and
every transition record — are all read from `## Status`. `rounds` is the single
exception in the parser's output. This plan closes that one gap rather than
proposing a principle.
