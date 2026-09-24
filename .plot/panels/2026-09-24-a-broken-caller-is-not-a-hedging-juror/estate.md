# Estate lens — a broken caller is not a hedging juror

Position: amend

The defect is real, reproduced exactly as the plan states, and the fix belongs where the plan puts it. Amend for three things the plan's `Done when` does not cover, one of which is a **silent partial failure worse than the one being fixed**, and for a factual correction to the plan's own quoted error text.

## What verified clean

**`entry/panel.ts:139` — confirmed.** `const commitment: Commitment = { label, positions: positions.split(',') };`. The guard above at `:133` is exactly as described: `if (!label || !positions || !lens)` — a non-emptiness test only, so a one-element vocabulary is structurally valid.

**`rules/panel.ts:90` — confirmed.** `commitmentLine` is `` `${commitment.label}: <${commitment.positions.join('|')}>` ``.

**The reproduction, run here (2026-09-24), matches the plan line for line:**

```
check Position "proceed|amend|reject" j  → rc=3  uncommitted  'amend' is not one of proceed|amend|reject
check Position "proceed,amend,reject" j  → rc=0  committed    amend
```

**Exit vocabulary — confirmed at `entry/panel.ts:41-48`.** `ok: 0`, `usage: 2` documented as *"The arguments were unusable — a broken caller, not a hedging juror"*, `refused: 3`. The plan's claim that the contract already covers this and is simply not reached is correct.

## The teaching claim is fair, and stronger than the plan argues

The plan hedges this ("if that judgement is wrong..."). It should not. `<a|b|c>` *would* be innocuous usage notation — but the skill does not stop at notation:

- `skills/plot-panel/SKILL.md:86`: *"A Draft juror commits to `proceed|amend|reject`. A delivery juror commits to `supported|refuted`"* — pipes, in prose, as the vocabulary itself.
- `skills/plot-panel/SKILL.md:128`: `node .../plot-panel.mjs check "$LABEL" "$POSITIONS" "$LENS"` — `$POSITIONS` is never assigned anywhere in the skill, and **the comma form appears nowhere in SKILL.md at all.**

So the only rendering of the vocabulary a caller of this skill ever sees is pipe-separated, and the argument slot is an unbound variable. This is not a caller retyping usage notation — the skill supplies the pipes and supplies no counter-example. The plan's characterisation is fair; understated, if anything.

The one place the comma form is documented is `entry/panel.ts:19`, a TSDoc block inside the bundle's source, which no skill author reads.

## Finding 1 — the missed shape is a SILENT partial failure (the important one)

The plan's `Done when` covers `|` and fewer-than-two. It does not cover whitespace, and whitespace is measurably worse than the pipe case because it does not fail loudly:

```
check Position "proceed, amend, reject" f   (file: "Position: proceed")  → rc=0  committed  proceed
check Position "proceed, amend, reject" f   (file: "Position: amend")    → rc=3  uncommitted
```

`"proceed, amend, reject".split(',')` yields `["proceed"," amend"," reject"]`. The **first** position matches; every later one carries a leading space and `readJuror`'s whole-word comparison (`rules/panel.ts:152`) never matches it. A panel run this way reports every `proceed` juror as committed and every `amend`/`reject` juror as hedging — a gate that silently accepts one third of its vocabulary and refuses the rest.

The pipe bug at least fails uniformly and visibly. This one produces a plausible-looking panel that is systematically biased toward the first listed position. `"proceed, amend, reject"` is the natural thing to type. The plan's two rules do not catch it: it has three positions and no `|`.

**The amend:** trim each position and refuse any that is empty after trimming, or refuse any position containing whitespace. Either closes it; trimming is kinder and matches what the caller meant.

Other shapes measured, for completeness:

| input | `split(',')` | current behaviour |
|---|---|---|
| `a,,b` | `["a","","b"]` | accepted; empty position unmatchable, renders `<a\|\|b>` |
| `proceed,amend,reject,` | `[...,""]` | accepted; trailing empty position |
| `amend,amend` | `["amend","amend"]` | accepted; duplicate is harmless, no change needed |

The empty-string cases (`a,,b`, trailing comma) are the same defect class as the whitespace one and the same one-line fix covers all three. Duplicates are genuinely harmless — do not add a rule for them.

