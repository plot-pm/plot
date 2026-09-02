---
'@plot-pm/board': patch
---

A CI gate keeps the `rmTree` conversion. A raw recursive `fs.rmSync` in a test teardown races whatever child the fixture left running, throws ENOTEMPTY, and `node --test` reports it as the last test failing — so a green suite depends on 157 converted sites staying converted. The gate counts them, because a conversion nothing enforces is undone one merge at a time.
