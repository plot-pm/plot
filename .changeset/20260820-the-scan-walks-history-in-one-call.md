---
"plot": patch
---

plot-fleet: thin the per-branch history walk the ref/tree batching left behind

The plan this branch belongs to was scoped against a **459-spawn** scan and named
"the 68 per-branch `rev-list` calls" as the target. That number was measured
*before* its sibling (#262) landed. Re-measured on the same repo after #262, with
a wrapper counting every `git` invocation:

| | brief's premise | measured after #262 |
|---|---|---|
| git spawns per scan | 459 | **123** (prose) / 232 (`--json`) |
| `rev-list` spawns | 68 | **9** (prose) / 74 (`--json`) |
| total git time | dominant | **4.1 s** (0.73 s of it the one `fetch`) |
| wall clock | 105 s | **~15 s, under the 30 s budget** |

#262 did not only batch the ref/tree/plan reads — by collapsing them it shrank
the branch population the ancestry walk touches. The 68-per-branch `rev-list` the
brief set out to batch no longer exists, and the one clean batch form for
per-branch ahead-counts (`for-each-ref %(ahead-behind)`) needs git 2.41, above
the 2.38 floor this scan states its reasons for holding. So the brief's literal
mechanism is both unnecessary and, within the git floor, not available. What
remains is the per-branch tail #262 named as "the *next* ceiling," and this
change thins two provably-zero-cost spawns out of it — every verdict identical,
which the whole fleet suite pins.

**The dead `merge-base --is-ancestor` per `wip` branch is removed.** `branch_state`
reached it only inside the `ahead > 0` arm and asked "has the work already
landed?" — a question the `ahead` count above it had answered: a branch carrying
a commit `main` lacks cannot be an ancestor of `main`, so the call was false on
every branch that reached it and its `merged` was unreachable. The landed-work
case is still answered one level up (a fully-merged branch counts `ahead = 0`;
a merge that deleted the ref never reaches this arm). Removes one spawn per `wip`
branch — `merge-base` 6→14 in the sibling test's measurement, now 0.

**`local_ahead_of` no longer spawns for a branch with no local head.** In `--json`
mode (what the board polls) it ran `rev-list refs/remotes/origin/<br>..refs/heads/<br>`
once per branch — 64 calls on this repo, **25 of them** against branches living
only on another machine, where the missing `refs/heads/<br>` makes the walk exit
128 and answer 0. A one-call `LOCAL_HEADS` batch (the shape #262 gave the remote
refs) gates the spawn: an absent local head answers 0 without a process. `rev-list`
in `--json` mode drops 74→49 for the cost of one extra `for-each-ref`.

**Only the absent-head case is skipped.** A local head that *has no upstream*
(committed, never pushed) still spawns the walk and still reads its 128-failure
as 0 — the `a MISSING upstream is detected, not read as zero` invariant, which
the brief flagged as fragile and which stays green. The new test asserts the
*skip*, not merely the 0: a git-argv shim confirms the ahead query is never
issued for a branch with no local head, because a 0 alone would pass whether the
spawn happened or not.

The regression test now holds `merge-base` constant (0→0) alongside the batched
reads, so a reappearing per-`wip`-branch ancestry check fails the suite the way
a de-batched `show-ref` would — with every verdict still correct and nothing but
the clock to report it.

<!--
bumps:
  skills:
    plot: patch
-->
