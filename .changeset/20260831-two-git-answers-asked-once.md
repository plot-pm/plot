---
'@plot-pm/board': patch
---

Two git answers that cannot change while a board runs — `rev-parse
--show-toplevel` and `symbolic-ref --short refs/remotes/origin/HEAD` — are asked
once per repository instead of on every request. Measured at 89 ms and 44 ms per
call, with `defaultBranchOf` reached from five sites. Nothing that reads
repository content is cached: `ls-tree`, `for-each-ref` and `show` answer
differently on every commit, and those calls belong behind the async `Refs` port
rather than in a cache.
