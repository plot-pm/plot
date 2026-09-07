# A shell script asks the domain

> Three plans in this sprint each propose a corpus test asserting the shell and the domain agree, and none knows the others exist. The mechanism is invented three times in the sprint filed against exactly that shape.

## Status

- **State:** Approved
- **Type:** infra
- **Sprint:** the-board-serves-a-team
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-09-07, Jan Wloka, plan-PR #788 merged
- **Started:** 2026-09-07, Jan Wloka, `infra/a-shell-script-asks-the-domain`

## Changelog

- One contract says how a shell script reaches a domain rule and how a test proves the two agree, so a plan that needs it depends on it instead of inventing it.

## Motivation

**Measured across this sprint's own plans, 2026-09-07:**

| plan | proposes |
|---|---|
| `an-agent-state-has-one-deriver` | *"a corpus test asserts the shell and the rule answer identically on every desk"* |
| `a-sprint-item-has-one-scorer` | *"a corpus test asserts the two agree over every item on the estate"* |
| `the-worker-loop-asks-the-domain` | *"the corpus test is the deliverable"* |

**Three plans, one mechanism, no cross-reference.** Each was written on a different day about a different rule, and each arrived at the same answer independently — which is evidence the answer is right and that nothing owns it.

**AND ONE OF THEM CARRIES A STALE SEAM.** `a-sprint-item-has-one-scorer` says the shell should reach the rule through `plot-ask.mjs`. That was written before **`node` startup was measured at 39 ms** and before `an-agent-state-has-one-deriver`'s round 2 concluded that a per-pass hop is unaffordable in `plot-worker-loop.sh`. **Two plans in one sprint give different answers to *how does bash call the domain*.**

**THE ESTATE ALREADY SETTLED THE HARD HALF AND NOBODY WROTE IT DOWN.** `plot-pr-merged.sh` is sourced by four scripts while `rules/reapable.ts` and `rules/queue.ts` answer the same question in TypeScript — *did this land*, the most consequential refusal here, **deliberately implemented twice**. What makes that safe is not that one is authoritative; it is that nothing lets them drift. **That is the contract, working, undocumented, and being rediscovered one plan at a time.**

## What this is not

**Not a decision that bash must call node.** The opposite: it names when a hop is affordable and when the two implementations stand with a test between them. `plot-ask.mjs` is the seam where a hop is right — `plot-approve.sh` and `plot-deliver.sh` already pay it once per run.

**Not a new test harness.** `packages/domain/corpus/` exists with four files and compares adapters against production over the live estate. This says how a rule-versus-shell comparison joins it.

**Not a rule about which side is authoritative.** Both answer. The test says they agree.

## Slices

### The contract is written and one comparison proves it (Branch: infra/a-shell-script-asks-the-domain, PR: #805)

A stated contract for shell-to-domain, plus the first corpus comparison built to it.

**IT ANSWERS THREE QUESTIONS AND NO MORE.** *When does a shell script call the domain rather than duplicate it?* *Where does the call go?* *How does a test prove a duplicate agrees?*

**THE COST RULE IS A MEASUREMENT, NOT A PREFERENCE.** `node` starts in 39 ms. A script that runs once per operator command pays it — `plot-approve.sh` already does through `plot-transition.mjs`. **A script that runs per agent per pass does not**, and `plot-worker-loop.sh` is the case that forced the question. The contract states the boundary in those terms so the next plan does not re-derive it.

**THE COMPARISON IS BUILT ONCE AND PARAMETERISED.** *Read every X on the estate, score it both ways, assert equal.* The four existing corpus tests already do this against adapters; a rule-versus-shell comparison is the same shape with a different pair.

**THE FIRST ONE IS `scoreItem` AGAINST `item_state`.** It is the smallest — 12 lines of bash, one function, eight sprint items on this estate — and its plan is already written. **Proving the contract on the smallest case is the point**; the agent state and the desk reset follow it.

**A DISAGREEMENT MUST NAME BOTH ANSWERS.** *"`the-scripts-say-slice`: shell=`open`, rule=`withdrawn`"* is actionable; *"1 disagreement"* sends a reader to find it.

**Done when** the contract states when a shell script calls the domain, where the call goes, and how a duplicate is held; one corpus comparison runs against the live estate; a disagreement names both answers and the subject; and the three dependent plans cite it rather than restating it.

## Notes

### Why this was invisible to the rounds — 2026-09-07

Each of the three plans was interrogated alone and each survived. **The defect is not in any of them** — it is that three correct plans describe one mechanism three times, and no round asks *what do the other plans say?*

**That is an argument for challenging a sprint as a set, not only its plans one at a time.** The measurement that found it took one grep across twelve files, and the rounds that missed it were thorough about everything else.

### What the estate proves about duplication — 2026-09-07

The contract's substance is already demonstrated. **`plot-pr-merged.sh` and `reapable.ts` answer the same question in two languages**, on purpose, because the shell needs an answer where node is too expensive and the domain needs one to reason with.

**The failure mode is not duplication. It is undeclared duplication** — `item_state` against `scoreItem` drifted on an item with no plan and nothing noticed, because nothing was watching the pair.
