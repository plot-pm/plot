# Kanban board v1.0: first-class board package

> Graduate the experimental local Kanban board from a beta script into a first-class plot member: its own TypeScript package (vite + react + shadcn + zod) in a new monorepo structure, architecture reworked onto the `plot-plan-meta.sh` format contract, a story filter, and board health wired into the project's Definition of Done.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->

## Changelog

- Local Kanban board graduates from 🧪 beta to a first-class plot component, released as `@plot-pm/board` 1.0.0
- Board is now its own TypeScript package (`packages/board`) built with vite + react + shadcn/ui + zod; the plot skill ships a prebuilt, dependency-free server artifact — `pnpm board` works with zero install steps beyond the repo itself
- Board no longer parses plan files itself: it consumes `plot-plan-meta.sh` (the plan-format contract), so frontmatter plans, canonical plans, and future format changes are handled in exactly one place
- New **story filter** (multi-select) alongside the sprint filter: show only plans belonging to selected stories; plans declare story membership via a new optional `Story:` field
- New `docs/definition-of-done.md`: every change must keep the board working (`pnpm test:board`, typecheck, build), and board impact is a standing item when planning changes

## Motivation

The board earned its keep as a beta script (glanceable phase view, no GitHub auth or latency), but it is stuck in an awkward adolescence:

1. **It violates plot's own format contract.** `parser.mjs` regexes `## Status` sections by hand, while `plot-plan-meta.sh` declares itself "the ONE place that knows what a plan file looks like" and already understands both canonical and frontmatter formats (built for #34/#37). Today a frontmatter-only plan parses fine everywhere in plot *except* the board, which silently drops it. Two parsers means format drift is a matter of time.
2. **No dependency budget.** The vendored `lit-html.js` + hand-rolled DOM code was right for a zero-dep experiment, but it caps how far the UI can go (multi-select filters, richer cards, future editing) and is the least agent-friendly part of the codebase — agents work far better with typed React components and zod schemas than with a bespoke vanilla-JS mini-framework.
3. **Nothing protects it.** The board has tests (`test/board/`) but no place in the project's working agreements — a change to the plan template or helper scripts can break the board and nothing in the workflow says anyone must notice. First-class status means the board's health is part of the Definition of Done, not an afterthought.
4. **Stories are invisible.** Sprints can filter the board; stories (the umbrella around plans, per the story-tracking skill) cannot. Multi-session work has no glanceable view.

## Design

### Approach

Four workstreams, each independently verifiable. Implementation happens **in this same PR** (single PR from idea through delivery — deliberate deviation from the usual plan-merge-then-fan-out; see Branches).

#### 1. Monorepo + board package

Introduce pnpm workspaces with the smallest possible footprint:

```
pnpm-workspace.yaml          # packages: ["packages/*"]
packages/
  board/                     # @plot-pm/board — the one package (for now)
    package.json             # version 1.0.0, type: module
    src/
      server/                # node server: /api/board + static serving
      app/                   # react + shadcn UI
      contract/              # zod schemas + plot-plan-meta.sh consumer
    vite.config.ts
    dist/                    # build output (gitignored in dev; see artifact policy)
skills/plot/scripts/board/
  board-server.mjs           # CHECKED-IN built artifact (single-file, zero-dep)
  README.md                  # provenance: built from packages/board@<version>, do not edit
```

- **Stack:** vite + react + shadcn/ui + zod, TypeScript strict. shadcn implies tailwind; both are build-time only — nothing reaches the runtime artifact except the bundled output.
- **Build/bundle:** vite builds the client; the server (node, no framework — keep `node:http`) is bundled with the client assets **inlined** (esbuild/rollup) into one self-contained `board-server.mjs`. Node ≥ 20 is the only runtime requirement, same as today.
- **Artifact policy:** the built `board-server.mjs` is checked into `skills/plot/scripts/board/` **by the release pipeline only** (changesets version PR), never edited by hand. A CI check rebuilds and diffs the artifact so a stale check-in fails loudly. Rationale: the plot *plugin* is distributed as a git checkout of skills/ — adopters must get a working board without a build step (manifesto Q1/Q6: no new external dependency at use time).
- **Root scripts stay stable:** `pnpm board` now runs the built artifact (or `pnpm --filter @plot-pm/board dev` for HMR development). `pnpm test:board` and `pnpm typecheck` move to the package but keep root aliases.
- **npm publish:** `@plot-pm/board` is published to npm via the existing changesets flow (`access: public` already configured), enabling `npx @plot-pm/board` in any plot-adopting repo. Board versions independently from the plot plugin, starting at **1.0.0**.
- **Old files** (`app.mjs`, `parser.mjs`, `index.html`, `styles.css`, `vendor/`, `tsconfig.json`) are removed from `skills/plot/scripts/board/`; `test/board/` moves into `packages/board/test/`.

#### 2. Architecture rework: one format contract

The board stops knowing what a plan file looks like:

