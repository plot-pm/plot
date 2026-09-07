# A sprint item has one scorer

> The domain declares `ItemStatus` and exports `scoreItem` to produce one. **Nothing calls it.** The shell computes the states, the release workflow takes them as an input it trusts, and the two implementations already disagree about an item with no plan.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-09-07, Jan Wloka, plan-PR #791 merged

## Changelog

- One rule decides what a sprint item counts as, in the domain, called by everything that asks — so a fourth status cannot be added to one implementation and missed by the other.

<!-- Board impact: none today; the board renders no item status. That is itself
     a finding — see Motivation. -->

## Motivation

**`scoreItem` reaches no production caller, and it takes two hops to see it.** `entities/sprint.ts:92` exports it; `transitions/sprint.ts:305` calls it correctly inside `openPromises`, whose own doc says *"the scoring is `scoreItem`'s rather than a second reading of the checkbox"*. **And `openPromises` is called by exactly one thing: a re-export at `index.ts:358`.** Five tests exercise it; nothing runs it.

**Round 1 corrected this plan's own opening sentence**, which said `scoreItem` had no caller at all. It has one, the caller is right, and the chain still ends in a re-export — which is worse than the simpler story, because a correct rule with a correct caller reads as wired to anyone who greps one level.

**The live rule is `item_state`**, 12 lines of bash at `plot-sprint-release.sh:73`, and it is what `/plot-release` step 0 actually runs.

**THEY ALREADY DISAGREE.** The shell takes `delivered` as a THREE-valued reading — `true`, `false`, `none` — and `none` means *this item names no plan, so take its checkbox at face value*. `scoreItem` takes a **boolean**: `none` is not expressible, so the domain cannot score an item the shell scores every run. Measured 2026-09-07: 0 of 8 items in the live sprint are slug-less, so the divergence is latent rather than firing — which is the worst kind, because it will fire on a sprint nobody is watching.

**AND THE RELEASE WORKFLOW TRUSTS A STATUS IT DOES NOT COMPUTE.** `workflows/release.ts:38` declares `status: ItemStatus` on its input and branches on `disputed` at `:172`. It never scores anything; it is handed a word. So the domain owns the **type** of the answer and not the answer, which is the shape the layering rule exists to prevent — and `release.ts` has no production caller either, so **three artefacts describe this lifecycle and one of them runs.**

**THE COST IS ABOUT TO BE PAID TWICE.** [`a-withdrawn-item-is-not-open`](2026-09-07-a-withdrawn-item-is-not-open.md) adds a fourth status. Against today's shape that is four edits — the enum, `release.ts`, the skill, and the bash — with nothing to catch a missed one, because the bash and the TypeScript cannot import each other and no test compares them. **A fourth state is exactly the change a single scorer makes safe**, and exactly the change that entrenches the split if it lands first.

## What this is not

**Not a rewrite of `/plot-release`.** Step 0 keeps calling `plot-sprint-release.sh` and reading its JSON. What changes is where the script gets its words.

**Not a new port.** The script already reads plans through `plot-plan-meta.sh`; scoring is a pure function over readings it already holds. **No I/O moves.**

**Not a claim that bash is the wrong home.** The shell is the right place to *gather* — it is what `/plot-release` can run without a build. It is the wrong place to *decide*, which is the Manifesto's own split: skills and scripts collect and report, the domain interprets.

## Slices

### One scorer, called by both (Branch: bug/a-sprint-item-has-one-scorer) <!-- waits: infra/a-shell-script-asks-the-domain -->

`scoreItem` becomes the only implementation, and `plot-sprint-release.sh` calls it.

**IT ABSORBS THE SHELL'S THREE-VALUED READING.** `planIsDelivered: boolean` becomes a reading that can say *no plan named*. The shell's `none` arm is behaviour the domain currently cannot express, and it is right — an item with no plan has only its checkbox, which `plot-sprint-release.sh:70` already states as a deliberate limit.

**THE SEAM IS NOT THIS PLAN'S TO CHOOSE.** [`a-shell-script-asks-the-domain`](2026-09-07-a-shell-script-asks-the-domain.md) states when a shell script calls the domain and where the call goes; this slice waits on it and uses what it says. **An earlier draft named `plot-ask.mjs` here** — written before `node` startup was measured at 39 ms, and before two sibling plans reached a different answer for scripts that run per pass.

**`plot-sprint-release.sh` IS THE AFFORDABLE CASE**, whichever way the contract lands: it runs once per operator command, like `plot-approve.sh`, which already pays a hop through `plot-transition.mjs`.

**A TEST COMPARES THE TWO ANSWERS ACROSS THE LIVE ESTATE.** The corpus tier exists for exactly this — `packages/domain/corpus/` compares adapters against production over the real repository. Every sprint item on the estate, scored both ways, asserted equal. That is what makes a fourth state a one-line change rather than a four-site hunt.

**`release.ts` KEEPS TAKING A STATUS AND STOPS BEING THE ONLY WAY TO GET ONE.** Its input shape is right — readings as values, per the domain's stated shape. What it must not remain is the sole typed description of a lifecycle nothing computes.

**Done when** `scoreItem` is the only place a sprint item's status is decided, `plot-sprint-release.sh` calls it rather than reimplementing it, the domain can express *no plan named*, a corpus test asserts the two agree over every item on the estate, and adding a status means editing one function.

## Notes

### Why this is not just "delete the dead function" — 2026-09-07

The tempting read is that `scoreItem` is dead code and the fix is `rm`. That inverts the layering rule: the bash would then be the sole owner of a domain decision, and `release.ts` would keep taking a status no domain function produces.

**The measurement that settles it is the disagreement.** Two implementations of one rule that already differ in a reachable case is not redundancy — it is a defect that has not been triggered yet. Deleting the one with tests keeps the untested one.

### The order matters — 2026-09-07

This lands **before** `a-withdrawn-item-is-not-open`, or that plan pays for the split: four edits with no gate, in a codebase where the two halves cannot import each other. After this, the same change is one function and one enum, and the corpus test fails if the shell disagrees.

### Round 1 — 2026-09-07

**The plan said `scoreItem` had no production caller. It has one.** `openPromises` at `transitions/sprint.ts:305` calls it, correctly, and documents why. What the plan got right is the conclusion and not the evidence: `openPromises` is itself reached only by a re-export in `index.ts`, so the chain is two hops long and still ends nowhere.

**That is a harder defect than the one first written.** A dead function is visible to anyone who greps it. A live function with a correct caller that nothing invokes looks wired from one level up — which is how it survived long enough for `item_state` to drift from it.

### Round 2 — 2026-09-07, challenging the sprint as a set

**Two plans in one sprint gave different answers to *how does bash call the domain*.** This one said `plot-ask.mjs`; `an-agent-state-has-one-deriver` measured `node` at 39 ms and concluded a per-pass hop is unaffordable. Both were right about their own script and neither knew the other existed.

**And three plans each proposed the same corpus test.** That mechanism is now [`a-shell-script-asks-the-domain`](2026-09-07-a-shell-script-asks-the-domain.md), and this slice is its first comparison — smallest rule, smallest shell function, plan already written.
