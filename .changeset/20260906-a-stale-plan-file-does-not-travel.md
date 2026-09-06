---
'plot': minor
---

A `post-commit` hook records a commit that set a file to content that path already held, and says nothing otherwise. Twice on 2026-09-06 a commit reverted a plan annotation its author never edited; a third occurrence, `8d45eaca`, was found by this hook while it was being written and nobody had noticed it.

**It is an observation, not a gate, and that is the finding rather than a compromise.** Three explanations were proposed and all three disproved in sandboxes: an agent's push leaving a session's files modified (a remote commit moves neither tree nor HEAD), a second session sharing the checkout (a process sweep found one), and stage-then-pull-then-commit (git refuses to pull with a dirty index, in both modes). A gate needs a condition and every condition has died, so this writes evidence instead of refusing work — and proposes no fourth explanation, because a comment asserting one would outlive the evidence.

**The signature it looks for is per-file:** whether the blob just committed is one that path already held behind the commit's parent. Checked against both measured incidents, it names all four reverted plan files and stays silent on the two genuine edits committed beside them — a per-commit verdict would have indicted honest work. Over 150 recent commits on `main` it records 2.

**Cheap because it runs on every commit:** the commit's own name-status and a depth-bounded history per modified path, resolved in one `cat-file --batch-check`. It never fetches and never asks the host. Measured here at 0.67 s on the largest commit in 200 and 0.4 s on a typical one, against 3.0 s for the per-commit `rev-parse` fork it replaced.

**The log is bounded by day** — `.plot/state/commit-records/YYYY-MM-DD.jsonl`, the last 30 kept. The day is the unit because that is how a forensic record is asked for, and pruning whole days is one `rm` rather than a rewrite of a rolling file.

**Installing it is a decision the repo makes.** A git hook changes every contributor's machine and git ships none on clone, so `/plot-init` offers it only where the probe found a dispatch signal, and an existing `post-commit` is reported and never overwritten.

<!--
plan: docs/plans/2026-09-06-a-stale-plan-file-does-not-travel.md
bumps:
  skills:
    plot: minor
    plot-init: patch
-->