- The server invokes `plot-plan-meta.sh <all plan files>` (multi-file JSON-lines mode, built in #37 precisely for cheap ambient use) and validates each line with a **zod schema** — zod at the boundary, typed data everywhere else.
- `plot-plan-meta.sh` grows the board-facing fields it doesn't emit yet: `title`, `sprint`, `story`, `assignee` (all from `## Status` / `## Approval` / frontmatter, same precedence rules as `status:`/`phase:`). Each new field gets a fixture in `test/reconcile/fixtures/` — the contract stays specified by example and enforced by `test/reconcile/`.
- Sprint files: same pattern — either a small `--sprint` mode on the helper or a deliberately minimal TS reader; decide during implementation, biased toward the helper (one contract beats two).
- Fallback: if `bash`/the helper is unavailable (e.g. future standalone npm usage outside a plot repo), the server reports a clear error rather than falling back to a second parser. No silent contract fork.

This inverts the current dependency: today the board *duplicates* the contract; after, the board is a *consumer* that any contract improvement reaches for free.

#### 3. Story filter

- **Plan side:** new optional `- **Story:** <story-slug>` line in the plan template's `## Status` (and `story:` in frontmatter), mirroring the existing `Sprint:` field. One plan belongs to at most one story (same cardinality as sprint).
- **Board side:** the server walks `docs/stories/*/STORY-*.md` (story-tracking skill convention), reading `title` and `status` from story frontmatter, and emits a `stories` array beside `sprints`.
- **UI:** a **multi-select** story filter (shadcn multi-select/combobox) next to the sprint select: show plans belonging to *any* selected story, plus a "No story" option — the multi-select analogue of the sprint filter's `__no_sprint__` sentinel. URL state: `?story=a,b` (comma-separated), validated against known slugs like the sprint param.
- Story badges on cards when no story filter is active (mirrors sprint badge behavior).

#### 4. First-class status + Definition of Done

- New `docs/definition-of-done.md` (the exact path `ralph-plot-sprint` already reads), including:
  - **Board must work:** `pnpm test:board`, `pnpm typecheck`, and a successful board build/artifact check are part of done for every change.
  - **Board impact is a planning item:** any plan touching plan format, templates, helper scripts, or `docs/plans` layout must state its board impact (a one-line "Board impact: none" is fine).
- CLAUDE.md: Testing section references the DoD; helper-scripts table and architecture notes updated; the board's row loses nothing but gains "first-class".
- `skills/plot/SKILL.md` + `skills/plot/README.md`: remove the 🧪 beta marker, document the story filter and the package/artifact split.
- Plugin version bump (minor) across `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` per the versioning rules, with a changeset.

### Verification

- `pnpm test` (skills parse), `pnpm test:board` (contract + walker tests against fixtures), `pnpm typecheck`, `pnpm test:reconcile` (extended fixtures for new fields).
- Artifact freshness check in CI (rebuild + diff).
- Manual lifecycle check: `pnpm board` against this repo's real `docs/plans/`, verifying all four columns, sprint filter, story filter, and a frontmatter-format plan rendering correctly (the current board's known blind spot).

### Open Questions

- [ ] Package name: `@plot-pm/board` (org-scoped, matches repo org) vs unscoped `plot-board`?
- [ ] Should the sprint filter become multi-select too, for consistency with the story filter? (Cheap once the component exists.)
- [ ] Artifact location: keep `skills/plot/scripts/board/` (stable `pnpm board` path, plugin ships it automatically) vs move under `skills/plot/assets/`? Default: keep.
- [ ] Is shadcn/tailwind pulling its weight for ~3 components (card, select, multi-select), or is that decided by the follow-up ambitions (editing UI, public board — see research docs)? Default: adopt it now, as directed; revisit only if challenge-the-plan disagrees.
- [ ] Does `plot-plan-meta.sh` emit `title` from the H1, the frontmatter `title:`, or both with precedence? (Proposal: frontmatter wins, H1 fallback — same rule as status/phase.)

## Branches

**Single-PR mode (explicit deviation):** this plan is implemented on the idea branch itself — one PR carries the plan from Draft through Delivered. No fan-out to separate implementation branches at approval; `/plot-approve` semantics reduce to "Max approves the plan in this PR, implementation commits follow on the same branch."

- `idea/kanban-board-v1` — plan + full implementation (this PR)

## Notes

- **Research companions (not part of this plan's scope):** two research-only write-ups ship alongside this plan for review, clearly marked as uncommitted options:
  - `docs/research/2026-07-12-board-plan-editing.md` (R1: editing plans from the board, starting with approval)
  - `docs/research/2026-07-12-board-public-server.md` (R2: board.plot.pm as a public server)
  Nothing in this plan depends on either; the package split and contract rework keep both options open.
- Type chosen as `feature` (user-facing board functionality is the center of gravity; the monorepo work is enabling infra). Flag during review if `infra` fits better.
- The board remains **read-only and local-only** in v1.0 — editing is R1 territory.
