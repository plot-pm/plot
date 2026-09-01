---
'plot': patch
---

`DESIGN-machine.md` stops claiming a Machine has no identity. A Machine is a
Plot instance, several run on one computer, and the readings split between the
two — identity to the instance, headroom to the hardware.

The spec named its own falsifying condition: *"if there were two, headroom would
be a property of a pair and the whole entity would need a key."* Three Plot
projects run on this laptop, each with a `## Plot Config` and a `.plot/`, and
`hostname` returns `ani` for all three.

The identity is `hostname` + a short id hashed from `repoRoot + scriptsDir` —
the key `fleet.ts:646` already caches by. `basename(repoRoot)` is readable and
loses on the worktree case: six live worktrees here on 2026-09-01, every name a
branch name, so a basename id would rename itself with the branch and vanish
when the branch is reaped. Both axes are required because `repoRoot` and
`scriptsDir` vary independently (`index.ts:64-65`).

`parallelAgents` is documented as a claimed share of the computer rather than a
count of wanted agents, with a default that is not a measurement — only one of
the three instances has a `fleet-controls.json`. An unset share is still a
share. Nothing sums the three claims, and that gap is recorded rather than
solved: arbitration is not wanted.

No behaviour changes, `packages/domain` is untouched, and `Machine` is not
renamed to `Instance` — the meaning was never wrong, only the count.
