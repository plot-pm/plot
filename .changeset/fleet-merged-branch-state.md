---
"plot": patch
---

`plot-fleet-scan.sh` tells *merged and deleted* apart from *never started*.

`branch_state()` opened with one question — does `refs/remotes/origin/<br>` exist? Absence carries two meanings and the script silently picked one: a branch that never existed and a branch whose PR merged with its ref deleted at merge are the same missing ref, and both answered `open`, which the wave arithmetic reads as **outstanding**. A finished wave never completed, and the branch downstream of it stayed blocked.

That stopped being cosmetic when the gate got an automated reader. On plot's own repo, with both of `board-reads-git`'s PRs merged and both refs deleted:

```
$ plot-dispatch.sh --dry-run board-reads-git
summary: dispatched=2 reused=0 skipped=0 started=0
```

The entire completed plan would be re-dispatched. Nothing downstream stops it either — `plot-dispatch.sh`'s `exhausted` guard has exactly two triggers, both *contention* conditions, and neither fires here: the refs are gone, so each claim push **succeeds**, recreating the deleted ref and handing an agent a worktree whose diff is already on main. After the fix that same command reports `dispatched=0`.

Nothing local survives the ref — no reflog, no packed remnant. What survives is the merge commit on the default branch, so `branch_state()` asks one question before answering `open`: did this branch land? Candidates are what is **reachable** from the configured default branch, matched by an anchored subject:

```
^Merge pull request #[0-9]+ from [^/]+/<branch>$
```

A hit returns `merged` — already the state that settles a wave, so the arithmetic is untouched and no new state enters the vocabulary. Absence keeps `open`: the fix can only move a branch from `open` to `merged`, and only on positive evidence.

**The anchoring is the whole mechanism.** Of this repo's 119 reachable merges, eleven are *backward* merges (`Merge remote-tracking branch 'origin/main' into <branch>`) — subjects that also name a branch, with the opposite meaning. A name-only grep would read all eleven as merge evidence and report unfinished work as finished, opening the next wave on an unlanded seam. That inversion is worse than the bug being fixed. Measured: 0 of the 11 match the anchored pattern.

**Two structural filters were tested away, and tests now keep them out.** A second-parent counter-check does not discriminate — PR merges and backward merges both have a distinct second-parent tip, so it would have passed on all eleven traps. A first-parent filter measured well at "119 merges → 109 on the chain" but against the wrong baseline; compared with the anchored pattern it scores 108 to 108, catching nothing extra, and it breaks GitFlow — a feature merged via `develop` is not on the first-parent chain and would read `open` while its work is an ancestor of main.

The history is read **once per run**, not once per branch: `branch_state()` runs per branch and the board polls every 5 s, so the naive shape is O(history × branches) where O(history + branches) is available (197 ms vs 79 ms on a 2000-merge fixture). `MERGE_SCAN_LIMIT` is 2000 and **saturation is reported** — a blind cap re-creates this very bug, since at 300 against 2000 merges an early merge is not found and reads `open`.

The footer gains `merge_detect=pr-merge|truncated|none`, in the shape `plot-reconcile-scan.sh` already uses for `pr_source`. `open` must stop meaning both "never started" and "I could not tell", and `truncated` is its own value because a capped walk detected but not exhaustively. `none` marks a squash/rebase repo, where `open` says nothing about merging at all.

**The ref check stays in front, and a test pins it.** A branch name can be reused — merge `bug/flaky`, delete it, recreate it for a second attempt — and the first attempt's merge subject is still on main. That is stale evidence, and it is harmless only *by placement*: the lookup lives in the no-ref arm, and a recreated branch has a ref. Hoisting the merge check to the top of `branch_state()` is a natural tidying move that would silently report in-flight work as `merged`.

Detection reads git and nothing else — no plan `→ #<n>` annotations (the missing annotation and the missing delivery have the same cause; `board-reads-git` had both branches merged and neither annotated) and no host calls, which is what keeps the scan free enough to poll every 5 s.

<!--
bumps:
  skills:
    plot: patch
    plot-fleet: patch
-->
