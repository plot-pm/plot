---
'plot': patch
---

Budget GitHub calls by bucket name, read from the response headers of calls that were going to happen anyway. GitHub meters `core` and `graphql` as independent 5000-request pools, and the record filed every call against one pool named `api` — so a spent GraphQL bucket and a full REST one summed to a number describing neither. `graphql_budget_spent()` now reads that record instead of `gh api rate_limit`, which was measured 2026-09-01 reporting graphql 5000/5000 used 0 while a real call's header read Remaining 1236, Used 3764, and reproduced 2026-09-02 against a header's 2732: the gate could not see the condition it gates on, so it reported safety while every `gh pr` call was refused. A spent bucket no longer stops the other, and a missing or unparseable header reads `unknown`, never free.

<!--
bumps:
  skills:
    plot: patch
-->
