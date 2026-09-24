# Two readers disagree about a sprint item

> A bare `- [ ] task` under `### Must Have` is a Must to the release gate's reader and not a Must to the commit gate's. The same file, the same line: one counts two open Musts, the other refuses the commit saying the sprint names none.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #966
- **Rounds:** 1

## Changelog

- A sprint item written as plain text — the lightweight form `skills/plot-sprint/SKILL.md:240` documents — is an item to every reader of a sprint file. Measured 2026-09-24: one sandbox sprint, two bare Must items, read as `2 must items, both open` by `plot-sprint-release.sh` and refused by `plot-sprint-state.sh … Committed` with *"names no Must"*.

Board impact: **yes.** The board reads sprint membership and its counts come from the same tier reading; a shape one reader drops is a shape the board can drop.

## Motivation

**The issue reports a wording problem. The measurement found a parser disagreement, which is a different and larger defect.**

#966 says the refusal *"points at the headings"* when the headings are correct. That is true and it is a symptom: the message is the only thing a person sees, so a wrong cause reads as a wrong cure. Fixing the wording would leave the two readers disagreeing and make the disagreement harder to find.

**`docs/shell-and-domain.md` governs exactly this**: duplication is allowed and *undeclared* duplication is not — *"what makes it safe is not that one side is authoritative, it is that a test says they agree."* No test pairs these two, and they do not agree.

## Design

### What was measured, 2026-09-24

One sandbox sprint, `### Must Have` with two bare items:

```
- [ ] rename the deploy step
- [ ] update the runbook
```

