# A sprint item has one scorer

> The domain declares `ItemStatus` and exports `scoreItem` to produce one. **Nothing calls it.** The shell computes the states, the release workflow takes them as an input it trusts, and the two implementations already disagree about an item with no plan.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches

## Changelog

- One rule decides what a sprint item counts as, in the domain, called by everything that asks — so a fourth status cannot be added to one implementation and missed by the other.

<!-- Board impact: none today; the board renders no item status. That is itself
     a finding — see Motivation. -->

## Motivation

**`scoreItem` has no production caller.** `packages/domain/src/entities/sprint.ts:92` exports it, `test/sprint.test.ts` exercises it, and a search of `packages/` finds nothing else. The rule is written, tested, documented — and dead.

**The live rule is `item_state`**, 12 lines of bash at `plot-sprint-release.sh:73`, and it is what `/plot-release` step 0 actually runs.

**THEY ALREADY DISAGREE.** The shell takes `delivered` as a THREE-valued reading — `true`, `false`, `none` — and `none` means *this item names no plan, so take its checkbox at face value*. `scoreItem` takes a **boolean**: `none` is not expressible, so the domain cannot score an item the shell scores every run. Measured 2026-09-07: 0 of 8 items in the live sprint are slug-less, so the divergence is latent rather than firing — which is the worst kind, because it will fire on a sprint nobody is watching.

**AND THE RELEASE WORKFLOW TRUSTS A STATUS IT DOES NOT COMPUTE.** `workflows/release.ts:38` declares `status: ItemStatus` on its input and branches on `disputed` at `:172`. It never scores anything; it is handed a word. So the domain owns the **type** of the answer and not the answer, which is the shape the layering rule exists to prevent — and `release.ts` has no production caller either, so **three artefacts describe this lifecycle and one of them runs.**

**THE COST IS ABOUT TO BE PAID TWICE.** [`a-withdrawn-item-is-not-open`](2026-09-07-a-withdrawn-item-is-not-open.md) adds a fourth status. Against today's shape that is four edits — the enum, `release.ts`, the skill, and the bash — with nothing to catch a missed one, because the bash and the TypeScript cannot import each other and no test compares them. **A fourth state is exactly the change a single scorer makes safe**, and exactly the change that entrenches the split if it lands first.

## What this is not

**Not a rewrite of `/plot-release`.** Step 0 keeps calling `plot-sprint-release.sh` and reading its JSON. What changes is where the script gets its words.

**Not a new port.** The script already reads plans through `plot-plan-meta.sh`; scoring is a pure function over readings it already holds. **No I/O moves.**

**Not a claim that bash is the wrong home.** The shell is the right place to *gather* — it is what `/plot-release` can run without a build. It is the wrong place to *decide*, which is the Manifesto's own split: skills and scripts collect and report, the domain interprets.

## Slices

### One scorer, called by both (Branch: bug/a-sprint-item-has-one-scorer)

`scoreItem` becomes the only implementation, and `plot-sprint-release.sh` calls it.

**IT ABSORBS THE SHELL'S THREE-VALUED READING.** `planIsDelivered: boolean` becomes a reading that can say *no plan named*. The shell's `none` arm is behaviour the domain currently cannot express, and it is right — an item with no plan has only its checkbox, which `plot-sprint-release.sh:70` already states as a deliberate limit.

**THE SHELL REACHES IT THE WAY THE ESTATE ALREADY DOES.** `plot-ask.mjs` is the precedent and the seam: a built bundle, `node` and no running board, reached from a skill by one call. Do not invent a second mechanism, and do not make the script depend on a live board.

**A TEST COMPARES THE TWO ANSWERS ACROSS THE LIVE ESTATE.** The corpus tier exists for exactly this — `packages/domain/corpus/` compares adapters against production over the real repository. Every sprint item on the estate, scored both ways, asserted equal. That is what makes a fourth state a one-line change rather than a four-site hunt.

**`release.ts` KEEPS TAKING A STATUS AND STOPS BEING THE ONLY WAY TO GET ONE.** Its input shape is right — readings as values, per the domain's stated shape. What it must not remain is the sole typed description of a lifecycle nothing computes.

**Done when** `scoreItem` is the only place a sprint item's status is decided, `plot-sprint-release.sh` calls it rather than reimplementing it, the domain can express *no plan named*, a corpus test asserts the two agree over every item on the estate, and adding a status means editing one function.

## Notes

### Why this is not just "delete the dead function" — 2026-09-07

The tempting read is that `scoreItem` is dead code and the fix is `rm`. That inverts the layering rule: the bash would then be the sole owner of a domain decision, and `release.ts` would keep taking a status no domain function produces.

**The measurement that settles it is the disagreement.** Two implementations of one rule that already differ in a reachable case is not redundancy — it is a defect that has not been triggered yet. Deleting the one with tests keeps the untested one.

### The order matters — 2026-09-07

This lands **before** `a-withdrawn-item-is-not-open`, or that plan pays for the split: four edits with no gate, in a codebase where the two halves cannot import each other. After this, the same change is one function and one enum, and the corpus test fails if the shell disagrees.
