## Implementation brief — the-plan-the-board-holds (wave Read)

- **Plan (canonical):** `docs/plans/2026-08-23-the-plan-the-board-holds.md` on main
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Branch:** `feature/the-board-reads-approval-not-phase` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

The plan's only live wave — `Carried` was retired during interrogation because
what it asked for already renders.

### What to build

Three small things, all about the board carrying no plan field it does not read.

**1. `impl` either reaches a reader or leaves the schema.** Measured
2026-08-26: it appears **exactly once** in the whole board —

```ts
// packages/board/src/contract/schema.ts:65
impl: z.string().default('NONE'),
```

— with no producer, no consumer, no renderer.

**This is the defect this sprint shipped a warning for.**
`setup-names-an-unread-key` (PR #452) now warns a user when
`/plot-board-setup` writes a key no backend reads. Plot is doing to its own
schema what the setup skill warns users about. Either outcome closes it; what is
refused is leaving it declared and unread.

**2. `review` reaches a reader, or its contract says what it is.** One use:

```ts
// packages/board/src/server/board.ts:507
return meta.review === 'pr' ? 'open' : 'draft';
```

That is an internal decision about how a plan PR renders. The plan's recorded
answer to *how is approval given* never reaches a reader.

**3. Settle the one fact still inferred from a phase**, at `board.ts:956`:

```ts
if (phase === 'Development') card.started = started;
```

### Do NOT assume the phase gate is wrong

This is the part a careless implementation gets backwards. The line carries a
comment that argues a real case: the Ready/In-progress badge is a Development
affordance that **must not ride along into Testing**, and an approved plan whose
waves have all merged has been bumped out of Development deliberately.

The two conditions — `phase === 'Development'` and `started_raw` being present —
**agree on today's estate** and diverge only for a plan bumped out of Development
that still has started branches. Establish which is wanted, and keep the gate if
the comment's argument holds. Done-when 3 says *settled either way*, not *moved*.

### The rule this wave settles

**No field joins the schema without a consumer in the same change** (Done-when
4). That is the general form of finding 1, and the reason this wave is worth
doing at all despite being small.

### What was retired, so you do not rebuild it

Wave `Carried` asked for `approved`, `started[]`, `assignee`, `sprint`, `story`,
`review`, `impl` to reach the row. **Measured 2026-08-26: the board consumes 16
of the parser's 27 fields**, and every one of those named is already among them.
Do not re-add them.

The 11 unread are mostly internal by design — `phase_raw`, `impl_raw`,
`review_raw` are un-normalised twins of fields already read; `format`,
`long_wave_names`, `malformed_prs` are parser diagnostics; `branches` and
`changelog` are covered by `waves` and the release flow. **Leave them alone**;
`changelog` and `malformed_prs` are explicitly open questions, out of scope here.

### Done when

The plan's `## Done when` list is the specification — all five items.

Plus: `pnpm run test:board`, `pnpm run typecheck`. Node 24 (`nvm use`); use
`corepack pnpm` if the homebrew one misbehaves. **`pnpm test` is NOT a test run
here** — it is `skills add . --list`.

Add a changeset with `'@plot-pm/board': patch` frontmatter (package frontmatter,
NOT a skills `bumps:` block).

**A schema change forces touchpoints.** If `impl` stays and gains a reader, `tsc`
will walk you through the places that must know about it; if it goes, check
nothing casts `Board`/`PlanMeta` in a way that silently tolerated it.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, PR
**inside** the heading:

```
### Read (Branch: feature/the-board-reads-approval-not-phase, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists.

### Scope guard

This branch owns `impl`/`review` in `packages/board/src/contract/schema.ts` and
the two sites in `packages/board/src/server/board.ts`, plus their tests.

**`fleet.ts` is busy.** `bug/the-header-names-its-branch` is live in it right
now, and PR #454 just landed there. Stay in `board.ts` and `schema.ts`.

The board artifact `skills/plot/scripts/board/board-server.mjs` is generated and
marked `-merge`. Never read its diff — take either side, run `pnpm build:board`,
stage the **rebuild**, then commit.

Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
