## Implementation brief — a-folded-row-still-says-what-matters (wave Loud)

- **Plan (canonical):** `docs/plans/2026-08-22-a-folded-row-still-says-what-matters.md` on main
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Branch:** `feature/the-loud-things-stay-open` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

The plan's only live wave. **Three of its four were retired during
interrogation** — read *What was retired* below before you start, because the
plan's Motivation describes a board that no longer exists.

### What to build

A folded head **names the exceptions beneath it**, and a fold holding one does
not default closed.

This is the plan's own rule, and the only part of it still unbuilt:

> **Folding may hide repetition, never exceptions.**

### The measurement

`claimed twice` is produced at `packages/board/src/app/lib/agent-rows/stuck.ts:141`
and rendered **on the branch row**:

```ts
case 'double-claimed': return 'claimed twice';
```

No plan head aggregates it. `waveSummaryFor` counts waves without regard to
whether any child is stuck. So fold a plan holding a double-claim and the reader
sees `2 waves, first eligible` and **loses the conflict entirely**.

That is a real estate defect being hidden: the original screenshot carried
`claimed twice — claimed by 2 plans: approval-hands-the-work-to-agents,
every-section-has-one-subject`, where both plans name the same branch and one
records it `Started:` twice. **The board surfacing that is the board working.**

The head became informative about **volume** and stayed silent about **danger**.

### What was retired, so you do not rebuild it

Measured 2026-08-26 against main:

- **`Tallied`** — retired, delivered. `PlanRow` already composes its head from
  `waveSummaryFor` (*"2 waves, first eligible"* — count **and** startability),
  `elsewhereNote` (the plan is split across sections), `roundsBadgeText`, and the
  phase. The plan's *"a bare count — three of what?"* is answered. **Do not
  re-add a tally.**
- **`Elided`** — retired pending measurement. Scoped from a screenshot taken
  before the row was rebuilt; no truncation defect was observed re-measuring.
- **`Live`** — retired pending re-scope. It asked the head to name registry agent
  states, scoped from WORKING — but WORKING iterates `fleet.agents` through
  `RegistryRow`, while a plan head groups branch rows. The two may not meet.

**The plan's file:line references are stale.** The fold moved out of
`AgentList.tsx` (2002 lines now, not 5203) into
`packages/board/src/app/lib/agent-rows/rows.tsx` — `data-wave-toggle` at :659,
`data-wave-branch-toggle` at :1362.

### The decisions the plan settles — do not re-derive them

**Name the exception, do not count it.** `claimed twice` is a fact a reader acts
on; `1 exception` is not. Reuse `nameList` as the plan says.

**Default closed EXCEPT when a fold holds an exception.** Not all-open and not
all-closed — the fold's default is what makes folding worth doing, and an
exception is what makes it unsafe.

**Do not touch what `stuck.ts` detects**, only whether a head reports it. The
detection is correct and is not this wave's subject.

### Done when

The plan's `## Done when` list is the specification, restricted to the exception
items. Asserted on **rendered text**, not on a data attribute.

Two shapes a naive implementation gets wrong:

- **A clean fold shows no exception clause** — silence must stay silent, or the
  signal is worthless.
- **A fold holding `claimed twice` renders OPEN**, and the default is neither
  all-open nor all-closed.

Plus: `pnpm run test:board`, `pnpm run typecheck`. Node 24 (`nvm use`); use
`corepack pnpm` if the homebrew one misbehaves. **`pnpm test` is NOT a test run
here.** Add a changeset with `'@plot-pm/board': patch` frontmatter.

**A browser test needs the built artifact** — run `pnpm build:board` first, or a
stale artifact fails reassuringly. A `planHeads` fixture with a multi-branch wave
is what makes a plan head render at all.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, PR
**inside** the heading:

```
### Loud (Branch: feature/the-loud-things-stay-open, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists.

### Scope guard

This branch owns the fold-head rendering in
`packages/board/src/app/lib/agent-rows/rows.tsx` and, where the aggregate needs
computing, `sections.ts`.

**Do not touch `fleet.ts`** — `bug/the-header-names-its-branch` is live in it and
PR #454 just landed there.

**Do not touch `board.ts` or `schema.ts`** —
`feature/the-board-reads-approval-not-phase` is live in both.

The board artifact `skills/plot/scripts/board/board-server.mjs` is generated and
marked `-merge`. Never read its diff — take either side, run `pnpm build:board`,
stage the **rebuild**, then commit.

Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
