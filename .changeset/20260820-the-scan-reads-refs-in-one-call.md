---
"plot": minor
---

plot-fleet: batch the reads that were asked once per plan and once per branch

The board showed `Last scan failed: timed out after 30000ms` through four rounds
of optimisation, all of which targeted host round trips. Measured with a wrapper
counting every `git` invocation: the host was already **one** `pr-list`, and the
scan spawned **459 git processes** at 56 ms of launch overhead each — roughly
24 s before git did any work.

**There was no hotspot**, which is why five rounds of hunting for one failed. The
distribution was 68 `rev-list`, 68 `ls-tree`, 67 `show`, 59 `show-ref`: about 8
spawns per branch across 54 branches, and the cost was the *spawning*. The cheap
suspects totalled 2 s of 105 — `fetch` 0 s, `pr-list` 1 s, all 54 ancestry walks
1 s together.

Three questions were asked once per plan or per branch, each with a batched form:

| | before | after |
|---|---|---|
| `show-ref --verify` | 59 | one `for-each-ref` |
| plan modes | 69 `ls-tree` | one `ls-tree -r` |
| plan content | 68 `git show` | one `cat-file --batch` |

**The plan reads were the whole win.** One `git show` of a plan blob cost
407-621 ms — variable because several worktrees were hitting one object store —
and 68 of them is ~31 s in a single call site, against a 30 s budget.
`cat-file --batch` read nineteen blobs in 559 ms, so reading *every* plan costs
about what reading one did. The other two batches cut 117 spawns and bought
almost no time; those calls were cheap.

**Measured end to end on this repo: 279 s → 43 s, 459 spawns → 208, and the
verdicts are identical** across 20 plans and 57 branches — compared field by
field, with one difference: `changed_ago_seconds` moved by the seconds between
the two runs. A clock, not a verdict.

**The `cat-file` framing is by byte count, not by pattern**, and that is why it
is perl rather than awk. `--batch` emits `<oid> blob <size>` then exactly
`<size>` bytes; a plan containing a line shaped like `deadbeef blob 42` would
desynchronise any split that matches the header instead of counting. Two earlier
attempts here did exactly that, and one wrote **nothing at all, silently** —
every plan fell through to the per-plan `show`, the spawn count stayed at 68, and
no error appeared anywhere.

**A per-branch tail remains and is not claimed to be fixed.** Measured at 6 vs
14 branches: `diff` 12→28, `rev-list` 12→28, `merge-base` 6→14, `merge-tree`
6→14, `log` 7→15 — seven spawns per branch, linear in the branch count. They are
individually cheap, so the tail is survivable and is the *next* ceiling rather
than this one. An earlier version of the regression test asserted "at most one
new spawn per branch" and failed against its own fix, because it asserted a
change nobody had made.

The new test holds the property that was actually established: the five batched
reads cost the **same** at 6 and 14 branches. Verified by mutation — against the
pre-change script `show-ref` reads 13→29 and the test fails; with the change it
reads 1→1 and passes. That regression could otherwise return with every verdict
still correct and nothing but the clock to report it.

Why this matters beyond one repo: on Bitbucket a single host call was measured at
~10 s against GitHub's 461 ms, and the board serves **no rows** without a
completed pulse — a fresh process has no previous one to fall back on. An
over-budget scan is an empty Agents tab, not a stale one.

<!--
bumps:
  skills:
    plot: minor
-->
