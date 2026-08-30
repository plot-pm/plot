---
'plot': minor
---

Five lifecycle workflows are expressed in `@plot-pm/domain` as
`readings → Decision | Refusal`.

`approve`, `deliver`, `reap`, `implement` and `release` each take readings and
return either a `Decision` naming every write it would make, or a named
`Refusal` saying which rule fired. **A `Decision` is inert** — it says *merge
PR #42, set Phase: Approved, write this record* and does nothing, which is what
makes every workflow testable end to end with no host and no repository.

`implement` and `release` have no script to compare against; they exist only as
skill prose, and are marked in the code as fixture-verified only rather than
borrowing the word the other three earn.

`dispatch` is deliberately absent — it is 2028 of the 3430 lines across the
scripted workflows and carries ~46 of the ~104 error paths, so it has its own
slice.

100% coverage on statements, branches, functions and lines: every refusal is
individually triggerable without a repository, and a refusal that cannot be
triggered in a test is one that was not expressed.
