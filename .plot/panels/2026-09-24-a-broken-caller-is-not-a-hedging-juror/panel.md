# Panel moderation — a broken caller is not a hedging juror

**Reconciliation: `unanimous amend` — estate, contracts.**

The defect is real, both jurors reproduced it line for line, and the fix belongs where the plan puts it. **Both independently found the same gap, and it is worse than the bug the plan targets.**

## The finding, verified by the moderator

`"proceed, amend, reject"` — the natural way to type a list — splits into `['proceed', ' amend', ' reject']`. Only the first entry lacks a leading space:

```
juror writes 'proceed'  → rc=0  committed
juror writes 'amend'    → rc=3  uncommitted
```

**Some jurors commit and others are refused.** The pipe case fails everyone loudly and reads as broken; this one produces a panel that looks legitimately split — **a divided verdict manufactured by an argument typo**, which a moderator would reconcile as a real disagreement.

The draft's rule — fewer than two positions, or a `|` inside one — catches neither condition: three positions, no pipe.

**Two jurors reaching this separately, from different reading positions, is the strongest signal this panel produced.**

## What the contracts lens cleared

Four things the plan asserts, each checked and confirmed:

- **No caller breaks.** Every existing caller passes commas, so nothing that works today starts failing.
- **No documentation is contradicted.** Exit 2's documented meaning already covers a broken caller.
- **`reconcile` is correctly out of scope** — it takes no positions argument.
- **The separator choice is right.** A position can never contain a comma; a pipe inside one works today.

That last point matters: the plan's refusal to also accept pipes was an argument, and a juror tested it rather than taking it.

## Where the moderator narrowed a juror

Estate proposed trimming. **Trimming alone is rejected**: it would accept the typo silently and change behaviour invisibly, which trades a loud failure for a quiet one. The plan now trims *and refuses* a position that was not already trimmed — the caller's error is named while the edit is still one character.

## The disposition

**Amend before building.** Everything the plan asserts survives. What changes: whitespace joins the validation, the slice's test asserts the partial-commit case explicitly with two verdict files and two positions, and the Done-when names it as the regression the first draft would have shipped.
