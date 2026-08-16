---
"@plot-pm/board": patch
---

`fleet.ts` no longer carries a literal NUL byte.

It was the cache-key separator, and the choice is right — NUL cannot occur in a path, so it can never be ambiguous. Writing it as a raw byte rather than the `\0` escape is what cost: every line-oriented tool classifies the file as binary and then **answers nothing**. `grep` reports no matches without saying why; only `rg` names the reason. That cost three searches in one session which read as "not there" for constants present all along — and the obvious next move after such a search is to add code that already exists. Diffs and review views are blinded the same way.

Behaviour is unchanged (`node` confirms the escape produces the identical byte), and a test now walks `src/` and `test/` for raw NULs. The gate was proven by putting the byte back and watching it fail.

<!--
bumps:
  skills: {}
-->
