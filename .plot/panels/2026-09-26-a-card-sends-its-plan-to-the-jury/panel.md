# Panel — a card sends its plan to the jury

**One lens, amend, executed.**

## What holds

No script can invoke a skill (`plot-config.sh:72`), so the `Idea command` shape is the right one. `agent-panel.ts` exists and would collide on the word *panel*, so `Interrogate` is the right name. `/plot-panel` is unattended-first in its own SKILL.md. The write-gate test is real and the new route must join it.

## The claim that is false

*"The existing action-receipt mechanism already answers is this action in flight."* It does not. `action-receipt.ts:39` is the whole type:

```
export type ControllerAction = 'dispatch' | 'approve' | 'deliver';
```

Three actions, none of them a spawn action, and its purpose is not in-flight tracking. The plan's refusal *"a card already running a panel offers no second one"* therefore has **no mechanism behind it** — it is specified against a component that cannot answer the question.

The juror also names where the wanted mechanism does live: `idea.ts:369`, a different module.

## Recommendation

**Amend one refusal.** Point it at the mechanism that exists, or drop it and say two concurrent panels on one subject are possible. Everything else in the plan stands, including the measured argument against gating `Approve` on `Rounds: 0`.
