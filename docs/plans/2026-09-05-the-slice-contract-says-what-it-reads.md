# The slice contract says what it reads

> Two domain rules disagree about a slice with no branches. `eligible.ts:80` returns `complete` — finished work — and `deliverable.ts:75` skips it. Both shipped, and nothing has caught it because only Released plans carry the shape.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- A slice with no branches stops reading as finished work, and a slice naming several is reported rather than silently admitted.

<!-- Board impact: the board renders slice verdicts, so a heading that stops
     reading `complete` stops showing as a finished row. -->

## Motivation

**Two rules answer the same question differently, and one of the answers is wrong.**

`rules/eligible.ts:80`, the FIRST test in `sliceVerdict`:

```ts
if (readings.outstanding === 0) return 'complete';
```

`rules/deliverable.ts:75`, in the same estate:

```ts
if (branches.length === 0) continue;
```

**A heading with no branches has `outstanding === 0`, so `eligible` calls it finished work.** The check sits above every other test — above the approval test, above the phase test — so nothing downstream can correct it. `deliverable` skips the same shape entirely, which is the other reasonable answer, and the two have never been reconciled.

**THE CONSEQUENCE IS A PLAN THAT READS DELIVERABLE ON A HEADING NOBODY WORKED.** A slice is `complete`, the plan's outstanding count does not include it, and a `## Slices` section can be satisfied by prose.

**NOTHING HAS CAUGHT IT, AND THE REASON IS THE SECOND FINDING.** Measured 2026-09-05 across 474 slices in 207 plans:

```
empty slices        22   ALL on Released or Superseded plans
multi-branch        24   ALL on Released plans
active plans         0   of either shape
```

**Every instance is historical.** The disagreement is live in the code and dormant in the estate, which is exactly the shape of a defect that surfaces the first time somebody writes a prose heading under `## Slices` in a plan that has not shipped.

**Three places already special-case the shape** — `eligible.ts:80`, `deliverable.ts:75`, `board.ts:762` — each deciding for itself what an absent branch means. That is the drift this repo keeps measuring, in a rule rather than in a script.

## What this is not

**Not a migration.** No plan file changes. The `## Slices` migration of 2026-09-04 is the precedent for what is not done here: it renamed headings in 182 files and left delivered plans' contents alone.

**Not a refusal.** A plan naming three branches in one slice still parses, still renders, still dispatches. `plot-fleet-scan.sh` derives waves from those 24 slices today and `plot-merge-queue.sh` orders their branches — refusing them would take 24 Released plans off the board to enforce a rule about plans not yet written.

**Not an argument from the counts.** The counts drifted between the specs and this plan, and a third number would drift again. They are context; the rule disagreement is the defect.

## Slices

### An empty slice is not complete (Branch: bug/an-empty-slice-is-not-finished)

`eligible.ts` and `deliverable.ts` agree about a slice with no branches, and the agreement is a test.

**THE TWO ANSWERS ARE BOTH DEFENSIBLE AND THE SLICE MUST PICK ONE ALOUD.** *Skip it* treats the heading as prose the parser should not have reported. *Refuse it* treats it as a malformed slice that should be visible. What it may not be is `complete`, which asserts work finished that never existed.

**`outstanding === 0` IS THE LINE THAT NEEDS THE GUARD**, and its position matters: it is the first test in `sliceVerdict`, above the phase check, so nothing downstream can correct it. A slice with zero branches and a slice whose branches all merged are not the same fact and must stop sharing a return.

**`board.ts:762` IS THE THIRD SITE** and is a different question — it short-circuits when the whole estate has no branches — but it is where a reader looking for "what does empty mean here" lands third. Leave it; name it in the code so the next reader is not surprised.

**Done when** an empty slice does not read as `complete`, `eligible` and `deliverable` give the same answer for it, a test holds both, and `pnpm run test:reconcile` passes.

### A multi-branch slice is reported (Branch: infra/a-slice-names-one-branch)

`plot-reconcile-scan.sh` reports a slice naming more than one branch. Nothing refuses, nothing rewrites.

**A FINDING, NEVER A REFUSAL.** The scan already reports twelve kinds of drift by naming a file and a line so a person can judge; this is the thirteenth. The 24 shipped and the board still renders them.

**IT WILL REPORT 24 FINDINGS ON DAY ONE, AND THAT MUST NOT BURY THE OUTPUT.** The scan's footer is machine-countable and its sections gate selectively — section 5 gates, section 7 does not. This belongs with the ungating kind: it is a statement about how the estate was written, not a thing to fix.

**Done when** the scan reports a multi-branch slice with its file and line, gates nothing on it, and the footer counts it separately.

### The specs cite the command, not its output (Branch: docs/a-spec-says-how-to-count)

`DESIGN-slice.md` and `DESIGN-plan.md` stop carrying counts and name the command that produces them.

**THE NUMBERS WERE WRONG WHEN THIS PLAN FOUND THEM, AND A NEW NUMBER WOULD GO WRONG TOO.** `DESIGN-slice.md` said 21 multi-branch slices and `DESIGN-plan.md` said 8 — a factor of three apart, about one property, each right when written. The estate went 158 → 207 plans in weeks.

**A dated number invites the same decay one cycle later.** A spec that says *how to find out* cannot go stale: the reader runs it and gets today's answer.

**Done when** neither doc carries a slice count, both name the command, and nothing in either contradicts the other.

## Notes

### Why this is a bug rather than infra — 2026-09-05

The first draft of this plan was `infra` and argued from tidiness: two shapes, one contract, tighten it. The round found `eligible.ts:80` returning `complete` for work that does not exist, which is a wrong answer from a shipped rule. The counts are context; the disagreement is the defect, and the type follows it.
