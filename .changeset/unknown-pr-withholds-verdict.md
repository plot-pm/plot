---
"@plot-pm/board": patch
---

A branch row whose PR state is `unknown` now withholds its verdict rather than falsely claiming `eligible`.

When the origin cannot be asked (GitHub quota spent, Bitbucket unreachable, credentials missing), the PR state reads `unknown`. Previously, `classify` treated this identically to a branch with no PR — which computed its verdict from git alone and reported `eligible` if the wave was eligible. This was wrong: an unanswered question should not produce a computed answer.

Now, when `prUnknown` is true and the wave verdict would otherwise be `eligible`, both the group/note (set to `waiting-on-you` with `PR_UNKNOWN_NOTE`) and the verdict field (set to `null`) are withheld. The row still shows its wave, plan, and branch names — everything git answers — but it does not claim eligibility.
