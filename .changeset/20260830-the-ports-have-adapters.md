---
'plot': minor
---

`@plot-pm/domain` gains its seven driven ports and their adapters.

`PlanStore`, `Refs`, `Host`, `Processes`, `Trees`, `Clock` and `Machine` are
declared as interfaces the domain owns, each with an adapter that reaches the
world through the shell scripts already doing that job — `plot-plan-meta.sh` is
still the plan-format contract, `plot-host.sh` is still the one place that
talks to a host CLI. A TypeScript adapter spawns and translates; it does not
reimplement.

**The exit-code contract lives in exactly one place.** `runScript()` maps
`0 → ok`, `1 → failed`, `3 → failed`, `4 → unaskable`. Seven adapters writing
that mapping seven times is how 3 and 4 collapse into each other, turning a
permanent configuration fact into a transient incident.

`plot-host.sh` gains one operation — *has any PR for this branch merged?* —
reading `mergedAt`, never `state` (a merged PR reports `CLOSED`) and never
ancestry (squash-merge leaves a branch ahead of main forever).

Two gates guard the layer: the purity grep, now excluding `adapters/`, and a
two-sided completeness check — at least seven ports, and every one with an
adapter. One-sided it would pass vacuously against the empty directory this
slice starts from.

Adapters are excluded from the package's 100% coverage threshold on purpose.
Their uncovered branches need a host to fail or a process to die at the wrong
moment, and a threshold that forces those to be faked teaches people to fake
them. What guards them instead is the purity grep and the corpus tests.
