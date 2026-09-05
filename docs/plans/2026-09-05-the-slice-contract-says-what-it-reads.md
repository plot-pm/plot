# The slice contract says what it reads

> `DESIGN-slice.md` asks two questions about what the parser accepts, and both cite counts that have since moved. Re-measured 2026-09-05 across 474 slices: 24 hold more than one branch and 22 hold none. The contract is tightened to what a slice is; the estate is left as the record it is.

## Status

- **Phase:** Draft
- **Type:** infra
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches

## Changelog

- The plan parser reads a slice as one branch's work and reports a heading that is not one, rather than silently admitting both shapes.

<!-- Board impact: the board renders what the parser reports, so an empty slice
     that stops being a slice stops appearing as a row. -->

## Motivation

**Two open points in `DESIGN-slice.md` ask the same question from opposite ends** — *"Should an empty slice be a finding?"* and *"Is the 1:1 model enforced or relaxed?"* — and both are about what `plot-plan-meta.sh` accepts as a slice.

**EVERY COUNT IN THOSE POINTS HAS DRIFTED, AND THAT IS THE FIRST FINDING.** Re-measured 2026-09-05 over all 207 plans:

```
                        the docs say        measured today
total slices                    —                     474
slices with >1 branch     21 (slice §14)                24
                           8 (plan §15)
empty slices              11 (slice §14)                22
```

**Two docs disagree with each other about the same property** — `DESIGN-slice.md` says 21 and `DESIGN-plan.md` says 8 — and neither matches the estate. A number in a spec that nothing re-derives is a claim that decays silently, which is the same failure the sprint's goal is about.

**The estate is 207 plans, not the 158 those points were written against.**

## The decision

**Tighten the parser; accept the estate as it is.**

**A prose heading is not a slice.** Of the empty ones, the spec's own reading is that most *"are prose headings the parser should arguably not read as slices at all"*. A `###` under `## Slices` that names no branch is a section a human wrote for a reader, and admitting it as a slice puts an unworkable row on the board and an uncountable entry in every derivation.

**The multi-branch slices already shipped and are left alone.** `DESIGN-slice.md` says *"most already shipped"*, and rewriting a delivered plan's sections destroys `git blame` for the same reason the `## Slices` migration left delivered plans untouched. **The rule applies to what is written next, not to what was written before.**

**So the contract is tightened where it is read and not where it is stored.** The parser reports; nothing rewrites a plan file.

## What this is not

**Not a migration.** No plan file changes. The `## Slices` migration of 2026-09-04 is the precedent for what is *not* done here: it renamed headings in 182 files and deliberately left delivered plans' contents alone.

**Not a relaxation of the model.** 24 of 474 is 5%, and a fifth of those are on plans still open. The model holds; the parser stops being ambiguous about it.

**Not a board change.** The board renders what the parser reports. A heading that stops being a slice stops being a row, and nothing in the board decides that.

## Slices

### A heading with no branch is not a slice (Branch: infra/an-empty-slice-is-a-heading)

`plot-plan-meta.sh` stops reporting a `###` that names no branch as a slice, and the reconcile scan reports it as a finding instead.

**THE CONTRACT TEST IS WHERE THIS IS SETTLED.** `pnpm run test:reconcile` holds the plan-format contract, and 22 estate slices change shape under this rule — so the corpus is the gate, not a reading of one file.

**Done when** a `###` with no branch is reported as a finding rather than a slice, the 22 measured cases are accounted for, and `pnpm run test:reconcile` passes.

### The counts come from the estate (Branch: infra/a-spec-count-is-re-derived)

`DESIGN-slice.md` and `DESIGN-plan.md` carry the re-measured numbers, and both cite the same source.

**TWO DOCS DISAGREED BY A FACTOR OF THREE** — 21 against 8 for one property — and each was right when written. A spec's number needs a date and a command beside it, the way this repo's measurements already carry them.

**Done when** both docs carry the 2026-09-05 counts with the command that produced them, and neither contradicts the other.

## Notes

### Why the parser and not a lint — 2026-09-05

A lint reports and the parser decides. An empty heading that both the parser admits and a lint flags is a thing the estate holds two opinions about, which is the shape this repo keeps measuring as drift. The parser is the contract; it should not need a second opinion to be read correctly.