| Reader | Answer |
|---|---|
| `plot-sprint-release.sh` (release gate's input) | **2 must items, both `open`** |
| `plot-sprint-state.sh … Committed` (commit gate) | **refused** — `commitment-empty`, *"names no Must"* |

**The discriminator is the bracket, isolated by varying one line and nothing else:**

```
- [ ] rename the deploy step                              -> refused
- [ ] [some-slug](../plans/x.md) — rename the deploy step -> commits
```

Same heading, same tier, same file. So the commit gate requires a markdown link; a plan slug is not needed, any link satisfies it.

### Which reader is right

**The release reader.** `plot-sprint-release.sh:234-236` matches the **checkbox alone**:

```bash
case "$line" in
  "- [ ] "*) checked=false ;;
  "- [x] "*|"- [X] "*) checked=true ;;
```

and treats the reference as optional — `if [ -n "$slug" ]; then delivered=$(plan_delivery "$slug"); else delivered=none; fi`. An item with no plan is an item whose state comes from its checkbox, which is `scoreItem`'s documented `no-plan-named` path.

**Three things agree with it and only the commit gate does not**: the skill documents both item forms (`SKILL.md:240`); `SprintItem.slug` is documented as `''` when the line names no plan, so the type models a bare item; and `isPromised` is `item.tier === 'must'` with no mention of a slug, so the tier is lost before that test rather than by it.

### Where the loss happens

`isPromised` (`entities/sprint.ts:138`) cannot be the cause — it reads a `tier` field. The line never becomes a `SprintItem` at all.

**`packages/board/src/server/entry/sprint-transition.ts:64`**:

```js
const MEMBER_LINE = /^- \[( |x)\] \[([^\]]+)\]\s*(.*)$/;
```

**The second bracket is mandatory.** `\[([^\]]+)\]` after the checkbox is not optional, so `- [ ] rename the deploy step` fails to match, `itemsFrom` (`:88`) skips it with `if (!m) continue`, and the sprint reaches `setSprintState` with an empty item list. The tier reading itself is correct — `TIER_HEADINGS` at `:52` maps the heading, and `:79`'s comment says *"the tier is the heading the line sits under"*, which is exactly the release reader's rule.

**Why a linked non-plan item still commits**: the capture is `[^\]]+`, any text in brackets. `[some-slug](../plans/x.md)` matches as surely as a real slug, which is why the W39 sprint's issue links satisfied it and the prediction that it would be refused was wrong.

### The trap in the obvious fix

Making the bracket optional is not sufficient. `itemsFrom:100-102` dedupes on the captured plan:

```js
const plan = m[2].trim();
if (seen.has(plan)) continue;
```

With the bracket optional, every bare item captures `plan: ''`, they all collide, and **a sprint of eight bare Musts becomes one item**. The dedup key must become the plan *where there is one* and the line's own identity otherwise.

**Measured, three lines — two bare and one linked:**

| `MEMBER_LINE` | items kept |
|---|---|
| as shipped | **1 of 3** |
| bracket made optional, dedup unchanged | **2 of 3** |

The naive fix improves the number without fixing it, and a test asserting only *"it commits"* passes on that 2. **The all-bare test must assert the count.**

### The shape of the fix

Make the transition's parser accept the same item set the release reader accepts: **the checkbox makes the item, the heading makes the tier, and the link is optional metadata.**

Then declare the pair. `packages/domain/corpus/` already holds `sprint-score.corpus.test.ts` comparing `scoreItem` against the shell's `item_state` — this adds the reading one level up: **do the two agree about which lines are items, and at which tier?**

### Why the message still changes, second

Once a bare item commits, `commitment-empty` stops firing on it and the misleading message stops appearing for this cause. **The refusal itself stays**, because a sprint that genuinely names no Must should still be refused — `transitions/sprint.ts:263`'s sentence is correct for the case it was written for.

### What this does NOT do

- **It does not make the slug optional in the release gate.** It already is.
- **It does not change `scoreItem`.** A bare item's state is its checkbox, which is existing documented behaviour.
- **It does not remove `commitment-empty`.** A sprint with an empty `### Must Have` must still be refused at commit.
- **It does not touch the struck-through `~~[slug]~~` handling** (`plot-sprint-release.sh:249`), which is a separate measured case with its own comment.

### The Open Question is answered: there are THREE readers, not two

**`board.ts:1148`** holds a second independent copy:

```js
const SPRINT_MEMBER_LINE = /^- \[( |x)\] \[([^\]]+)\]/;
```

Same mandatory second bracket, its own tier table, its own dedup. **So the estate parses one file format three ways**, and the plan's own title undercounts:

| Reader | Bare `- [ ] task` | File |
|---|---|---|
| `emit_tier` (release gate) | **an item** | `plot-sprint-release.sh:234` |
| `itemsFrom` (commit gate) | not an item | `entry/sprint-transition.ts:64` |
| `parseSprintMembers` (the board) | **not an item** | `board.ts:1148` |

**Fixing only the transition would land green while the board still drops bare items** — and the corpus pair as first scoped would not catch it, because it never asks the third reader.

### Done when

- A sprint whose Must Haves are all bare items **commits**, and a unit test pins it.
- **A sprint with an empty `### Must Have` is still refused** — the regression this must not cause.
- A corpus test pairs **all three** item readers on which lines are items and at which tier, and **fails on a disagreement rather than being adjusted to pass** — `docs/shell-and-domain.md`'s one forbidden move.
- **The board shows a bare-item sprint's members**, which it does not today. A fix landing in the transition alone is green and wrong.
- #966's message is accurate for the cases that still refuse.

## Slices

### The readers agree about what an item is (Branch: bug/the-readers-agree-about-an-item)

- `bug/the-readers-agree-about-an-item` — make the `[…]` group optional in **both** `MEMBER_LINE` (`entry/sprint-transition.ts:64`) and `SPRINT_MEMBER_LINE` (`board.ts:1148`), and re-key each dedup so bare items do not collide; **the key must not be the item text**, or two identical bare lines collapse and reproduce the defect in miniature. Unit tests asserting an all-bare sprint yields the right COUNT and commits, the board rendering its members, and the empty-Must regression; a corpus pair under `packages/domain/corpus/` comparing **all three** readers' item sets and tiers

## Notes

- Found while acting on #966 rather than by reading it: the sprint written for W39 was predicted to be refused, committed cleanly instead, and isolating why produced the two-reader disagreement. **The prediction was wrong and the sprint's own Notes record the correction**, because a plan estate that quietly deletes a wrong prediction teaches nothing.
- **Panelled 2026-09-24: `unanimous amend`, and both jurors verified by EXECUTION rather than reading** — the standard a sibling panel set the same day by rejecting a plan whose mechanism a five-line experiment disproved. The estate juror reproduced the two-reader disagreement on a scratch sprint, and measured the dedup trap exactly: **1 of 3 as shipped, 2 of 3 with the bracket optional, and 1 of 8 for eight bare Musts.**
- **No test covers a bare item.** All 15 relevant fixtures are `- [ ] [slug]`, and `sprint-members.test.ts:45` bakes the bracket into its own oracle — so the parsers' own suites could never have caught this.
- The issue's title — *"a message that points at the headings"* — names the symptom. Retitling it is worth doing when this lands; the heading is not the cause and a reader following the title will look in the wrong place.
- The gate guarding this lifecycle fired on this plan's own research: a `grep` naming the deliver script in a search argument was refused as a controller-owned action. That is #935, a Must Have in the same sprint, reproducing itself during the work.
