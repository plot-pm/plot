## Implementation brief — not-started-counts-plans (single wave)

- **Plan (canonical):** `docs/plans/2026-08-17-not-started-counts-plans.md` on `main`
- **Approved:** 2026-08-17, Jan Wloka, plan-PR #188 merged (one interrogation round)
- **Branch:** `feature/not-started-counts-plans` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

NOT STARTED renders **one row per plan** with its branches folded
beneath it, sorted by the plan's own clock.

### The measurement

Every row in that section, live:

```
plan=activity-shows-itself  branch=feature/activity-marker-glows      pr=—  age=—
plan=activity-shows-itself  branch=feature/group-shows-inner-activity pr=—  age=—
plan=activity-shows-itself  branch=feature/unpushed-work-shows-still  pr=—  age=—
plan=plot-sprint-support    branch=feature/plot-sprint-support        pr=—  age=—
```

**`pr=—` and `age=—` on all of them.** The branch name comes from the
plan's `## Branches` section — it is a *plan for a branch*, not a branch.
**6 rows for 4 plans**, and `activity-shows-itself` appears three times
for one waiting plan.

Compare WAITING ON YOU in the same pulse: 4 rows, **all 4 with a real PR
and a real age**. There the branch is the subject because it holds work
that exists.

### Six decisions the plan settles — do not re-derive them

**Fold, do not summarise away.** The branch names are the plan's own
words for what it will do. They are collapsed by default and
**expandable**, never discarded — a reader who wants them must not have
to open the plan file.

**No inner fold where there is nothing to fold.** A plan with one
unstarted wave gets no expander: a control that reveals a row it already
shows is noise.

**The wave summary is derived from the group's own rows.** Measured:
`waveSummary` lives on the CARD; a row knows only its own wave. But
`groupByPlan` (`AgentList.tsx:394`) already holds every row of the plan
in this section, so counting them and reading their states answers *how
many, and which is first* with **no contract change**.

Record the limit rather than hiding it: this counts the waves **in this
section**, so a plan whose first wave already merged reports the
remainder, not the plan file's total. That is the honest number for the
question the section asks.

**The section's sort is broken today — fix it.** Measured,
`AgentList.tsx:401`:

```ts
const urgency = (g: PlanGroup) => Math.max(...g.rows.map((r) => r.ageMinutes ?? -1));
```

In NOT STARTED `ageMinutes` is `null` on **every** row, so every group
scores `-1` and the sort does nothing. `plot-sprint-support` — approved
**187 days** ago — sits wherever insertion order puts it, beside a plan
from this afternoon.

Sort this section by `waitingDays`, **oldest first**. It is the only
clock that ticks here. Do **not** sort startable-first: burying a
six-month-old plan under a fresh one hides exactly the drift this section
exists to surface.

**Deferred branches keep their own rows, beneath their own plan row.**
`state === 'deferred'` branches **were** started — they may hold commits
and a PR — and landed here because someone shelved them. `fleet.ts`
warns what flattening them costs: an earlier version wrote `deferred` as
the note and *"a branch started and then shelved read as never begun,
with its age and its PR erased."* A separate "shelved" section was
rejected: it cuts a branch from the plan that explains it.

**The indicator sits with the plan on a plan row**, and with the branch
on a deferred row. Same rule as every other section — the marker belongs
to whatever is waiting — applied to a different subject.

### Done when

- **A plan with three unstarted waves shows ONE row by default**, with
  its branches folded beneath. Assert the live shape:
  `activity-shows-itself` with waves 2–4 unstarted renders one row.
- **The fold OPENS and the three branch names come back.** The pairing
  that matters: an implementation that summarises the waves away passes
  the assertion above and loses the plan's own words.
- **A plan with ONE unstarted wave gets no inner fold.**
- **The row's age is `waitingDays`, not `ageMinutes`.** Assert
  `plot-sprint-support` reads 187 days rather than blank.
- **The section sorts by `waitingDays`, oldest first.** Assert
  `plot-sprint-support` sorts above a plan approved today. The pairing:
  the existing `ageMinutes` sort scores every group `-1` here, so a test
  that only checks "the groups are ordered" passes against a sort that
  does nothing.
- **The wave summary names how many remain and which is first**, derived
  from the group's rows, with **no contract field added**.
- **The summary counts only what is in this section.** Assert a plan
  whose first wave already merged reports the remainder.
- **A deferred branch keeps its OWN row, with its own PR and age**,
  beneath its own plan row.
- **Every other section is unchanged.** Assert WAITING ON YOU, WORKING,
  WAITING ON A MACHINE, QUIET and DONE still render branch rows.
- **The grid tracks do not move.** Assert a plan row's columns land at
  the same x as a branch row's — the section boundary must not break
  alignment.
- **The indicator sits with the plan** on a plan row, and with the branch
  on a deferred row.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
`pnpm run validate` all pass; `pnpm build:board` run **in your own
worktree** and the artifact committed (CI gates on no-diff); a changeset
is present with its `bumps:` block. **Do not edit versions by hand.**

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. **Check `git branch
--show-current` is `main` before that edit** — an agent today committed
plan bookkeeping onto another agent's branch by not checking.

**Push your first real commit as soon as it exists**, and **push again
immediately after any rebase**.

### Scope guard

`packages/board/src/app/components/AgentList.tsx` and its tests.

**Do NOT change the contract.** Everything needed is on the rows already:
`plan`, `planFile`, `waitingDays`, `state`, `note`.

**Do NOT touch `classify()`, the grouping into sections, or the server.**
Which section a row lands in is settled; this changes how one section
renders what it is given.

**Do NOT touch `[data-live-dot]`, `[data-change-mark]`,
`[data-stuck-cue]` or `[data-activity-mark]`.** Four marks, four
meanings, and no mark implemented by modifying another.

**`green-never-outranks-unknown` (#187) is under review** and will touch
`prState` and the note wording — not your file. If it lands while you
work, rebase rather than race.

### Notes on this repo

Vitest runs with `environment: 'node'` — no jsdom. Recent waves put their
decisions in **exported pure functions** and asserted those. The sort,
the wave summary and the fold-or-not predicate all reduce to functions;
alignment and the fold's interaction want the browser suite.

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as
`-merge`: on a conflict there, take **either** side, run
`pnpm build:board`, `git add` it, continue. **Do not read that diff.**

**Two known CI flakes — neither is yours, do not "fix" them:**
1. Playwright's CDN has returned `403 — this service is not available in
   your location` while installing a browser.
2. `discovery.test.mjs` counts `plot-board-branch-*` in a **shared**
   `os.tmpdir()`; CI has also seen `ENOTEMPTY` tearing down its temp
   `.git`. A recorded finding awaiting its own plan.

**GitHub's API returned `503` repeatedly this afternoon.** If a push or a
merge fails that way, retry rather than concluding anything about the
code.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
