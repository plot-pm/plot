---
'@plot-pm/domain': patch
---

The domain's adapters are measured rather than excluded, and each threshold names its path and its reason.

`vitest.config.ts` held one blanket `src/adapters/**` exclusion. Four test files
were already exercising those adapters into a coverage report nobody could see.
Lifting the exclusion and running the existing suites — **no new tests** —
reports the estate as it is:

```
                          lines  branches  functions  statements
whole package             95.31     82.80      89.23       94.00
src/adapters/run-script  100.00     85.00     100.00      100.00
src/adapters/machine     100.00     85.71     100.00       93.33
src/adapters/plan-store  100.00     50.00     100.00       90.91
src/adapters/trees        89.66     72.22      87.50       87.50
src/adapters/processes    73.68     58.33      66.67       70.00
src/adapters/refs         72.73     40.00      75.00       65.52
src/adapters/host         63.89     12.24      35.29       57.50
src/adapters/clock        50.00      0.00      33.33       50.00
```

Each of those paths is now its own threshold entry carrying the reason its
number is not 100 — `clock` sits at a branches floor of **0**, which is the true
reading stated rather than assumed. Thresholds are the measured figure rounded
down with roughly five points of margin, because one pinned to today's exact
reading goes red on the next honest refactor, and a gate that fails on unrelated
work gets deleted rather than met.

**The warning the old comment made is preserved:** a threshold that forces
host-failure and process-death branches to be faked teaches people to fake them.
These floors are a ratchet, not a target, and they do **not** replace the two
protections that catch more — the purity-except-adapters grep and the corpus
tests that compare adapter readings against production's.

**Why the global numbers are no longer 100:** a vitest glob threshold is
additive. `resolveThresholds` adds every file to the global map regardless —
*"Global threshold is for all files, even if they are included by glob
patterns"* (vitest 4.1.11) — so a glob cannot exempt a path from the global
line. The global entry is now the whole-package floor, and the pure side keeps
its 100% through two explicit globs. It takes two because
`src/!(adapters)/**/*.ts` matches nothing at the top level of `src`, which would
have dropped `src/port-result.ts` out of the gate silently.
