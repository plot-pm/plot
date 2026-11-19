---
'@plot-pm/board': patch
---

A spent GitHub GraphQL budget reads as a rate limit, not as an unreachable host. The in-process GitHub client now reads a GraphQL error of type `RATE_LIMIT` or code `graphql_rate_limit`, an untyped GraphQL error whose message names a spent rate limit, and a `403` that names one with no `x-ratelimit-remaining` header as `throttled`. Measured 2026-11-19: GraphQL answered `API rate limit already exceeded for user ID …` with REST and auth healthy, and the board said *"the git host could not be reached … This is not a rate limit"*. The fleet scan's branch walk now reads a `failed` refusal by its words (`refusalKindOfWords`), the scan banner names when the budget refills where the reset is known, and the Machine section shows `host rate-limited` instead of `host could not reach the host`.
