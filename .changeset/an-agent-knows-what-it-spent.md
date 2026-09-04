---
'@plot-pm/board': minor
---

An agent's context reading becomes a domain verdict. `contextTokensFromUsage` sums the three input fields a transcript turn carries — `input_tokens` and both cache fields, never `output_tokens` — and `contextVerdict` reads that against the agent's declared ceiling as `ample`, `spent` or `unknown`. No percentage crosses the boundary, for the reason `Machine` reports `Headroom` and not milliseconds: a threshold in a value is a threshold every consumer owns.

The window is declared rather than inferred. Measured 2026-09-04: a turn carries four token counts and the model's name, and no key in the transcript matches `window` or `limit` — so the numerator is measurable and the denominator is not. `CharterBounds` gains `contextWindow`, defaulting to `0` for unstated, and an agent that declares none reads `unknown`. That is the estate today, so nothing changes until a charter names a window.

A missing or unattributable reading answers `unknown`, never `ample`: `hasContextForAnotherSlice` and `agentIsSpent` both refuse it, so an unmeasured agent is neither given work nor declared finished. The board's transcript reader gains `contextSpend` beside the existing `contextTokens`, which keeps meaning `cache_read_input_tokens`.

<!--
bumps:
  skills:
    plot: patch
-->
