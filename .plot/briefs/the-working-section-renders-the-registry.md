## Implementation brief — the-working-section-shows-every-worker (wave 1: Shown)

- **Plan (canonical):** `docs/plans/2026-08-24-the-working-section-shows-every-worker.md` on main
- **Approved:** 2026-08-24, in-session
- **Branch:** `bug/the-working-section-renders-the-registry` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention

This is wave 1 of 4. `Counted`, `Named` and `Reconciled` all build on it — they
adjust what the rows say and which entries survive, and none of them can be
started until WORKING renders from the registry at all.

### RESUMING — work already exists on this branch

A previous worker was interrupted mid-edit and its work is committed as
`d7ad1422` (*"RegistryRow and agentStateStatus — WIP, not yet wired in"*).
**Read that commit before writing anything.**

It contains:

| file | what |
|---|---|
| `tuple-row.ts` | `agentStateStatus()` — all five registry states, `someone is on it` narrowed to `running` |
| `rows.tsx` | a new `RegistryRow` component |
| `AgentList.tsx` | the import |

**`pnpm run typecheck` fails with exactly one error**, and it is a map rather
than damage:

```
AgentList.tsx(68,68): error TS6133: 'RegistryRow' is declared but its value is
never read.
```

The component was built and the render call was never made. That is the seam you
are resuming at.

**Do not assume it is right.** It was never run and never tested. Judge it
against the plan and this brief; if it is wrong, replace it and say so in your
report. What it is NOT is a starting point you have to reconstruct.

### What to build

WORKING renders **one row per registry entry**, instead of only those entries
whose branch happens to own a row the section already renders.

Measured on the live board and re-verified at approval time:

| what | count |
|---|---|
| registry entries, every one naming a worktree | **23** |
| rows rendered in WORKING | **0** |
| agents whose branch has no row anywhere | **6** |
| agents whose row sits in `done` | **16** |

All five registry states render — `running`, `waiting`, `stalled`, `finished`,
`unknown` — and the row says which it is.

The plan is canonical; this brief is orientation plus the decisions already
settled.

### Settled — do not re-derive these

**The cause is the branch join at `AgentList.tsx:344`.** `agentByBranch` maps the
registry onto BRANCH rows, so a worker renders only if the pulse produced a row
for its branch AND `classify` put that row in WORKING. Both fail routinely for
reasons that have nothing to do with the worker: a scratch branch (`…-recut`),
the branch the board is served from (`main`), or a branch that merged and went
to DONE.

**NOT the PR-arm ordering.** An earlier draft blamed `classify`'s PR arm for
outranking the worker arm. It is wrong: `fleet.ts:4461` strips a closed PR
*before* `classify` is called (#376), so `classify` receives `pr` open-only and
the closed-PR path is unreachable from there. The two closed-PR rows seen in
WORKING that morning were **correct** — a live worker, no open PR, unlanded work
is exactly a WORKING row. Do not "fix" that.

**NOT a missing registry entry.** `the-agents-tab-filters-to-the-sprint` was
absent from the registry while its worker ran. The registry synthesizes entries
from WORKTREES (`registry.ts` `synthesizeEntry`), and that worktree had been
removed after its PR merged. The registry was right.

Both are recorded in the plan's Notes because both were believed, and each cost
a wave in an earlier draft.

**A worker is a fact about the FLEET; its branch's state is a fact about the
WORK.** A merged branch keeps its DONE row — that is a true statement about the
work — and the worker row in WORKING is a statement about the fleet. Both are
true at once; this wave does not move branch rows out of their sections.

**Where a branch row exists, join to it** and carry what it knows (plan, wave,
PR, git state) exactly as today. Where none exists, the row states only what the
registry knows: branch, worktree, state. **Absent is not false** — say nothing
about a plan the entry cannot name rather than inventing an empty field.

**`someone is on it` narrows to a genuinely running worker.** An idle, stalled,
finished or unknown worker says its own condition. A row whose usual state is a
lie teaches its reader to ignore the row.

### Done when

The plan's `## Done when` is the specification — items 1, 2, 3 and 5 belong to
this wave (4 is `Counted`, 6 is `Named`, 7–9 are `Reconciled`).

Lift these because a naive implementation passes without them:

- **Item 2** — a worker whose branch has no row anywhere still renders. The six
  here are the case, and they are the half that a branch-join fix silently
  misses.
- **Item 3** — a worker whose branch merged renders in WORKING *while that
  branch keeps its own row in DONE*. Assert both together, or an implementation
  that moves the branch row will pass.

Plus the repo's gates: `pnpm run test:board` green, `pnpm build:board` run in
THIS worktree and the artifact committed, a changeset with `'@plot-pm/board':
patch`, never edit versions by hand, `trash` not `rm`, Node 24 (`nvm use` —
pnpm crashes on 26).

`auto-dispatch-spawn.test.ts` fails under full-suite contention and passes when
run alone (`npx vitest run test/unit/auto-dispatch-spawn.test.ts` from
`packages/board`). If ONLY that file fails, re-run it alone and report it as the
known flake. Any other failure is real.

### Bookkeeping

Push your first real commit as soon as it exists. When the PR is created, append
`→ #<number>` to this wave's heading in the plan's `## Waves` section on main —
the form is `### Shown (Branch: …, PR: #N)`, **inside** the parenthetical. A
trailing `→ #N` after the heading parses as nothing.

### Scope guard

`packages/board/src/app/components/AgentList.tsx` and
`packages/board/src/app/lib/agent-rows/` own this change; `rows.tsx` holds the
row components since #387.

Do NOT change `classify` in `fleet.ts` — the sectioning of BRANCH rows is
correct and is not this wave's subject.

Nothing else is in flight on these files. If you find something the plan did not
anticipate, implement what you can and report the discovery rather than widening
the scope.
