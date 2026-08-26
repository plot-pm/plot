## Implementation brief — a-worker-starts-with-its-brief (wave Offered)

- **Plan (canonical):** `docs/plans/2026-08-24-a-worker-starts-with-its-brief.md` on main
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Branch:** `feature/the-board-offers-to-write-a-brief` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 2 of 2. `Checked` merged as **#431** — auto-dispatch now refuses to start a
wave whose brief is absent from `origin/main`, and names what it skipped. This
wave is that refusal's remedy: the way out, offered where the refusal is seen.

### READ THIS FIRST — the wave is smaller than the plan implies

**`ImplementButton` already exists and already runs `/plot-implement`**, which is
what writes a brief. Its own docstring:

> *`/plot-implement` is the preparation that comes before writing code: the
> staleness preflight, the branch, the hand-off brief, the `Started:` record.*

So the plan's *"the row offers **Write brief**, running `/plot-implement`"* is
**already built** — as a control called *Implement*, on the plan row, gated on
`hasEligible` (`menus.tsx:1507`).

**Do not build a second control that posts to the same route.** That is the
duplication `a-count-answers-to-its-section` and `one-place-for-what-a-row-can-do`
both exist to prevent, and the review will reject it.

**What is actually missing is the JOIN**: a person reading *"skipped: no brief"*
has no way to see that the existing Implement button is the fix. The refusal and
its remedy are in different places and share no words.

### What to build

Start by **measuring** what the gap actually is now that #431 has landed —
the same discipline wave 1 used, and for the same reason: the obvious build is
probably the wrong one.

Concretely, establish:

1. **Where does the refusal surface today?** #431 logs
   `auto-dispatch: skipping branch(es) with no brief on origin/main (run
   /plot-implement first): <branches>` to the server console. Does any of that
   reach the UI? Check whether the fleet payload carries it. A message only in
   a terminal nobody tails is not a refusal a person can act on.
2. **Is Implement reachable from the refused row?** The refused thing is a
   BRANCH in a wave; `ImplementButton` renders on the PLAN row behind `⋯` and is
   gated on `hasEligible`. **A wave refused for a missing brief may no longer
   count as eligible work** — in which case the gate hides the remedy exactly
   when it is needed. Verify this against a real refusal, do not assume it.

Then build the smallest thing that closes the join. Most likely: the refusal
becomes visible on the row, and the existing Implement control is reachable from
it. Record what you measured and what you chose in the plan before writing code.

### The decisions the plan settles — do not re-derive them

**The board INVOKES `/plot-implement`; it never writes a brief itself.** A brief
is interpretation — which alternatives a plan rejected and what killed them —
and that is a skill's work, not a server's. This is the plan's own
*Not chosen: have auto-dispatch write the brief itself*.

**`plot-dispatch.sh` stays unchanged.** Its `brief=missing` is a documented
constant; bash cannot invoke a skill. Wave 1 did not touch it and neither does
this.

**The manual path stays unrefused.** `/plot-dispatch` warns and proceeds. Only
the automatic path stops, because it acts with nobody watching.

### Done when

The plan's Done-when **item 5** is this wave's specification:

> The row offers **Write brief** where the brief is missing, and not otherwise.

Read *offers* as **the remedy is reachable from the refusal** — satisfied by
routing to the existing Implement control, not necessarily by a new button.
The *"and not otherwise"* half is the discriminating assertion: an offer that
renders unconditionally passes the first half and is noise on every other row.

Plus the repo's gates: `pnpm test`, `pnpm run test:reconcile`,
`pnpm run test:board`, `pnpm run typecheck`. Node 24 (`nvm use`). Add a
changeset with `'@plot-pm/board': patch` frontmatter.

### Traps this plan's own wave 1 hit today

- **A board capability needs six touchpoints** — schema, `board.ts` placeholder,
  `index.ts`, App guard, `AgentList` props + call sites, control + menu. `tsc`
  walks you through them; do not stop at the first two.
- **The client CASTS the fleet payload, it does not parse it.** Zod defaults do
  not apply client-side, so a new field is `undefined` in the renderer until the
  schema carries it.
- **Run every test in the FOREGROUND.** A `-p` run receives no notification.
  Wave 1's worker hung for 52 minutes with 324 finished lines uncommitted and
  had to be rescued by hand — commit and push early, and often.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, so the
PR goes **inside** the heading:

```
### Offered (Branch: feature/the-board-offers-to-write-a-brief, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit.

### Scope guard

This branch owns the board's row rendering and menu for this offer, plus the
fleet payload field if the measurement shows one is needed — and their tests.

**Do not touch** `auto-dispatch.ts`'s refusal logic: #431 settled it, including
that the check reads `origin/main` rather than the filesystem, on a measurement.
Making the refusal VISIBLE is this wave; changing when it fires is not.

The board artifact `skills/plot/scripts/board/board-server.mjs` is generated and
marked `-merge`. Never read its diff — take either side, run `pnpm build:board`,
stage the **rebuild** (not the merge's copy), then commit.

Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
