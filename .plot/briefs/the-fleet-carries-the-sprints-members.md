## Implementation brief — the-sprint-filter-says-what-it-filters (wave 1: Carried)

- **Plan (canonical):** `docs/plans/2026-08-24-the-sprint-filter-says-what-it-filters.md` on main
- **Branch:** `feature/the-fleet-carries-the-sprints-members` (base: `main`)
- **Ends as:** one PR to `main`

Wave 1 of 5. `Joined` cannot start until this lands — it has nothing to join
against without it.

### What to build

`fleet.sprints` gains `members`: the sprint file's own plan array, the same one
`board.sprints` already carries and the same one `parseSprintMembers` produces.

Measured 2026-08-24:

| payload | carries |
|---|---|
| `board.sprints` | `members`, phase, release, slug, title |
| `fleet.sprints` | slug, title, release, counts — **no members** |

### Settled — do not re-derive

**This is why the Agents tab was never repointed.** #386 changed `Board.tsx` and
`Swimlanes.tsx`, which read the BOARD payload. `AgentList.tsx` reads the FLEET
payload. It kept the old `r.sprint` join because the new one had nothing to join
against — not an oversight.

**One derivation, two payloads.** `collectSprints` already parses the members for
`board.sprints`; the fleet must read the same source, not re-parse. Two payloads
deriving one fact independently is how they drift.

**Do not touch `counts`.** The bucket rework is the `Counted` wave and is a
separate argument.

### Done when

Plan item 1e: **`fleet.sprints.members` equals `board.sprints.members`** for the
same sprint — asserted equal, not merely non-empty.

Plus repo gates: `pnpm run test:board` green, `pnpm build:board` in THIS
worktree with the artifact committed, a changeset (`'@plot-pm/board': patch`),
Node 24 (`nvm use`), `trash` not `rm`. `auto-dispatch-spawn.test.ts` fails under
suite contention and passes alone — if ONLY that fails, re-run it alone and
report it as the known flake.

### Bookkeeping

Push the first real commit as soon as it exists. When the PR opens, append the
number INSIDE the wave heading's parenthetical on main:
`### Carried (Branch: …, PR: #N)`. A trailing `→ #N` parses as nothing.

### Scope guard

`packages/board/src/server/fleet.ts` (the sprint block) and
`packages/board/src/contract/schema.ts`. Nothing else is in flight on these.
