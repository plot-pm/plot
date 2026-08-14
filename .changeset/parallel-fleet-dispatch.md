---
"plot": minor
---

`/plot-dispatch`: fan one approved plan out across several agents at once.

One git worktree and one detached worker per eligible branch, each branch claimed atomically by a ref push. This is the point where Manifesto Principle 4 — "one plan, many branches; different people, different agents, different worktrees, all working on the same plan in parallel" — stops being a description and becomes a command.

Workers are **detached**, so the fleet outlives the dispatching session: start a fan-out, close the laptop, work continues. The command that runs them is configuration (`Worker command` in Plot Config), because how to run an agent headless is a per-project answer Plot must not hardcode. Without that key, worktrees are prepared and claimed and you start them yourself.

Fanning out is **human-paced**: `--dry-run` first, then a count, then `--max N`. Each worker costs tokens and produces a PR someone must review, so "all eligible" is never assumed.

Everything the dispatcher writes is idempotent or refused — a claim that would overwrite an existing branch is rejected (that rejection is the lock), existing worktrees are adopted rather than duplicated, and nothing is ever deleted. A dispatcher that dies halfway through a fan-out is safe to re-run.

`plot-fleet-scan.sh` gains `--list-eligible` for callers that need the whole claimable set rather than one branch.

`ralph-plot-sprint`'s "finish before starting" rule is restated, not weakened: it governs one runner's own attention. Several runners may work several branches concurrently, provided wave eligibility allows it.

<!--
bumps:
  skills:
    plot-dispatch: minor
    plot-fleet: patch
    ralph-plot-sprint: minor
-->
