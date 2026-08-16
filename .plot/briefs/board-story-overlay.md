## Implementation brief — board-becomes-operable (wave 1: Navigation)

- **Plan (canonical):** `docs/plans/2026-08-16-board-becomes-operable.md` on `main`
- **Approved:** 2026-08-16, jwloka, plan-PR #146 merged (two interrogation rounds)
- **Branch:** `feature/board-story-overlay` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

The other two waves (`board-column-overflow`, `board-approve-affordance`) are
**not yours** and are held back: all three reach `PlanCard.tsx` or the contract,
and this repo has paid three times in one day for two agents in one file.

### What to build

Stories are the board's axis and its dead end. A plan card names its story as a
badge, the swimlane view uses stories as row headers — and neither leads
anywhere. `StoryCardSchema` carries `slug`, `title`, `status` and **no path**;
the server has `/plan/<file>` and **no `/story/`**. The one concept that spans
months is the only artefact the board cannot open.

Four pieces:

1. **`/story/<slug>`**, rendering the story's markdown the way `/plan/<file>`
   renders a plan — same sandboxed embed, same `?embed=1`, same CSP.
2. **`StoryCardSchema` gains the resolved path**, for the same reason `planFile`
   exists on a plan card: the consumer must not reconstruct it, because
   stripping and rebuilding a path is where the mistakes live.
3. **An `Open story` button in the plan modal header**, beside `Show in board`.
4. **The story badge on the card becomes a link** as well.

### The security decision — read this before writing the route

**Both routes share ONE hardened resolver.** Do not write `/story/` from
scratch; extract what `/plan/` does and give both the same function. They differ
only in which allowlist they consult — decode, try/catch, 400-vs-404, CSP and
`?embed=1` are identical.

The reason is a second attack that is easy to miss. `/plan/` defends against
two, and only traversal is obvious:

- **Traversal** — a slug is a directory name *and* a filename component, so
  both must be checked against the stories the board already collected, never
  joined into a path.
- **`decodeURIComponent` throws** on a malformed `%` escape (`/story/%E0%A4%A`),
  and an uncaught throw inside the request listener **takes the process down**.
  That is why `/plan/` decodes *inside* the try and answers 400 rather than
  crashing.

A fresh `/story/` route would plausibly get the allowlist right and that wrong,
and one malformed URL would then kill the board.

### Three decisions the plan settles

**`Open story` is the primary route; the badge is secondary — and both exist.**
An earlier draft made only the badge a link, which reduces the original request
("a CTA next to Show in board") to a label a reader must discover is clickable.
The badge *names* the story on the card at triage time; the button *goes* there
in the modal once you have stopped triaging. Same split the worktree path makes.

**The overlay header mirrors the plan modal's exactly** — `Show in board`,
`Open in new tab`, `Close`. Three, not two. A reader who has learned one modal
must not have to learn a second set of controls.

**The overlay's body is the story's own.** The plan modal grew a body section
(worktree paths) whose rationale generalises: the header answers *where do I
go*, the body answers *what now*. A story has no worktree, so it gets what the
story card cannot say — **which plans make it up and what phase each is in**,
derived from the board's own cards (`story` and `phase` are already on every
plan card). Not parsed from the STORY file's "Current Plan" prose: that is
hand-maintained, and four of twelve open points in `plot-board` were stale when
swept this evening. A derived list cannot drift.

**A story with no file gets an empty path and renders no link** — the rule plan
rows already follow. The card keeps its title and status, which are true
regardless.

**Opening a story from an open plan modal replaces it**, never stacks. Two close
buttons and an ambiguous Escape are not worth the context the header already
names; the way back is the same click in reverse.

### Done when

The plan's `## Done when` list is the specification. Assertions that exist
because a weaker implementation passes without them:

- **Assert the negatives on the route** — `../../etc/passwd`, encoded variants,
  and a malformed `%` escape returning 400 rather than crashing. `/plan/` has
  these; the shared resolver means you inherit rather than rewrite them.
- **`Open story` is asserted as a button**, not only "a story can be opened" —
  a badge-only implementation satisfies the loose reading and leaves the action
  invisible to anyone scanning the header.
- **`Open story` is absent when the story has no file.**
- **The overlay header matches the plan modal's** — assert by comparison rather
  than by listing, so the two cannot drift.
- **The plan list is derived** — assert against a fixture whose hand-written
  section disagrees with the plan data; the derived list must win.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`, `pnpm run
validate` all pass; `pnpm build:board` run **in your own worktree** and the
artifact committed (CI gates on no-diff); a changeset is present.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. **Push your first real commit as soon as
it exists.**

### Scope guard

`packages/board/src/server/index.ts` (+ the shared resolver), `board.ts`,
`packages/board/src/contract/schema.ts`, `PlanCard.tsx`, `PlanModal.tsx`, a new
story overlay component, and their tests.

Do **not** implement column overflow or the Approve button — those are the
sibling waves.

Two other branches are in flight: `bug/fleet-sees-unpushed-commits` holds
`fleet.ts`, `schema.ts` and the scan; `feature/working-rows-pulse` holds
`AgentList.tsx`. **`schema.ts` overlaps** — coordinate by rebasing rather than
by racing, and keep your change to `StoryCardSchema` narrow.

`.gitattributes` marks the built artifact `-merge`: on a conflict there, take
either side, run `pnpm build:board`, `git add` it, continue. Do not read that
diff.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
