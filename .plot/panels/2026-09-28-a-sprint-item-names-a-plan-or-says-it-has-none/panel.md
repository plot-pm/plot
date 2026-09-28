# Panel — a sprint item names a plan or says it has none (#1045)

Subject: `docs/plans/2026-09-28-a-sprint-item-names-a-plan-or-says-it-has-none.md`
Round 1, 2026-09-28. Two jurors, all four commitments gated.

| Juror | Position | Evidence |
|---|---|---|
| evidence | amend | executed |
| consequence | amend | executed |

**Unanimous: amend.** Both executed. The consequence juror re-derived the evidence juror's central refutation before adding its own, so the agreement covers findings as well as verdict.

## The plan is scoped to a population that no longer exists

248 item lines across 16 sprint files:

| disagreement | count |
|---|---|
| issue-linked | **0** — emptied by `f6c7c9ef` |
| struck-through | **5** |

The plan writes 95 lines about the dead population and none about the live one.

## The live disagreement is a RELEASE GATE divergence

Verified by the moderator against `plot-sprint-release.sh`'s own output:

```
shell (reads the strike → plan Superseded → 'withdrawn') = withdrawn
TS    (slug "" → 'no-plan-named')                        = open
```

`workflows/release.ts:178-180`:

```ts
(i) => i.tier === tier && i.status !== 'done' && i.status !== 'withdrawn'
```

**`withdrawn` is excluded from `unfinished`; `open` is not.** The two readers therefore give opposite answers about whether a release is refused. Today the single live case is a Should and only warns. **Strike a Must and they disagree about a refusal** — against a comment in `release.ts` that already explains why this matters: *"gating on it blocks a release forever over work nobody is doing."*

The corpus test cannot see this: it excludes struck items from the **slug** comparison and never compares the scored state.

## The recommendation is self-defeating

```
ISSUE-ONLY MUST:  checked=true  shape1=done  shape2=disputed
```

`scoreItem` (`entities/sprint.ts:125-130`) returns `done` for a ticked `no-plan-named`. Under shape 2 the slug is looked up, always misses, and yields `disputed` — which `release.ts:179` counts as unfinished and whose refusal spells it out. **The sprint becomes uncloseable: the plan's feared outcome is a property of its own recommendation.** Both jurors reached this independently.

## Three corrections of fact

- **`.plot/templates/sprint.md` does not exist.** `ls .plot/templates/` → `plan.md` alone. Shape 3 has no template to teach the shape.
- **`plot-sprint-state.sh` parses no item reference.** `setSprintState` touches `sprint.items` once (`transitions/sprint.ts:260`) and reads the tier. A refusal would be the first write-path code to read a reference at all.
- **`skills/plot-sprint/SKILL.md:240` documents two forms**, neither `[#N](url)` nor `~~[slug]~~`. The live convention is as undocumented as the dead one.

**W40 would not pass shape 3.** Line 41 leads with a struck link; a rule saying *the first link must be a plan* either refuses it or carves out the strike explicitly.

## The pin was already failing

`corpus/sprint-item.corpus.test.ts:268` asserted `struckThrough === 4` against a live 5 — broken by this session's own withdrawal of the rejected plan, and fixed in `907eda9c` by moving the count and naming the fifth line. **The pin caught a population change on the day it happened**, which is what its comment says it exists to do.

The evidence juror called it *"a thing the slice will meet"*; it was already red.

## Third deferral this week, and it hid two things

The plan hands the slice three shapes and asks it to refute the recommendation. Both jurors note this is a legitimate deferral pattern — and that here the deferred question hid **the gate's existing answer** and **the extinct population**, neither a judgement call, both one command away.

## Amendments folded in

1. Re-scope to the live population, with the 0-vs-5 measurement.
2. The withdrawn/open gate divergence, with the `release.ts:178-180` rule.
3. The recommendation's self-defeat, measured.
4. The three corrections of fact.
5. W40's own failure under shape 3.
6. The pin's real state, and its repair.

## Unsettled, and named rather than closed

Whether a Closed sprint's items ever reach `release()`. Four historical strikes score `withdrawn` on one side and `open` on the other; if closed sprints are read, four releases passed a gate the two readers disagree about.
