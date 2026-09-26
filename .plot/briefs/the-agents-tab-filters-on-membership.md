## Implementation brief — the-sprint-filter-says-what-it-filters (wave 2: Joined)

- **Plan (canonical):** `docs/plans/2026-08-24-the-sprint-filter-says-what-it-filters.md` on main
- **Branch:** `bug/the-agents-tab-filters-on-membership` (base: `main`)
- **Ends as:** one PR to `main`

Wave 2 of 5. Wave 1 `Carried` landed as **#389** — `fleet.sprints` now carries
`members`, which is what makes this wave possible.

### What to build

The Agents tab's sprint filter joins on the **sprint file's own plan array**
(`sprint.members`), like the Board and Swimlane tabs already do.

`AgentList.tsx:416` is the whole of the filter today:

```ts
fleet.rows.filter((r) => r.sprint === '' || sprintFilter.has(r.sprint))
```

Two faults, and they compound.

### Settled — do not re-derive

**The exemption belongs on the row's KIND, not on an empty sprint.** The
`r.sprint === ''` escape was written for the release row and unplanned PRs —
rows with no plan and so no sprint to carry. Measured: **55 of 95 rows have an
empty sprint and 53 of those are plan work** (48 waves, 5 branches). Exactly
**2** are the rows it defends. Test `kind` (`release`, `pr`, `issue`); a plan row
whose plan names no sprint is HIDDEN while the filter is on, which is what
*Sprint only* means.

**Join on `sprint.members`, never on `r.sprint`.** The inline `Sprint:`
back-reference is unreliable — 21 members, 5 carrying the field. #386 moved the
other two tabs off it for exactly this reason.

**Why this tab was left behind, so you do not read it as an oversight.** #386
changed `Board.tsx` and `Swimlanes.tsx`, which read the BOARD payload —
`board.sprints` carries `members`. `AgentList.tsx` reads the FLEET payload, and
until #389 `fleet.sprints` had no members at all. There was nothing to join
against.

**`passesSprintFilter` CANNOT be reused as written.** It takes a `Card` and keys
on `card.slug` (`filters.ts:206`); an `AgentRow` has no `slug`. The join key is
`row.plan`, which carries the same value in the same shape — `'waves-name-themselves'`
against a member's `slug: 'done-means-delivered'`.

**Generalise the predicate over *(slug, membership)* rather than adding a
row-shaped sibling.** One predicate means the three tabs cannot answer
differently, which is the point of the wave. Two predicates is how they drift.

### Done when

Plan items 1, 1b, 1c, 1d. Lifted because a naive fix passes without them:

- **1b** — a release row and an unplanned PR stay visible with the filter ON.
  Assert by KIND, so a later change from `r.sprint === ''` to a kind test cannot
  silently drop them.
- **1c** — a plan row whose plan names no sprint is hidden. The 53 rows the
  empty string admits today.
- **1d** — all three tabs agree: one plan, one membership answer, whether the
  reader is on Board, Swimlanes or Agents.

Item 1 asserts on this repo's estate, where the tab currently shows
`a-citation-is-not-a-claim`, `one-wave-row-two-contents`,
`a-worker-asks-for-the-next-wave` and `the-sprint-filter-says-what-it-filters`
with the filter ON. None is a member.

**There is no browser test for `SprintFilter`.** The existing sprint tests cover
the BOARD tab's dropdown, a different control. `data-sprint-filter` and
`data-sprint-toggle="<slug>"` are the hooks.

Plus repo gates: `pnpm run test:board` green, `pnpm build:board` in THIS worktree
with the artifact committed, a changeset (`'@plot-pm/board': patch`), Node 24
(`nvm use`), `trash` not `rm`. `auto-dispatch-spawn.test.ts` fails under suite
contention and passes alone — if ONLY that fails, re-run it alone and report it
as the known flake.

### Bookkeeping

Push the first real commit as soon as it exists. On PR creation append the number
INSIDE the wave heading's parenthetical on main:
`### Joined (Branch: …, PR: #N)`. A trailing `→ #N` parses as nothing.

### Scope guard

`packages/board/src/app/components/AgentList.tsx` (the filter at ~line 416) and
`packages/board/src/app/lib/filters.ts` (the predicate).

**Do NOT touch the counts** — `17 delivered` over 21 members is the `Counted`
wave, and the control's labelling is `Named`. Both are later waves of this plan.

Other workers are in flight on `AgentList.tsx` neighbours. Rebase before you
push, and expect an artifact conflict in `board-server.mjs` — take either side
and rebuild, never read its diff.
