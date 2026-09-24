# Panel moderation — the-fleet-sees-a-plan-on-its-own-branch

**Reconciliation: `unanimous amend` — estate, cost.**

**Every code claim in the plan is true**, verified by reading the cited lines and by running the scan. Nothing was inferred-and-disproved, and nothing has already shipped — the two failure modes the 970 panel found the same day. What both jurors amend is the *cost section*, and they amend it in the same direction.

## The cost numbers were quoted, not measured, and all three were wrong

| Claim | Drafted | Measured |
|---|---|---|
| scan cost | 18.3 s | **44.4 s** (moderator, quiet), 50 s and 58.8 s (jurors, loaded) |
| *"git alone is 12.7 s"* | quoted | **not reproduced** — 44.4 s wall against 9.3 s CPU is 21% utilisation |
| branches to walk | 54 | **15 remote refs, 3 prefixed** |
| the addition | "multiplies the git work" | **0.24 s — 0.4% of the scan**; one `ls-tree` is ~0.00 s |

**All three numbers came from `CLAUDE.md:198` and the script's own `--stream` rationale** rather than from a measurement the plan took. This is the third time today a quoted figure proved stale.

**The cost juror's reasoning is better than "you were wrong":** the scan being three times worse than believed makes getting the added cost right *more* important, not less — while the addition itself is cheap. The draft was cautious about the wrong thing, and its narrowing to PR-less branches was a fallback against a cost that does not exist.

## Two findings that change the slice's size

**"Copy the dedup" understates the work.** Four helpers — `ref_ls`, `ref_mode_of`, `ref_plan_file`, `PLAN_MODES` — are hardcoded to `origin/$MAIN`, including symlink resolution in ref-space at `:2569`, and all must become ref-parameterised to fit the one-invocation `parse_plan_estate` constraint at `:3002-3005`.

**An attribution gap was stated as solved and is not.** The scan walks outward from a plan's `## Branches` section (`:3820-3832`), not inward from branches. A ceremony-light plan that does not name its own branch becomes a visible plan whose branch stays a plan-less row — **#973's population, not this one's.**

## The honest negative

The estate juror tried to reproduce the symptom here and could not: only one branch carries files main lacks, and none of the three is a plan — no `State:` field, so `is_plan_phase` rejects them. **The plan already said so, and the juror confirmed the admission is accurate.** A plan that states its own unreproducibility correctly is worth noting when so many today did not.

## The disposition

**Amend before building.** The fix, its direction and the plan's framing — *the fifth ticket today whose fix is "one of two readers already does it right"* — all stand, and the estate juror calls that framing the strongest argument for it. What changes is what the implementer measures and touches.
