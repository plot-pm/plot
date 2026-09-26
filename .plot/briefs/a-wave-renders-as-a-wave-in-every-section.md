## Implementation brief — a-wave-row-is-a-wave-row-everywhere (wave 1: Rendered)

- **Plan (canonical):** `docs/plans/2026-08-24-a-wave-row-is-a-wave-row-everywhere.md` on main
- **Branch:** `bug/a-wave-renders-as-a-wave-in-every-section` (base: `main`)
- **Ends as:** one PR to `main`

Wave 1 of 2. `Found` (the blocked-ⓘ jump) depends on this and should need almost
nothing once it lands.

### RESUMING — your failing test already exists

A previous worker wrote `packages/board/test/integration/wave-in-working.browser.test.ts`
and crashed before committing it (`API Error: Connection closed mid-response`).
It is rescued and committed on this branch.

**Run it first.** It was never executed, so it is not yet known to fail for the
right reason — a selector typo fails identically to a real defect. Confirm it
fails on the RENDERING (the branch leading slot 3 where the wave's name belongs)
before you change any source. If it is wrong, fix the test and say so.

Writing the proof before the fix was the right order. You are picking up mid-step,
not starting over.

### What to build

A row whose `kind` is `wave` renders through the wave row **in every section**.
Today WORKING renders it as a branch row.

The columns, in this order, everywhere:

| slot | holds |
|---|---|
| 1 | the activity mark |
| 2 | the kind — `WAVE` |
| 3 | the wave icon and **the wave's name** |
| 4 | the branch and plan links, together |
| 5 | the status |
| 6 | the age |
| 7 | the row menu |

Slot 3 is the defect: WORKING puts the BRANCH there and demotes the wave's name
to a badge.

### Settled — do not re-derive

**Skip the GROUP, not the ROW.** `waveGroupsFor` is scoped to one section
deliberately (`sections.ts:245`) — WORKING holds agents and must not bury three
unrelated waves under three plan heads. That reasoning is correct and stays.

The bug is that `ungroupedRows` is its complement over the same input
(`sections.ts:340`) and everything it returns renders as `<Row>`, a branch row
(`AgentList.tsx:1560`). One function currently decides two questions. Separate
them: the section decides grouping, the ROW decides its kind.

**The grid already exists.** `TUPLE_TRACKS` (`TupleRow.tsx:88`) declares seven
tracks and both renderings already share it. Nothing structural is in the way —
only which facts land in which slot.

**Slot 4 already means this.** Its comment reads *"SLOT 4 HOLDS WHAT THE WAVE
CONTAINS"* (`tuple-row.ts:1151`). The branch belongs there beside the plan link,
which is where the wave rendering already puts it.

**A wave row without a plan head is normal.** `planHeaded` is a prop, not an
assumption — an ungrouped wave in WORKING is a wave row with no head above it.

### Done when

Plan items 1, 1b, 2, 3, 4, 7.

Two are the ones a naive fix breaks:

- **Item 2** — WORKING still orders by AGENT and shows NO plan heads. This is
  the property the section scope exists for; a fix that starts grouping WORKING
  by plan passes item 1 and fails the section's purpose.
- **Item 3** — the worker facts survive: `worker running (pid …)`, the activity
  dot, the agent ordering.

Item 1 asserts **slot-by-slot against a NOT STARTED row**, not "the wave name
appears somewhere" — today's badge would satisfy the looser test.

Plus repo gates: `pnpm run test:board` green, `pnpm build:board` in THIS worktree
with the artifact committed, a changeset (`'@plot-pm/board': patch`), Node 24
(`nvm use`), `trash` not `rm`. `auto-dispatch-spawn.test.ts` fails under suite
contention and passes alone — if ONLY that fails, re-run it alone and report it
as the known flake.

### Bookkeeping

Push the first real commit as soon as it exists. On PR creation append the number
INSIDE the wave heading's parenthetical on main:
`### Rendered (Branch: …, PR: #N)`. A trailing `→ #N` parses as nothing.

### Scope guard

`packages/board/src/app/components/AgentList.tsx` (the ungrouped render path),
`packages/board/src/app/lib/agent-rows/sections.ts`, and
`packages/board/src/app/lib/agent-rows/rows.tsx`.

**Do NOT change the blocked-ⓘ query** — that is the `Found` wave, and it should
need little once a wave in WORKING carries `data-wave-row`.

Three other workers are in flight on `rows.tsx` neighbours
(`the-fleet-carries-the-sprints-members`, `the-registry-holds-the-worker-pid`,
`a-wave-row-names-its-wave`). `a-wave-row-names-its-wave` is the closest — it is
hunting a dropped wave name in the render path. If you find that bug on the way,
report it rather than fixing it: it belongs to that branch.
