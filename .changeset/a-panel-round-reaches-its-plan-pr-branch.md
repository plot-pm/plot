---
"plot": patch
---

`/challenge-the-plan`, run inside the detached worktree `POST /api/interrogate` prepares for a Draft plan read from its open plan PR, no longer discards the round: Phase 7b pushes the `Rounds:` increment, the Open Points section and the `CHALLENGE-THE-PLAN-METADATA` block back to that branch in one commit once Phase 5b/7 finish writing, detecting the detached worktree and its origin branch from git state alone (`git symbolic-ref`, then `git for-each-ref --points-at=HEAD`) and refusing by name — pushing nothing — if the branch moved while the round ran. A plan read from the ordinary `## Plot Config` checkout is unaffected: it still commits locally as before, with no push added where none was needed.

<!--
plan: docs/plans/2026-10-24-interrogate-cannot-reach-a-draft-plan.md
bumps:
  skills:
    challenge-the-plan: minor
-->
