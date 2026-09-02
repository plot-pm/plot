---
'plot': patch
---

Report the reset the response headers carried, so a caller reacting to a refusal has a moment to wait for. `budget_rate` has always read field 9 to find the window boundary and has always dropped it, so `spend-rate` reported a rate, a limit and a remaining count and no reset — leaving the one component that needed it to ask `gh api rate_limit`, which was measured 2026-09-01 in a quiet moment reporting `graphql 5000/5000, used 0` while a real call's headers read `Remaining: 4854, Used: 146`. The reset that a caller waits for is the one still in the future, which is the opposite half of the fact the window boundary reads: that needs a reset already passed, because a future one says only that the window has not closed. An `unknown` reading reports no reset, and a record nobody has written reports none rather than an immediate one — absence is not permission to call now.

<!--
bumps:
  skills:
    plot: patch
-->
