---
"plot": minor
---

The GitHub adapter chooses REST or GraphQL in one place, and no caller learns which. `gh_route` is that place: every GitHub op consults it once at dispatch and reads the answer, where before the choice was made inside `pr-state`'s backend arm and nowhere else, so the other ten GitHub ops spent blind. The cheap path is still the default — one GraphQL call against ~186 REST calls for a 93-branch scan — and REST still needs a reason. A structural test counts the calls to `graphql_budget_spent` and the reads of `PLOT_HOST_FORCE_REST` and requires one of each, inside the router; a second decision site fails the build rather than a review. One router per connector, not one for all of them: REST-versus-GraphQL is a GitHub distinction, so `bb`, `jen` and `jira` never reach it.

<!--
bumps:
  skills:
    plot: minor
-->
