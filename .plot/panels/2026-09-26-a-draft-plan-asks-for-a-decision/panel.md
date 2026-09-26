# Panel — a draft plan asks for a decision

**One lens, amend, executed.**

## What holds

The precedent is real: `brokenAgentRows` already emits a WAITING ON YOU row whose subject is an **agent**, not a branch, so a non-branch row is a shipped pattern and not a change of subject. No collision with the `fleet.ts:4405` draft arm — the juror read it and confirmed it fires only where a branch row exists.

## The plan's own scope claim is false

*"It adds no payload field."* The plan cites `rounds` as already served at `schema.ts:172` and `:410`. Both line numbers are real and **both are the wrong payload**:

- `:172` is `PlanMetaSchema.rounds` — the parser's shape.
- `:410` is `CardSchema.rounds` — `/api/board`, the **Plans** tab.

The Agents tab renders `AgentRow` from `/api/fleet`, and that payload carries neither phase nor rounds. Confirmed live against the running board.

So the plan needs a payload field after all, and says it does not. That is the difference between a row source and a contract change — a larger slice than the plan claims, touching the schema both sides read.

## Recommendation

**Amend the scope.** Say the field is added, name where, and size the slice accordingly. The design is otherwise sound and the precedent argument survives intact.
