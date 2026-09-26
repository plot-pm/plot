# board lens — a draft plan asks for a decision

Position: amend
Evidence: executed

## What I ran

The board answers on 7777. I read `/api/fleet` and `/api/board` live, and read
`working-agents.ts`, `AgentList.tsx`, `fleet.ts`'s two draft arms and
`schema.ts`'s `rounds` blocks.

## The claims that hold

**`brokenAgentRows` emits a non-branch WAITING ON YOU row — TRUE, and the plan
understates it.** `working-agents.ts:58` says what the plan quotes, verbatim, and
its subject is a registry entry rather than a branch. But the section already has
a THIRD non-branch source the plan never mentions: `AgentList.tsx:1000` renders
tracker issues into `waiting-on-you`, and `:990` states the rule in the plan's own
words — *"WAITING ON YOU is the section for what needs a human DECISION … No other
section can hold it: the row has no branch."* So the design premise is not "a
second instance of a shipped pattern" — it is a third instance of a pattern stated
twice in prose. That strengthens the plan; it should cite the issue row, which is
the closer precedent because an issue is a PLAN-SHAPED subject, not a process one.

**`/api/fleet` serves 0 rows without a branch — TRUE, measured.** 28 rows, 0 with
an empty `branch`. Worth noting the neighbouring fact: 3 of the 4 live `agents[]`
entries carry `branch: ''`, so branchlessness already travels in the payload on the
agent side.

**No collision with the `fleet.ts:4405` draft arm — TRUE.** I read it. It fires
inside `classify`, requires a branch by construction, and its `deferredReason`
override means a withdrawn Draft plan's branch routes to `quiet` instead. The
plan's "does not touch that arm" is correct, and its doubling guard (test the
branches, not the phase) is the right test.

## The claim that is false, and it is the plan's own scope claim

**"It adds no payload field" is WRONG.** The plan asserts `rounds` is "already in
the payload (`schema.ts:172`, `:410`)". Both line references are real and both are
the WRONG payload.

- `schema.ts:172` is `PlanMetaSchema.rounds` — the parser's shape.
- `schema.ts:410` is `CardSchema.rounds` — `/api/board`, the Plans tab.
- The Agents tab renders `AgentRow` from `/api/fleet`, and I confirmed live that
  payload carries no phase and no rounds anywhere: `rows[]` has no
  plan-phase field, `slices[]` is `{plan,name,branches,verdict,section,complete,
  planSliceCount}`, `estateTotals` is five counts. `planPhase` exists only as a
  server-side `classify` PARAMETER (`fleet.ts:4102`) and is never serialised.

So the row this plan wants needs two facts the client cannot see. That is a
payload change — at minimum a Draft-plan list on `FleetSchema` carrying slug,
plan file and `rounds`.

**And `schema.ts:413` forbids the shortcut the plan might reach for:**

> Carried on the CARD only. The agent row deliberately does not gain it: a row is
> a statement about one branch, and most rows name a plan whose design phase
> closed long ago — attaching a design-time count to all of them would be the
> crowding this board keeps removing.

A reviewer reading only the plan would put `rounds` on `AgentRow` and walk into a
documented refusal. The plan must say which shape it adds — a sibling collection,
not a field on the branch row — and cite `:413` as the reason it is not the latter.

## One more thing the premise overstates

The opening says a drafting plan "appears nowhere on the Agents tab", which is
true, and the Changelog implies the board is blind. It is not: `/api/board` serves
`Discovery: 5`, and both of this panel's subjects are in it carrying `rounds: 0`.
The plan's own "does not move the Plans tab's rows" concedes this, but the
motivation's framing (*"the board goes blind for the entire phase"*) is a stronger
claim than the measurement supports. It is one TAB that is blind. Say that.

## What to amend

1. Drop "It adds no payload field." Name the field: a Draft-plan collection on the
   fleet payload carrying slug, plan file and optional `rounds`.
2. Cite `schema.ts:413` and state that `rounds` does NOT go on `AgentRow`.
3. Cite the issue row (`AgentList.tsx:990-1000`) as the precedent, not only
   `brokenAgentRows` — it is a plan-shaped non-branch subject and the stronger case.
4. Narrow the motivation to the Agents tab; the Plans tab shows the plan today.

Everything else — the rule, the placement beside `brokenAgentRows`, the doubling
test, the rounds-reported-never-judged constraint, the four Done-when cases — is
sound and matches the code.
