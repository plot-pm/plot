---
"@plot-pm/board": minor
---

WORKING IS ABOUT AGENTS

The WORKING section now answers only one question: *which agents are
running?* Four agentless paths that previously routed to WORKING now
go to NOT STARTED:

| what is true | before | after |
|---|---|---|
| held by a worktree, no agent | WORKING | NOT STARTED |
| uncommitted work, no agent | WORKING | NOT STARTED |
| a write lock, no agent | WORKING | NOT STARTED |
| last commit N ago, no agent | WORKING | NOT STARTED |

Only branches with `worker === 'running'` or `worker === 'waiting'`
appear in WORKING. This makes the section title honest: it lists who
is working, not just where activity was observed.

Implements wave Inverted of `every-section-has-one-subject`.
