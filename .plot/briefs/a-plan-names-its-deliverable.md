## Implementation brief — a-plan-names-its-deliverable (slice: A plan says what it builds)

- **Plan (canonical):** `docs/plans/2026-09-06-a-plan-greps-for-its-own-deliverable.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `feature/a-plan-names-its-deliverable` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 1 of two, and slice 2 waits on it: `feature/the-idea-searches-the-estate` searches for what this slice lets a plan declare.

## What this delivers

A slice may carry a `Builds:` field naming the artifact it creates, and `plot-plan-meta.sh` reports it.

**This slice adds the FIELD and its parsing. It adds no search** — that is slice 2, and building both here would make one PR that changes the plan format and the adoption skill together.

## Why

**Five plans in one week proposed something the estate already had** — `normalizeVersion` (10 callers), `check-host-cli-callers.sh`, reconcile scan section 7, `readingLoss`, `computeStatusDrift` — plus a sixth that spent two interrogation rounds on a gate #706 had already moved. Every one was found by a grep and none by a round.

**And the pattern held while this plan was being briefed.** The brief for `a-spec-says-how-to-count` was about to specify a slice-shape counter; `uncut_slices=` and `prose_slice_names=` already sit in the reconcile scan's footer. That is the seventh.

## The field

**IT IS THE SLICE'S, NOT THE PLAN'S.** A plan builds several things and each slice builds one. A plan-level list is searched as a whole and reported against the wrong slice.

**OPTIONAL, EXACTLY LIKE `Sprint:` AND `Story:`.** A plan that builds nothing nameable writes nothing and is never nagged.

**IT MUST WORK IN BOTH SLICE DIALECTS, and this is the detail to get right.** `plot-plan-meta.sh:852` chooses per section:

```awk
slice_shape = (index($0, "(Branch:") > 0) ? "heading" : "list"
```

- **heading dialect** — `### Name (Branch: feature/x, PR: #577)`
- **list dialect** — `- \`feature/x\` — description`

**The template at `.plot/templates/plan.md:88` writes the LIST dialect**, so a `Builds:` that only works in headings would be absent from every plan created from the template. Decide one spelling that reads naturally in both and say so in the parser's header comment — annotations already bind to the line carrying the branch (`deferred:`, `claimed:`, `moved:`), which is the precedent to follow.

## The parser is the contract

**It reports 28 top-level fields today** — the plan says 27, and `rounds` was added since it was written. `builds` makes 29.

**The 29th field is a real cost paid by one consumer.** `/plot-idea` reads it; nothing else does. That is `Sprint:`'s and `Story:`'s shape, and neither has cost the estate anything.

**A plan without the field must parse exactly as it does today** — same keys, same values, `builds` empty. `test/reconcile/` holds the format tests and gains one.

## Done when

- a slice can name what it builds, in both slice dialects
- `plot-plan-meta.sh` reports `builds` per slice
- a plan carrying no `Builds:` parses byte-identically to today
- the template shows the field, commented, beside the existing `Waves:` guidance
- a `test/reconcile/` test covers present, absent, and both dialects
- `pnpm test` and `pnpm run test:reconcile` pass

## Do not

- **Do not implement the search.** That is `feature/the-idea-searches-the-estate`.
- **Do not make the field required**, and do not warn when it is absent. A docs plan, a rejection or a measurement builds nothing nameable.
- **Do not infer a deliverable from the Done-when.** The plan rejects this explicitly: a Done-when is prose, and a check parsing it either misses unusual phrasings or matches words that are not deliverables.
- **Do not backfill `Builds:` into existing plans.** The field is for plans not yet written.
- **Do not run `pnpm run test:e2e`.** CI is its gate.
- **`pnpm run typecheck` covers `@plot-pm/board` only.** If you touch the domain, run `pnpm --filter @plot-pm/domain exec tsc --noEmit -p tsconfig.json` — vitest passes where `tsc` fails.
