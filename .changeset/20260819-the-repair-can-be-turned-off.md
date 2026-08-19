---
"@plot-pm/board": minor
---

board: `PLOT_BOARD_REPAIR` turns the repair off without turning the board off

The artifact repair is the one automatic write in the whole system, and until
now it was gated on state alone. An operator who wanted to *see* artifact
conflicts without the board acting on them had exactly one way to say so:
stop the board. The design that introduced the repair called this switch
non-optional, and it was the one piece of that design nobody built.

**The default is on, and that is the point.** A switch that changes what
happens merely by existing is a behaviour change wearing a flag. Unset repairs
exactly as before, and that is asserted rather than reasoned — the assertion
matters because the failure is silent. Reading unset as *off* leaves the
parser's own tests passing while every real board quietly stops writing, which
from the outside looks identical to a repair that simply never triggered.
Measured against the mutation: it breaks fifteen assertions, and thirteen of
them are tests written before this change existed.

**Only `0` turns it off.** Not `false`, not `no`, not the empty string. An
operator who means to disable the repair and misspells the value gets a board
that still repairs — the safe direction, because the default is the tested
behaviour and this variable's job is to remove it deliberately, never to let a
typo in an environment remove it by accident.

**The switch subtracts and never adds.** `PLOT_BOARD_REPAIR=1` on a conflict
touching source is refused exactly as an unset one is. `isArtifactOnly()`
refuses any conflict set that is not exactly the artifact, and that refusal is
what licenses the write at all — the repair is a script rather than an agent
precisely because judgement's absence *is* the permission. A variable able to
overturn that refusal would take the permission with it, so the gate can only
ever answer *may this process repair*, never *should this branch be repaired*.

**Turning the write off does not turn the seeing off.** Detection and
classification are untouched: the row still names the conflict it will not
repair. An operator who silences the write and thereby loses the report has
swapped one blindness for another.

The gate stands **first**, ahead of every fence below it, because those record
state as they refuse — `inFlight` marks a branch as under repair, `notObserved`
remembers an input not to retry. A switch consulted after either would leave
the registries describing a repair the process promised never to start, and the
branch reported as under repair by a board that never touched it.

An environment variable rather than a `## Plot Config` key: `plot-config.sh`
describes the repo, while this is a runtime property of one board process, and
two boards on one checkout may legitimately disagree about it. Read once at
startup beside `PLOT_REPO_ROOT` and `PLOT_SCRIPTS_DIR`, never from inside the
pulse, so a repair started under one answer cannot settle under the other.
Turning it off takes a restart, which is the honest cost of a board that can be
trusted to have meant it.

`repairEnabled` sits on `BuildBoardOptions` rather than on the pulse's own
options because it describes the process the way `repoRoot` does — and because
that is what lets it reach `startRepair` down a call chain none of whose
signatures had to change to admit it.

<!--
bumps:
  skills:
-->
No skill version bumps: this is a board-side runtime switch only. No helper
script reads `PLOT_BOARD_REPAIR`, no skill prose decides anything from it, and
`plot-resolve-artifact.sh` is deliberately untouched — the script's own
refusals are the safety this gate sits above, not something it replaces.
