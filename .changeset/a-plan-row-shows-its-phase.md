---
'@plot-pm/board': patch
---

A plan row reports the plan's phase whichever code path rendered it. Two arms project a PLAN row and only one set slot 5: the idea-branch arm the server emits spread its base and inherited `row.pr ? prStatus(row.pr) : stateStatus(row)`, and an idea branch's PR *is* the plan, so the ternary never reached the branch state. Measured on the live board 2026-09-09, three Draft plans read `PLAN an-adopting-repo-installs-its-gates 865 green draft 46m` — a fact about a build, in the slot that answers whether anyone has reviewed the plan. The phase was already on the wire as `AgentRow.phase`, the same field the client arm reads, so both arms now print the same word for the same plan and the rule `tupleFromPlan` states holds for every plan row rather than most of them. The word is `Discovery` rather than `Draft`: the field is the board's five-column partition, not the plan file's lifecycle state. A null phase keeps the PR's state, because null means the phase is unknown and deferring declines to overwrite a known fact with an unknown one where an unconditional assignment would blank a populated cell. The CI state is demoted rather than deleted — a red plan PR blocks its own approval — and needed no new code, since the row already renders the PR's state and draft flag as badges beside slot 5.

<!--
plan: docs/plans/2026-09-09-a-plan-row-shows-its-phase.md
-->
