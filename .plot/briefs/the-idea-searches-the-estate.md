## Implementation brief — the-idea-searches-the-estate (slice: Adoption searches for it)

- **Plan (canonical):** `docs/plans/2026-09-06-a-plan-greps-for-its-own-deliverable.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `feature/the-idea-searches-the-estate` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 2 of two. **Slice 1 merged as #744** — `Builds:` is parsed and reported today (`plot-plan-meta.sh` names it 29 times). This slice consumes it.

## What this delivers

`/plot-idea` step 3 searches the estate for each declared deliverable and reports what it finds.

**IT EXTENDS THE STEP THAT EXISTS.** *Duplicate detection* already runs there for plan slugs, with a stated reason for searching the plan directory rather than the index: *"A gate a missing symlink can bypass is a rule."* A deliverable search is the same act against a different corpus.

## Why this exists, measured

**Five plans in one week proposed something the estate already had:** `normalizeVersion` (10 callers), `check-host-cli-callers.sh`, reconcile scan section 7, `readingLoss`, `computeStatusDrift`. Plus a sixth that spent two interrogation rounds on a gate #706 had already moved.

**And the count kept rising while this plan waited.** This session alone found `pulseDelta` already built, `WriteBriefButton` already shipped, `/api/implement` already routed, and `transitions/branch.ts` landed the day a plan proposed its home. **Every one was found by a grep and none by a round.**

## What to search, and it is named rather than guessed

**`packages/*/src`, `skills/plot/scripts`, `scripts/`, and the reconcile scan's section headings** — the four places the five misses were hiding. A search over the whole tree matches documentation and comments, **and a check that fires on prose is one an author learns to skip.**

## The hard case is the one that beat a careful searcher

All five duplications are found by a plain grep **once the name is known**. That is not the hard case.

**`check-host-cli-callers.sh` was missed by a search for `check-*gh*`** — the plan said *gh*, the estate says *host CLI*. **A name-based search only works when the author already guesses the estate's vocabulary, and an author proposing a thing is precisely the person who does not know what it is called.**

**So the check expands the declared name.** `gh` also searches `host` and `host-cli`; a rule name also searches its bare noun.

## It reports and never refuses

**A plan may legitimately propose replacing something that exists** — two of the five were doing exactly that. The output names the file and line so the author can say *"yes, I am replacing that"*, which is the same posture as *Duplicate detection*'s title-similarity check one level up.

## Done when

- a plan declaring a deliverable that exists gets its file and line **before the plan is written**
- a plan declaring a new one gets silence
- a declared name is expanded to the estate's likely vocabulary, not searched literally only
- nothing is refused
- `pnpm test` passes

## Do not

- **Do not refuse a plan.** Report candidates; the author decides.
- **Do not search the whole tree.** Four named corpora; prose matches teach readers to skip the output.
- **Do not re-derive `Builds:`.** #744 parses it; read `plot-plan-meta.sh`'s output.
- **Do not infer a deliverable from the Done-when.** The plan rejected this: a Done-when is prose written for a reader.
- **Do not move the check to approval.** The plan settles this — the cost of a duplicated deliverable is paid in the writing.
- **Do not run `pnpm run test:e2e`.** CI is its gate.
