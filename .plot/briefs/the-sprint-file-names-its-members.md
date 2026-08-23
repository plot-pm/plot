## Implementation brief — the-agents-tab-filters-to-the-sprint (wave 1: Parsed)

- **Plan (canonical):** `docs/plans/2026-08-23-the-agents-tab-filters-to-the-sprint.md` on `main`
- **Approved:** 2026-08-23, Jan Wloka, in-session (seven interrogation rounds)
- **Branch:** `feature/the-sprint-file-names-its-members` (base: `main`)
- **Ends as:** one PR to `main`

Wave 1 of 6, and **all five later waves are blocked on you.** They consume the
member list you produce; get its shape right.

### What to build

`parseSprintFile` learns to read a sprint's **members**: the `- [ ] [slug]`
lines, their slug, and the MoSCoW tier each sits under.

### The decisions the plan settles — do not re-derive them

**Nothing in the repo does this today.** Measured 2026-08-23:
`collectSprints` (`board.ts:563`) reads `docs/sprints/active/` and
`parseSprintFile` extracts **slug, title and phase only**; a card's sprint comes
from one line, `if (meta.sprint) card.sprint = meta.sprint` (`:787`) — the
plan's own self-declared field.

So no code can say which plans a sprint contains. **That is why the active
sprint shows 6 of its 19 plans on the live board** — 14 carry no `Sprint:`
field, and the join has nothing else to use.

**Parse the TIER, not just the slug.** Must/Should/Could is the shape a reader
asks about next, the line already carries it, and adding it later means
re-parsing every sprint file. Reading it now costs nothing.

**A slug naming no plan is REPORTED, never dropped.** A sprint can list a plan
that was renamed or deleted; silently omitting it makes the sprint's own scope
unknowable. The sweep wave catches the mirror fault (a plan whose `Sprint:`
disagrees) and this is the same fault from the other side.

**Read `### Must Have` / `### Should Have` / `### Could Have` and `### Deferred`
distinctly.** A deferred item is in the file and is **not** a commitment — the
plan's open question leans toward excluding it from counts, so carry the tier
faithfully and let the consumer decide.

**This wave changes NO client code and adds no filtering.** It produces the
list. Five waves consume it.

### Done when

The plan's `## Done when` is the specification. What matters here:

- A sprint file with 19 checkbox items yields **19 members**, each with its
  slug and tier. Asserted against this repo's own W35 file, which is the case
  the whole plan exists for.
- Both `- [ ]` and `- [x]` parse — a ticked item is still a member.
- A slug naming no plan appears in the result, flagged, not silently absent.
- `### Deferred` items are distinguishable from Must/Should/Could.
- A sprint file with no members yields an empty list, not an error.

Plus: `nvm use` (Node 24 — pnpm crashes on 26), `pnpm test`,
`pnpm run test:board`, `pnpm build:board` with the artifact committed, and a
changeset with its `bumps:` block.

### Bookkeeping

Push your first real commit as soon as it exists. Append `→ #<number>` to this
branch's line in the plan's `## Branches` on **main** — check
`git branch --show-current` is `main` first.

### Scope guard

You own `parseSprintFile` and `collectSprints` in
`packages/board/src/server/board.ts`, the `SprintCard` shape in
`packages/board/src/contract/schema.ts`, and their tests.

**Do not touch the filter, `AgentList.tsx`, or `App.tsx`** — later waves own
those. **Do not change how a card gets its `sprint`** (`board.ts:787`); wave 2
repoints that, and doing it here would make wave 1 unreviewable as a parser.

`AgentList.tsx` was just split into eight modules under
`packages/board/src/app/lib/agent-rows/` (#357). You need none of them.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
