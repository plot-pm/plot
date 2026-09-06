## Implementation brief — the-pulse-line-carries-the-delta (slice: The pulse reports it)

- **Plan (canonical):** `docs/plans/2026-09-05-a-pulse-says-what-changed.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `feature/the-pulse-line-carries-the-delta` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 3 of three, and **both dependencies have landed**: #730 (the scan writes `last-pulse.json`) and #733 (the delta rule), merged 2026-09-06.

## What this delivers

`/plot-pulse` prints the delta above its full report, and the fleet scan's pulse line carries the same answer.

## The rule already exists — consume it, do not rewrite it

Verified 2026-09-06 on `main`:

```
packages/domain/src/rules/pulse.ts:262   pulseDelta(...)
packages/domain/src/rules/pulse.ts:127   readingLoss(...)
packages/domain/src/rules/pulse.ts:299   const loss = readingLoss(previous, incoming, previousAt)
```

**This slice is the reporting half and nothing else.** The comparison is done. If you find yourself writing a diff, stop and read `pulseDelta` first — this repo has had **seven** plans this week propose something the estate already had.

## The four outcomes must stay four

`pulseDelta` distinguishes *changed*, *unchanged*, *first run*, and *history unusable*, and the rendering must not collapse them:

- **A first run is not a failure.** No file means nobody has pulsed here yet — the state every new adopter starts in.
- **An expired or version-mismatched pulse is a different fact:** there WAS history and it cannot be used.
- **Neither may render as *nothing changed*.** A quiet estate and an unreadable history look identical to a reader and mean opposite things. That is the whole reason the rule has four outcomes rather than three.

## The full picture stays

**The delta leads because it is what a returning reader wants; the picture follows because it is what a new one does.** The existing report is unchanged below it.

## Done when

- `/plot-pulse` leads with what changed
- a first run says so plainly, and `cannot say` never renders as `nothing changed`
- the full report below is byte-identical to today's
- the scan's pulse line carries the same answer as the command
- no diff logic is written in this slice
- `pnpm test` and `pnpm run test:reconcile` pass

## Do not

- **Do not reimplement `pulseDelta`.** It is in the domain and it is done.
- **Do not add a fifth reported fact.** The three the story names — a PR merged, a worker died, a plan became deliverable — were chosen by the story rather than by the data. A fourth gets added when somebody names the one they wanted and could not see.
- **Do not make the pulse write anything new.** `/plot-pulse`'s contract is that it derives and does not spawn; the record is the scan's write, and #730 built it.
- **Do not run `pnpm run test:e2e`.** CI is its gate.
