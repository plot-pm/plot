---
"@plot-pm/board": patch
---

board: the fleet-scan budget fits the scan it measures

30 s was right when the scan took ~10 s. After #262 batched the per-plan reads
the scan is **34-52 s** on this repo — 84 s before that change — so the budget
sat below the cost and every pulse was killed before its terminal line.

**The spread is the machine, not the code.** Measured 2026-08-20 with 12
worktrees and a load average of 8.35: a *bare* `git` spawn cost **63 ms**
against 31 ms on a quiet machine, and the same `rev-list` timed 14 ms, 85 ms and
111 ms on three consecutive runs. 203 spawns at 63 ms is ~13 s of process launch
before git does any work.

A fixed budget below the loaded cost fails **intermittently**, which is the worst
shape it can fail in: 60 correct rows arrived, the scan was killed before it
could say it had finished, `pulseComplete` stayed false, the banner never
cleared, and the footer read `60 branches across 20 plans so far`. Every word of
that was accurate and indistinguishable from a broken board.

**90 s is headroom over a 34-52 s cost, not cover for a 279 s one.** The raise
was refused twice earlier while the scan was 279 s, because a budget fitted to a
9× overrun hides the next regression instead of reporting it. The remaining
per-branch `rev-list` block — 64 calls, the last unbatched question — is the next
thing to remove, and this can come back down when it lands.

Only the fleet-scan call site changes. The generic `run()` default stays at 30 s:
every other command the board runs is a single host or git call, and those
finishing in under 30 s is still the right expectation.
