---
---

board: a live worker keeps its row in WORKING

Measured 2026-08-17: two agents ran for a quarter of an hour with WORKING
empty, while WAITING ON YOU showed their branches. Both sections were
lying, in opposite directions.

Two rules were responsible, and neither was wrong on its own:

- The running-worker verdict lived inside the `state === 'claimed'` arm.
  A worker's first real commit takes its branch out of `claimed` — so the
  row **lost its place in WORKING at the moment it proved it was
  working**. It now sits beside the other three worker verdicts, covering
  every unmerged state. `merged` still excludes itself: a branch that
  landed is done whatever its worktree holds.

- The PR arm answered before any worker question. Right for a PR that is
  a person's errand — conflicts, failing checks, no checks, a state the
  host cannot read — and wrong for the rest: an agent that opened its PR
  and kept working was pulled out of WORKING by a green PR that asks
  nothing of anybody. A running worker now overtakes that arm **only**
  where `prAsksNobody` holds.

`prAsksNobody` is an allowlist — `green` or `pending`, plus a draft,
which is still the agent's own. A blocklist of errand-states would
silently start claiming "nobody is blocked" the first time a state was
added, which is the direction that fails quietly.

<!--
bumps:
  skills:
    plot: patch
-->
