---
'@plot-pm/board': patch
---

Remove three unused TF-IDF helpers that broke the board typecheck.

`46c3583e` shipped `topics.ts` with `tokenize`, `computeTf` and `computeIdf`
written but never called: `extractTopics` counts how many stories each term
appears in, and never computes TF-IDF at all. The TF-IDF path was abandoned in
favour of that simpler count, and these three were the remainder.

`noUnusedLocals` rejects them, so `main` failed `tsc --noEmit` and every branch
cut from it inherited the failure.

Deleted rather than silenced: keeping dead code alive behind a suppression
would preserve an implementation the file does not use and cannot reach.
`STOP_WORDS` still has seven other callers and stays.
