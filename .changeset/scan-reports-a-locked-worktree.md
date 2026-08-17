---
"plot": minor
---

A worktree holding `.git/index.lock` reads as **working** — a write is in progress this instant — rather than being skipped in silence.

**The function that makes agents visible was the one that tripped over them.** Since #137 `plot-fleet-scan.sh` runs `git status` inside every worktree on the machine. When that call could not answer, the loop hit `continue`: the worktree was not reported at all, and the branch fell back to answering from refs exactly as though this machine had no checkout for it. The row then read *claimed, no commits yet* while an agent was committing to it. The branch that looked least active was the one being written to.

**Absent was the right instinct applied to the wrong question.** An earlier draft of the plan had the defect wrong and the measurement corrected it: the scan does *not* read a failed `git status` as clean. It already reads the exit code, and the file argues the rule at length — *a failure to observe is not evidence of cleanliness*. That half was shipped and correct. What was wrong is that a lock is **not a failure to observe**. It is the most informative state a worktree can be in: `.git/index.lock` means *an agent is writing here, right now*, which is precisely what the fleet view exists to show. The fact was computed, discarded, and replaced by silence.

**A third signal, because it answers a third question.** `local_locked` joins `local_dirty` and `local_ahead` under the same five rules, and none of the three is a flavour of another: *someone is editing*, *finished work nobody else can see*, *a write is in progress this instant*. Collapsing any pair would repeat the one-label-two-states defect this story keeps finding. Like its two neighbours it is strictly **one-directional** — it may only *lift* a branch out of quiet, never downgrade an answer — so a branch whose PR already answers keeps that answer, and `false` is what every branch on every other machine reports.

**The lock is observed directly, and that corrects the plan.** The plan expected a lock to announce itself by *failing* `git status`, so that reading the exit code would be enough. Measured on 2026-08-17, it does not: `git status --porcelain` exits **0** under a held lock in every ordinary condition — clean tree, modified file, staged change, untracked file, stale stat info. Git takes the index lock only when it decides to *write* a refreshed index back, which it skips whenever cached stat info already answers. The failure the plan was written from is real and **racy** — it reproduces when the index is stale enough to force a refresh-and-write, and not otherwise. Keying the signal on that exit code would report a lock on some runs and not others for the same worktree in the same state, and a flaky signal is worse than none: it teaches the reader to disbelieve the row. So the question is asked of the filesystem, where the answer is unambiguous.

**Locked stayed distinguishable from missing**, which is what the direct check buys. Both would otherwise fail `git status` with identical empty output, and collapsing them would recreate the very absence ambiguity the exit-code rule exists to remove — one label over two states, in a new place. They are now two independent observations: a vanished directory has no git dir to look in and reports nothing at all, exactly as before.

**No git call, because the filesystem already states it.** A linked worktree does not keep its index beside the repository's — `.git` there is a file reading `gitdir: <repo>/.git/worktrees/<name>`, and that is where its `index.lock` lives. Testing `$wt/.git/index.lock` would answer for the main checkout only and report every dispatched agent's worktree unlocked, which is the whole population this signal is about. `git rev-parse --absolute-git-dir` would answer both shapes and costs **14 ms** measured — against the 6.6 ms per worktree the sweep already accepts, so asking it per worktree would roughly triple the cost of the local signals to learn something a stat and a 50-byte read already say.

**It never retries and never waits.** A lock held through a rebase can last seconds, the next poll is 4 s away and will find it unlocked, and a scan that blocks on one worktree makes the pulse late for every branch on the board — a worse version of the defect being fixed. Reporting beats blocking, and the test asserts it by counting status calls rather than by timing, because a timing assertion cannot tell a retry that happened to be fast from no retry at all.

**The note says the lock alone.** Under a lock the reader is being told to *wait*, where *2 commits not pushed* tells them to act; saying both would give one row two opposite instructions. The other signals keep their own evidence — a locked worktree that is also dirty still reports both facts in the JSON, each on its own observation, because neither is derived from the other.

<!--
bumps:
  skills:
    plot: minor
-->
