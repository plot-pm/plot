---
"plot": minor
---

A branch whose local worktree has uncommitted changes reads as **working** rather than quiet, with a note saying the evidence is local.

**Three agents were dispatched and all three were working; the board showed two.** The third branch had been claimed a day earlier and *resumed*, so its claim commit was 21 hours old while its work was minutes old. The row read `quiet · no commit for 21 hours` — a true note under a wrong heading, and the heading is the thing this tab does. QUIET carries an instruction: *go check whether it died.* Following it found a live agent with three modified files. That is the same mis-answer already fixed twice — merged branches reading as quiet, fresh claims reading as quiet — but with one difference: the earlier two were fixed with data the classifier already had, and here the refs genuinely do not know. An agent that has edited files and not committed has written nothing git can see.

**The scan already stands where the answer is.** `git worktree list --porcelain` names every worktree and its branch, and `git -C <path> status --porcelain` says whether the tree is dirty. Both are local, and `plot-fleet-scan.sh` runs on the machine that owns them. Its `--json` output gains two per-branch fields — `local_dirty` and `local_worktree` — and `classify()` uses the first for exactly one thing: to *lift* a branch out of quiet. The prose report is unchanged; it is a human interface, and the row this feeds lives in the board.

**Absent is not false, and that is what makes it additive.** On a machine with no worktree for a branch — every detached worker, every teammate's laptop, every CI run — the field is false and the branch answers from refs exactly as before. The signal is strictly one-directional: it may *add* an answer where this machine knows more, never downgrade one. Two people looking at the same fleet from different machines will see different notes on the same row, and that is correct, because they genuinely know different things. The fleet derives state from refs *precisely so* it works for workers elsewhere; keeping local knowledge one-directional is what lets both hold at once.

**The note says local, because a reader has to be able to judge it.** Work that has not been committed is also work nobody else can see, and a row claiming *working* on grounds the next person cannot verify would be its own kind of lie. It also declines to say *who*: git records no author on an uncommitted change, and on an `Impl: same branch` plan the person and the agent share one branch by design. So the note reports what was observed and where — *uncommitted work in a local worktree* — and a reader who recognises their own editor is not misled, where "agent working" would have misled them.

**Dirty, not present.** A worktree that exists but is clean is equally consistent with an agent that finished and one that never started, so it lifts nothing and shows nothing in the row. **Any state that would otherwise read quiet**, not only `claimed`: the motivating case was a resumed claim, but every quiet row on the board that day was `wip` with a three-week-old commit, and a dirty worktree means the same thing whatever put the branch there.

**Empty had to stop meaning two things.** A worktree directory can be deleted without `git worktree remove`, and the entry survives in `git worktree list`. `git status` there exits **128 and prints nothing** — so a check written as *"is the output non-empty"* reads "clean" and is right *by accident*. Two guards make empty mean one thing: `prunable` entries are skipped (the list already marks them, so running `git status` on a directory known to be gone asks a question answered a line earlier), and the **exit code** is read rather than the emptiness, because a failure to observe is not evidence of cleanliness.

**No cap, and the measurement is the reason:** 6.6 ms per worktree, so twenty cost ≈133 ms against a scan that already runs 500–1050 ms. A cap would be stock against a problem the numbers rule out, and caps drop results silently unless they also report saturation. The worktree list is read once per run, not once per branch — the same bundling the merge walk uses, for the same reason: the board polls every 5 s.

**The plan modal shows the local worktree path.** `git worktree list --porcelain` returns it beside the branch and the scan previously dropped it; keeping it costs nothing and answers a question the row cannot — *where is this checked out on my machine.* In the modal rather than the row, because a row is a triage line and already full, while a path is what you want once you have decided to go look. Shown for **clean** worktrees too: that is the one place the clean/dirty distinction inverts, and consistently so — dirtiness is evidence of *work*, presence is evidence of *location*, and the modal asks about location. A modal opened on a teammate's laptop shows no path rather than one that does not exist there.

<!--
bumps:
  skills:
    plot: minor
-->
