---
'plot': patch
---

A budget record is named and keyed by connector, account and bucket — the entity slice 2 of `one-account-has-one-budget` exists to define. The key is a triple rather than a connector name because one account's limit is shared by every machine using it, and GitHub meters REST and GraphQL as separate buckets: a record keyed on the connector alone cannot express either fact. `budget-file.test.ts` asserts the record round-trips through its file.
