---
"plot": minor
---

`plot-approve.sh` — approving no longer needs an agent

`Start work` on the board calls a script Plot ships and works out of the box;
`Approve` beside it called a per-project `Approve command` and did not, because
no such script existed. The justification did not survive the comparison:
`Worker command` is per-project because dispatch starts an agent that writes an
*implementation*, while approving under `Review: pr` is seven writes with no
judgement in any of them — merge the plan PR, flip the phase, fill `Approved:`,
clear the `.plot/hold` entry for each branch the plan names, update the sprint
annotation, push via `plot-push-main.sh`.

The script is **idempotent**, because step 2 merges the PR and that write cannot
be undone while everything after it is local. Every step tests the source it
would have written — `pr-state`, `plot-plan-meta.sh`, the hold file, the sprint
file — never a progress file of its own, so a run interrupted between the merge
and the push is repaired by running it again.

It refuses, with the reason reaching the caller, a plan that is not Draft, a
`Review:` other than `pr` (`in-session` and `ballot` need a human in the room),
and a PR that is draft, closed, or absent.

`plot-approve/SKILL.md` now calls it instead of describing it, and keeps only
what needs a reader: whether a draft is ready, the in-session walkthrough, the
ballot tally, the ceremony questions, and the tracer-bullet heuristic.

<!--
bumps:
  skills:
    plot: minor
    plot-approve: minor
-->
