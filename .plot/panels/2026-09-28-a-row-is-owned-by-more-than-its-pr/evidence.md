Position: amend
Evidence: executed

# EVIDENCE lens — #1046, a row is owned by more than its PR

The defect is real and the diagnosis of the mechanism is exactly right. **Three
factual claims in the plan are false, and one of them is the claim the slice's
"smallest win" rests on.** The plan is buildable after it says what is true.

## What I ran

- Read `packages/domain/src/rules/ownership.ts` whole (the switch is at `:77`,
  `prOwnership` `:49`, `agentOwnership` `:64`, `isMine` `:96`).
- Read `packages/board/src/app/lib/agent-rows/mine-filter.ts` whole (`:86` is
  `ownedFromRow`, `:124` `rowsForReader`).
- Grepped the whole `app/` tree for `ownedFrom|OwnedRow|isMine|rowsForReader`.
- Grepped `assignee` across `packages/`, `skills/`, and the two live payloads.
- **Turned the rule on against the LIVE board** — `localhost:7777` answered
  `200`. Replicated `ownership` + `ownedFromRow` byte-for-byte in a scratch
  script over `/api/fleet`'s real rows, with the board's real reader
  (`hostUser: "jwloka"`, from `/api/board`'s `server` block).

## FALSE CLAIM 1 — `assignee` is not on a PR row, and is not on any row

The plan's sharpest sentence is *"`prOwnership` reads `author`. `assignee` is in
the schema and unread. That is the smallest change."* It is in the schema. It is
on a **different object**.

Both occurrences are plan-side:

- `contract/schema.ts:70` — inside `PlanMetaSchema`, the per-plan-file record
  `plot-plan-meta.sh` emits. This is a plan's `Assignee:` field.
- `contract/schema.ts:403` — inside `CardSchema`, the plan card.

`CardPrSchema` (`:262-311`) carries `number`, `url`, `checks`, `mergeable`,
`author` — **and no assignee**. `AgentRowSchema`'s inline `pr` object
(`:2595-2624`) carries `number`, `url`, `draft`, `state`, `states`, `author` —
**and no assignee**. The one server-side write is
`server/board.ts:2032`, `if (meta.assignee) card.assignee = meta.assignee` — a
plan's field onto a plan's card.

Measured on the live payloads:

```
occurrences of "assignee" in /api/fleet: 0      <- where rows live
occurrences of "assignee" in /api/board: 111    <- plan cards
```

`plot-host.sh` never fetches a PR assignee either: its six `assignee` mentions
are all comments saying Plot writes none, plus one Jira JQL
(`:4149`, `assignee = currentUser()`) for issue listing.

**So the consequence is the opposite of what the plan says.** The plan promises
*"No payload change — the facts it needs are already on the wire"* and *"It does
not add a fact to the payload"*, and lists assigned PRs as the population needing
no new concept. In fact assigned PRs require: a new host fetch, a new field on
`CardPrSchema` and on `AgentRowSchema.pr`, `fleet.ts`'s `PrRecord`, and the
Bitbucket/GitHub branch in `plot-host.sh pr-list --rich`. **The smallest win is
the largest of the five**, and by the plan's own `Done when` rule ("No new field
is added to the payload") it is out of scope entirely.

The same error applies to the other two facts in *"The facts are already on the
wire"*: `branches` at `:71` and `:88` are also `PlanMetaSchema`. Only `author`
at `:310` is genuinely a PR fact — and it is the one already read.

## FALSE CLAIM 2 — the agent arm is DEAD, not working

The plan says *"It does not change `agentOwnership`. Agent rows already work."*

`ownedFromAgent` (`mine-filter.ts:95`) has **zero callers**. Grep across
`packages/board/src/` and `packages/board/test/` returns only its own
definition. The only production path is `rowsForReader` (`:128`), which maps
**every** row through `ownedFromRow` — the ternary at `:86`, which emits `pr` or
`other` and never `agent`.

So `agentOwnership` is unreachable in production. Agent rows do not "already
work"; they are never asked. The live board confirms it: `/api/fleet` carries 4
registry agents, all `identity=manifest state=running`, which `agentOwnership`
would answer `mine` — and none of them passes through the filter, because
`AgentList.tsx:556` filters `fleet.rows`, and agents live in `fleet.agents`.

## FALSE CLAIM 3 — "the only three kinds in the row code" conflates two fields

The plan states *"Measured: the only three kinds in the row code are `agent`,
`pr`, `other`."* Those are `OwnedRow`'s three arms (`ownership.ts:36-38`) — the
rule's own union, which is true by definition and measures nothing.

The board's row kind is a different field. `RowKindSchema`
(`contract/schema.ts:1415`) is **eight** values:

```
'ticket', 'plan', 'pr', 'build', 'agent', 'branch', 'release', 'wave'
```

`AgentRowSchema.kind` (`:2369`) is that enum, and its own docstring at `:2355`
says *"see {@link RowKindSchema} for the seven"* — already stale by one.

**This answers the operator's fourth population directly: a `build` row DOES
exist.** `tuple-row.ts:1552` creates one and `:759` renders it. The plan's table
row *"builds — falls through"* is right about the outcome and wrong about why:
it is not an unrepresentable population, it is an existing row kind the mapping
discards.

## THE MEASUREMENT THE PLAN GETS RIGHT, AND ITS REAL SIZE

The plan says turning the filter on *"changes almost nothing — which reads as
broken."* I measured it. On the live board:

```
TOTAL ROWS: 17
ownership tally: {"mine":7,"theirs":1,"unknown":9}
ROWS THE FILTER REMOVES TODAY: 1 (5.9%)
hidden: [ 'release/changeset-release/main author=app/github-actions' ]
```

**The single row the filter removes is a BOT's release PR.** On a
single-operator estate the filter removes exactly zero human rows. "Almost
nothing" is correct and understated — and the plan should carry this number
rather than the adjective.

All 9 `unknown` rows are this operator's own `bug/*` branches. Every one would
answer `mine` under any honest branch rule, so the filter's visible behaviour
would not change on this estate even if branches were classified. **The plan
should say that the defect is most visible on a multi-operator estate**, which
this one is not — `fork/*` refs are Max Albrecht's and carry no rows.

## WHAT EXECUTING REVEALED THAT READING WOULD NOT

Two things.

**The row carries no human-naming field except `pr.author`.** I enumerated every
key present on the live rows:

```
ageMinutes, blockedBy, branch, branchUrl, brief, briefAskedAt, changedAgo,
changedAt, deferredReason, findings, group, kind, localAhead, localDirty,
localLocked, note, phase, plan, planFile, pr, processes, quietKind, repair,
repo, sprint, startability, state, stuck, supervisionCause, verdict, version,
waitingDays, waitingOn, wave, worker, worker_activity
```

No `assignee`, no `author`, no committer, no owner. **Every one of the four
unclassified populations needs a new payload fact** — not just branches, as the
plan's Design section claims. That reverses the plan's ordering advice: there is
no population that is cheaper than the others because its fact is already there.

**The git author cannot answer "my branches" on this estate.** I read
`git log -1 --format='%an'` across the remote refs: every `origin/bug/*` branch
reports `Jan Wloka`, because dispatched agents commit as the operator. So the
last-committer option the plan floats for branch ownership would mark every
agent's desk as the operator's own — which is arguably right for this filter and
is a real design answer the plan should state, not a gap.

## WHAT THE PLAN MUST SAY BEFORE SOMEONE BUILDS IT

1. **Correct the `assignee` claim.** Say that `assignee` is a PLAN field
   (`schema.ts:70`, `:403`), that no PR object carries one, and that assigned
   PRs therefore need a host fetch and a payload field. Then either drop assigned
   PRs from the slice or drop the "no new payload field" constraint from
   `Done when` — as written the two contradict each other and the slice cannot
   satisfy both.
2. **Correct the agent claim.** `ownedFromAgent` has no caller; the `agent` arm
   never runs. Either wire it (agents are `fleet.agents`, not `fleet.rows`, so
   this is a second filter site) or say explicitly that it stays dead.
3. **Replace "the only three kinds" with the real measurement.** `OwnedRow` has
   three arms; `RowKindSchema` has eight, including `build`. Say which of the
   eight the mapping must learn.
4. **Carry the number.** `1 of 17 rows, and it is a bot` is the measurement;
   "almost nothing" is the adjective. Add that the estate is single-operator, so
   the defect's visible cost is on a shared estate.
5. **Name the branch-ownership answer the estate forces.** Git author is
   `Jan Wloka` on every agent branch. Say whether that counts as the operator's.

## Position

**amend.** The bug is real, the mechanism is correctly traced, and the
permissive-default reasoning is sound — `unknown` must keep the row, and that
half of the design should survive untouched. But the slice as written would
start with the one population whose fact is NOT on the wire, under a
`Done when` clause that forbids adding it. Fix the three false claims and the
plan is ready; build it as written and the first slice stalls on a missing
payload field it was promised it would not need.
