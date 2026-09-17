# Panel round 2 — a-credential-is-read-where-a-repo-keeps-it

**Reconciled: `unanimous` — amend (adversary, threat-model)**

Round 1 broke the plan's parse. Round 2 broke its replacement, and found two
persistence paths the plan could not see.

## The replacement parse failed on a case the first fixture omitted

```
old order: ["plaintok"]      <- quoted AND trailing
new order: [plaintok]
```

The quote-strip ran before the whitespace-strip, so the `"$` anchor misses and
the value keeps its quotes — **which `curl -u` sends, producing the 401 this
plan exists to remove.**

**The fixture held a quoted value and a trailed value and never one that is
both**, while the `Done when` named both. A true measurement, too weak for the
gate written beside it — the same failure round 1 found, one iteration later.

The block in the plan is now **extracted and run** rather than read, and the
gate names every combination rather than one of each.

## Two persistence paths, one live and one latent

**The ledger's account field is a MATCH KEY**, not a label —
`plot-budget.sh:250` is `if ($2 != want_c || $3 != want_a) next`, and this
machine's record holds three distinct Jira accounts. **A constant redaction
would merge their rate windows**, so the redaction must stay per-account
distinguishable.

**`slots-file.ts:185` turns an account into a directory name** under
`~/.plot/state/slots/`. Jira does not reach it today because slots are keyed on
`prAccount`, the git host's. Verified — the directory holds `jwloka`,
`plot-pm`, `quatico`, `unknown`, and no email.

**That is why the redaction belongs at the source.** Fixing the one known writer
leaves the next to inherit the defect, and this path is one call away.

## What the lenses had in common

**Both asked where the value goes and neither asked what happens when it is
wrong.** A `.env` holding a STALE token authenticates with a credential the
operator believes they replaced; naming the source is what makes that
diagnosable, and **no gate pins it.** The plan says so rather than implying it
is covered.

## The moderator's reading

**Unanimous, and the fix survives.** What changed is the parse, the gate's
fixture, and the scope: a feature that widens who gets written down owns the
writing down.

**Nothing here moves the plan's phase.**
