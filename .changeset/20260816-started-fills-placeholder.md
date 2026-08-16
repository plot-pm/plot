---
"plot": patch
---

`/plot-dispatch` now writes its `Started:` record into the empty
`- **Started:**` placeholder the plan template ships, instead of appending it
after the last item in `## Status`.

The old rule found the last list item under the heading, which is correct only
if `Started:` is the final field — it is not, `Delivered:` is. So the record
landed below `Delivered:`, leaving a Status block that listed a start after a
delivery. Nothing failed loudly, because the parser reads the record wherever
it sits; both plans dispatched on 2026-08-16 had to be tidied by hand.

Plans with no placeholder (pre-Plot-2 files) keep the old append behaviour.
