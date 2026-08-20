---
"@plot-pm/board": patch
---

board: the timeout report drops what it cannot measure

The timeout report named a cause and a remedy: `37 worktrees, 22 branches, 80 ms
per git spawn — the scan spawns git per branch, and every spawn reads this estate
at startup; pruning stale worktrees cuts both the count and the per-spawn cost`.
Acting on it falsified both halves. 26 of the 37 worktrees were pruned; the count
fell 70 %, the scan still took 97 s, and the figure the report promised would
fall rose 33 %, to 106 ms.

The probe could not have measured what its comment claimed. It timed
`git rev-parse --git-dir`, which prints a path — it reads neither the ref
database nor the worktree list, so it was timing how long this machine takes to
start a process, which is why it tracked system load and rose while the estate
shrank. The same run clocked `git --version`, a call that opens no repository at
all, at 2,037 ms.

The diagnosis was wrong at a level no better probe would fix: of a 131 s scan,
25 s was spent inside git across 96 spawns. 81 % of the time is not in git, so
neither the number of spawns nor what each spawn reads can explain the timeout.

So `perSpawnMs` is deleted rather than repaired, along with the causal sentence
built on it. Attributing spawn cost to an estate needs a second estate to compare
against and the board has only the one it runs in, which means there is no honest
version of the number available from here — the fix is removal, not a better
measurement. The timeout now reads `37 worktrees, 22 branches` and proposes
nothing: the reader learns the estate is large and the scan did not finish, which
is true, cheap to observe, and what a timeout report owes.

The counts stay because they were always measured. So does the rule that made
this a wrong *sentence* rather than a fabricated *value* — `measureEstate` still
returns `null` rather than a partial object, so a count that could not be read is
reported as absent and the bare timeout stands. Non-timeout failures still keep
their bare message. The timeout path is also two git spawns lighter, the five
probe spawns having gone with the number they fed.

Naming the plan the scan actually died in would be a real measurement, and
`--stream` already emits one line per plan, so it is reachable. That is recorded
as the follow-up: this change's job is to stop asserting a false cause, not to
find the true one.

<!--
bumps:
  skills:
-->

Board-side only, and no schema change: the estate rides the existing `error`
string. `plot-fleet-scan.sh` is untouched for the same reason it was untouched
when the report was added — a SIGKILLed scan cannot append its own diagnosis. No
skill bumps: no skill documented the per-spawn figure.