## Finding 2 — the plan's quoted error text is wrong in one detail

The Changelog (plan:13) and the measurement block (plan:34) quote the refusal as:

> `'amend' is not one of proceed|amend|reject`

That is correct **only by coincidence**. `rules/panel.ts:160` joins with `, `:

```ts
why: `'${claimed[...]}' is not one of ${commitment.positions.join(', ')}`
```

The pipes appear because they are *inside* the single element, not because the message uses them. Verified: `check Position "a,,b"` prints `is not one of a, , b`. The plan reads as though the error message itself renders pipes, which would be a third site in the collision. It is not — `commitmentLine` (stderr, `entry/panel.ts:145`) is the only pipe renderer. Worth correcting, because a reader auditing the collision would otherwise go looking for a renderer that does not exist.

## Finding 3 — no test covers `entry/panel.ts`, and the plan should say where the tests go

`packages/domain/test/panel.test.ts` (196 lines, 14 cases) covers `readJuror`, `readPanel`, `commitmentLine` and the path helpers. It is thorough on the **rule** and touches the **entry** nowhere. Nothing anywhere imports `server/entry/panel` except `contract/bundles.generated.ts`. So `run`, the `:133` guard and the `:139` split have zero coverage today — which is precisely why this shipped.

The precedent is unambiguous and the plan should name it: `packages/board/test/unit/` holds entry-module tests, including `sprint-transition.test.ts`, `release-gate.test.ts` and `stack-readings.test.ts`, all importing from `server/entry`. The slice says "unit tests" without a location; point it at `packages/board/test/unit/`.

## Layering — the fix is in the right place

Validating an argument's **wire format** is the entry's job, not the domain's. `Commitment` is a typed value with `readonly positions: readonly string[]`; by the time the domain sees it the comma is long gone, and pushing separator knowledge into `rules/panel.ts` would make the rule know about a CLI it deliberately does not know about (`rules/panel.ts:61-67` — *"THE VOCABULARY IS THE CALLER'S, AND THE MECHANISM DOES NOT KNOW IT"*). The entry parses; the rule judges. The plan puts it in the entry. Correct.

Its "does NOT touch `readPanel` or `reconcile`" scoping is right for the same reason.

**No prior art to follow.** Sibling entries (`main.ts:102`, `slice-spend.ts:158`, `prompt.ts:180`, `registryd-main.ts:791`) all validate arity only — presence of arguments, never their internal shape. Nothing in the estate already validates a positions-style list, so there is no pattern this must match and none it contradicts. The plan is not duplicating anything.

## On "Why not accept pipes as well"

Agreed, and the reasoning holds. A position is caller-supplied text; the delivery vocabulary is `supported|refuted` *plus the command it ran* (`SKILL.md:86`), so a position may plausibly carry punctuation. Two separators would make that ambiguous to save an error message. Refuse and name the repair.

But note the consequence the plan does not draw: **if a position may contain arbitrary characters, then "contains a `|`" is a heuristic, not a rule.** It is the right heuristic — no real vocabulary word contains a pipe — and it should stay. Just do not let it be the only guard, because the whitespace case slips past it.

## What to change before approving

1. Add to `Done when`: **a positions list with an empty-after-trim entry exits 2** — covering `a,,b`, a trailing comma, and (via trimming) `"proceed, amend, reject"`. This is the silent-partial-failure case and it is worse than the one the plan was filed for.
2. Correct the Changelog and measurement block: the refusal joins with `, `; the pipes in that output are the element's own content.
3. Name `packages/board/test/unit/` as the tests' home, following `sprint-transition.test.ts`.
4. Optional, and I would take it: drop the hedge in *"What this does NOT do"* about `commitmentLine`. `SKILL.md:86` and `:128` show the skill teaches pipes in prose with no comma form anywhere, so slice 1's usage line is not merely *an* alternative — it is the only place a caller will ever see the correct separator. Consider also fixing `SKILL.md:86`/`:128` to show `proceed,amend,reject` and bind `$POSITIONS`; the plan's own "a fix that only rejects pipes leaves that teaching in place" argues for it, and leaving the skill untouched leaves the next caller making the same mistake with a better error message.

Item 1 is the one that matters. Items 2-4 are accuracy and completeness.
