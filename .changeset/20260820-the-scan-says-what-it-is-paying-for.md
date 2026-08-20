---
"@plot-pm/board": minor
---

board: a timed-out scan reports the estate that made it slow

`Last scan failed: timed out after 90000ms` names the symptom and hides the
cause. The scan spawns git once per branch per question, and every spawn reads
the ref database and the worktree list at startup, so a fat estate makes every
one of them slower — measured on this repo, 44 worktrees cost 56 ms per spawn
and a 105 s scan, 11 cost 31 ms and 63 s. The operator who sees only the timeout
cannot know that pruning stale worktrees would nearly halve it.

Now the timeout carries the estate: `44 worktrees, 54 branches, 56 ms per git
spawn`. Every number is measured, not estimated — the worktree count and the
branch count are counted, and the per-spawn cost is timed against this repo's
actual estate with five bare `git rev-parse --git-dir` spawns, the cheapest real
spawn there is. There is no fabricated spawn total: the board cannot count the
spawns of a scan it just SIGKILLed, so it reports the branch count it can
measure and lets the reader see the multiplier.

The report is a timeout's alone. A scan that failed any other way — a non-zero
exit, a spawn failure, a missing terminal line — keeps its bare message, because
the estate does not explain those. And a scan whose estate could not itself be
measured (a repo mid-rebase, a vanished worktree) keeps the bare timeout rather
than a half-filled sentence: an absent number is reported as absent, never as
zero.

No skill version bumps and `plot-fleet-scan.sh` is untouched: the scan is killed
at the budget, so it cannot report anything after the fact, and the measurement
that survives the kill has to be the board's. The `/api/fleet` payload gains no
field — the estate is appended to the existing `error` string, which the tab
already renders as `Last scan failed: …`.

<!--
bumps:
  skills:
-->

The estate report is board-side only. `plot-fleet-scan.sh` is deliberately not
changed: a SIGKILLed scan cannot append its own diagnosis, so the measurement is
taken by the board on the failure path, where the scan is already dead. The
`/api/fleet` schema is unchanged — the estate rides the existing `error` field.
