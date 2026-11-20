---
'plot': patch
---

An in-process GitHub GraphQL call records a budget `op` that names its query, so `budget.tsv` shows which read spends the GraphQL pool. A pull request listing records `pr-list-<state>-graphql` for a repository read and `pr-list-<state>-since-graphql` for a windowed search, an issue listing records `issue-list-<state>-graphql`, and the search-type introspection records `pr-list-search-types` or `issue-list-search-types`. Before, every such row recorded `graphql`.

<!--
bumps:
  skills:
    plot: patch
-->
