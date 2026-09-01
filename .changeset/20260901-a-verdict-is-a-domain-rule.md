---
'@plot-pm/board': patch
---

`startabilityVerdict` and `waveVerdict` are domain rules.

A verdict answers a question about a Slice — *may I start this branch?* — which
is a judgement rather than a rendering concern, and both lived in the board's
view layer. They move to `packages/domain/src/rules/verdict.ts` with the types
they produce, and `fleet.ts` re-exports them for the callers that already import
it. The board payload is unchanged.
