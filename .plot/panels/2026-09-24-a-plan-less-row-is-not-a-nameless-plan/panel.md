# Panel moderation — a-plan-less-row-is-not-a-nameless-plan

**Reconciliation: `unanimous amend` — estate, design.**

**Every claim the plan makes about the code is true**, and the estate juror reproduced all three wrongs by writing a throwaway vitest file over the real functions rather than reading them. What both jurors amend is what the plan did *not* look at.

## The open question was not open — the estate had already answered it

The draft offered three destinations for a plan-less row and picked none. **`fleet.ts:5039-5046` already routes exactly this population to WAITING ON YOU as `abandoned`**, through the domain (`quietNote`/`quietNeedsPerson` → `rules/quiet.ts`), with a comment naming it:

> real commits, no local activity, and … NO OPEN PR … **WAITING ON YOU, because it is the one kind that genuinely needs a person: revive it, or drop it.**

**The measured rows miss it by one line** — `fleet.ts:5033`, an age gate returning `not-started` for a recent tip before the rule written for them is consulted. Verified by the moderator.

**A second reader agrees independently**: `plot-reconcile-scan.sh:2243` section 19 collects the same population and names the actions. **Two readers, one answer, neither in the draft.**

## The guard exists too, and is five weeks old

`0de436190` (2026-08-16) — *"a group with no plan has nothing to head, and no count to hide in"* — is this plan's thesis, solved in the **sibling arm** and never applied here. Verified.

So the lever is the render site and the tally (`AgentList.tsx:1303-1366`), as `showPlanHeading` and `planHeads` already do — **not the grouping key the draft named.**

**This is the sixth plan today whose fix is *a rule exists and one caller does not use it*.**

## What running it added

```
groups:          [ { plan: "", n: 2 } ]
tallyNotStarted: { plans: 1, slices: 2 }    ← the exact rendered string
tallyQuiet:      { plans: 2, slices: 2 }    ← same rows, counted correctly
```

The tally defect is **confined to NOT STARTED** — `sections.ts:421`/`:436`, `countsPlans = section === 'not-started'` — which confirms the draft's claim that it needs no separate fix.

## A stale claim, corrected

The draft says the nameless head is *"visible on this repository's board right now."* **It is not**: checked live, 2 plan-less rows, both in DONE. True when the operator screenshotted it, false now — so the slice must build its own fixture.

## A factual correction to the layering

The draft called section placement *a domain property not yet extracted*. It is decided in **neither** the domain nor the component: `fleet.ts` assigns `group` server-side, and the rule that would decide correctly is reached only past the age gate. **The work is routing, not extraction.**

## The disposition

**Amend before building.** The mechanism, the numbers and the Done-when are correct as written. The citations, the lever and the open question were not.
