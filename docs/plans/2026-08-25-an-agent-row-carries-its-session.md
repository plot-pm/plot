# An agent row carries its session

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

An agent row carries the session id its manifest records, so a broken agent
offers the Drop action built for it.

## Motivation

### The measurement

Reported from a running board on 2026-08-25: a `test/a-row-moves-between-sections`
row in WAITING ON YOU, state `unknown`, wearing **no `⋯` at all** — the one row
on screen whose single available action was the one it could not offer.

`BrokenAgentMenu` opens with:

```ts
// No session = no manifest = nothing to drop. The row should not get a menu
if (!agent.session) return null;
```

That guard is right. The premise it tests is wrong.

Measured against `/api/fleet` the same day: **all 12 agents in the payload have
no `session`** — the eleven live workers and the broken one alike. Yet the
manifests on disk carry it:

```json
{
  "session": "090c9eb1-11fc-4389-b6fe-3447f369e1a0",
  "branch": "feature/the-sprint-file-names-its-members",
  "pid": "63817",
  ...
}
```

So the field exists where it is written and is gone where it is read. Something
between `.plot/agents/*.json` and `AgentEntry` drops it.

### Why the guard is not the bug

The obvious fix — render the menu anyway — is wrong, and naming why is the point
of this plan. Drop **removes a manifest**, and it identifies the manifest by
session. A menu offered without one would either act on the wrong entry or fail
at the server; the guard is what stops a control from lying about what it can do.

`drop` is not missing either: `/api/board` reports `{"available":true,"reason":""}`
and `POST /api/registry/drop` answers 400 (validating), not 404. Every other part
of the feature is present and working.

**The defect is one field, and its absence disables a feature that is otherwise
complete.**

### What it costs today

`the-registry-drops-a-settled-worker` exists to reconcile entries automatically.
Drop is the manual path for the ones it cannot clear — and that path is closed
for **every** entry, because none of them carries the identity it needs.

Measured: 1 broken agent with no way to remove it from the board, and 11 live
ones that would be equally unreachable the moment they broke.

## Design

### Find where the field is lost, then keep it

Three candidates, in the order they should be checked, because each is cheap to
rule out:

1. **The read** — whatever parses `.plot/agents/*.json` into `AgentEntry`.
2. **The schema** — `AgentEntrySchema`, if `session` is absent or optional there,
   a strict parse would strip it silently.
3. **The payload builder** — the fleet assembly, if it constructs entries field
   by field rather than passing them through.

This is stated as an investigation rather than a fix because the plan cannot
honestly name the line without reading it. What the plan CAN settle is the
shape of the answer: **the id is read, not invented.** A synthesised session
would make the guard pass while Drop still acted on nothing.

### `session` is required, not optional

Wherever it lands, the field carries the identity that outlives the branch —
`AgentList` already keys rows by `agent.session || branch || worktree`, so a
missing session silently degrades row identity too, not just the menu.

## Done when

1. `/api/fleet` reports a non-empty `session` for every agent whose manifest has
   one. Asserted against a fixture manifest, not against the live estate.
2. A **broken** agent (`stalled`/`unknown`) with a session renders its `⋯` and
   offers *Drop this agent*.
3. **A broken agent with NO session still renders no menu.** The guard stays.
   This is the assertion a naive implementation fails: making the menu
   unconditional passes item 2 and re-opens the defect the guard prevents.
4. Dropping actually removes that manifest, and the row disappears on the next
   pulse.
5. Row identity is unchanged for entries that already had a session — the
   `agent.session || branch || worktree` key must not start keying differently.
6. `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board` green.

## Notes

### Found by asking a question the board could not answer

The reader asked *how do I drop an agent?* — and the answer turned out to be
three separate facts: Drop is for broken agents only, Drop is not a killswitch,
and the one broken agent on screen could not offer it. Only the third is a
defect. The first two are the design working.

### It belongs to this sprint's subject

*The board tells the truth in every section.* A row that silently omits its one
available action is not lying, but a reader who concludes *this agent cannot be
dropped* has been told something false by the absence.
