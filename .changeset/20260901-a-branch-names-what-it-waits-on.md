---
'plot': patch
---

A branch can name the one branch it waits on.

`plot-plan-meta.sh` parses `<!-- waits: <branch> -->` on a branch line and
reports it as `waves[].branches[].waits_on`, in both the `## Branches` list-item
spelling and the `## Waves` heading spelling. Parser and contract only —
nothing consumes the field yet, so its shape settles before the scan verdict
and the dispatch refusal both read it.

The key is **absent** where no annotation exists, never `""`. The board
distinguishes the two, and `waits_on: ""` reads as a prerequisite whose name is
blank rather than as a branch that declares none.

One prerequisite per branch, never a list. A slice needing two has not been cut
finely enough, and a list invites a dependency graph nobody wants to debug. A
line carrying two annotations takes the later one — the greedy read `deferred:`
and `claimed:` already use.

`waits:` and `deferred:` are independent and may share a line: a deferral is a
judgement, a wait is a fact a script can check.

The value is shape-checked against the branch prefixes, and that check is
load-bearing rather than defensive. A plan that documents the annotation writes
the literal marker in prose on a branch line, and no comment-aware reading tells
that apart from a real declaration. Measured 2026-09-01: without the check,
`2026-09-01-a-slice-can-wait-on-another-plan.md` reported `waits_on: "<branch>"`
for its own first slice.

The parser validates nothing beyond that shape. A `waits:` naming a branch no
plan declares still parses — the scan is what turns an unknown prerequisite into
a verdict, and a parser that refused it would hide the case the verdict exists
for. The whole estate parses byte-identically to the previous parser across all
188 plans.

<!--
bumps:
  skills:
    plot: patch
-->
