# Brief: bug/not-started-shows-approved-plans

Implement wave 1 of `docs/plans/2026-08-18-a-blocked-wave-is-not-eligible.md`.

Read it first. The rule was settled with the operator: **NOT STARTED shows
Approved plans, and nothing else.**

## The bug, measured twice

The board groups rows by **branch state** and never asks the plan's **phase**.
A branch with no ref reads as "never started" — which is true of a branch
nobody created and equally true of one deleted at merge four months ago.

First measurement, 10 plans in NOT STARTED:

```
approved   3   ← the only ones /plot-dispatch will start
draft      7   ← refused with "plan not approved yet"
released   1   ← plot-sprint-support, shipped in v1.0.0-beta.3
```

Second measurement, after a plan-hygiene sweep set 39 delivered plans to
`Released` — **20 rows, ten of them Released**, each offering a merged branch:

```
Released  a-squashed-branch-is-…  bug/a-squashed-branch   eligible — nobody has taken it
Released  bb-state-vocabulary     bug/bb-state-vocabulary eligible — nobody has taken it
Released  the-gate-reads-what-w…  bug/the-gate-reads…     eligible — nobody has taken it
```

All three shipped in v2.5.1 the same day. **The board is advertising released
work as available**, and the sweep did not cause it — it multiplied a defect
that had been hiding behind one row.

## What to build

**Filter the section on the plan's phase first: `Approved`, and nothing else.**

| Phase | May an agent take it? | Section |
|---|---|---|
| Draft | no — waits on approval | WAITING ON YOU |
| **Approved** | **yes** | **NOT STARTED** |
| Delivered | no — work is done | DONE |
| Released | no — shipped | DONE |

That is not a new rule layered on top; it **is** the phase model. `Approved` is
precisely the phase meaning *decided, not yet done*, and the only one
`/plot-dispatch` will start.

A `Draft` plan moves to WAITING ON YOU and **names what it waits on** —
approval — rather than offering a branch nobody may claim.

## Do not

- **Do not infer the phase from the branches.** The plan states it; read it
  from there. Inferring is the defect.
- **Do not drop the branch-state logic.** Within `Approved`, branch state is
  what refines the answer — that is wave 2 (`bug/a-blocked-branch-says-it-is-blocked`)
  and is not yours. Keep today's behaviour for Approved plans exactly.
- **Do not touch the other sections' rules.** WORKING, WAITING ON A MACHINE and
  DONE are unchanged.

## Definition of Done

- Each of the four phases lands in its documented section, driven from one
  fixture
- A `Released` plan whose branch has no ref is **not** in NOT STARTED —
  reproduce the measured case (`plot-sprint-support`, `bb-state-vocabulary`)
  and verify it fails against the unchanged code
- A `Draft` plan is in WAITING ON YOU and says it waits on approval
- An `Approved` plan with unclaimed branches is unchanged
- A plan that becomes Approved changes section on the next pulse, without a
  restart
- `pnpm run test:board` and `pnpm run typecheck` pass
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e` pass — run the
  suites **one at a time**; concurrent runs were measured producing false
  timeout failures
- `pnpm build:board` run in THIS worktree and the artifact committed
- A changeset with a `bumps:` block

## A scan defect you will see, and must not fix

`plot-fleet-scan.sh --json` currently takes 34 s on this repo and the board
times out at 30 s (`fleet.ts:260`), so the live board serves a stale pulse and
reports `Command failed`. That is
`docs/plans/2026-08-18-the-scan-asks-once-not-once-per-branch.md`, a separate
plan with its own branches. **Work against fixtures, not the live board**, and
do not fix the scan here.

## Platform note

CI runs Linux; you are probably on macOS. Faults caught this way: `stat -f`
does not fail cleanly on GNU, and `/usr/bin:/bin` is not an isolated PATH
because CI ships a real `gh` there.

If you find something the plan did not anticipate, implement what you can and
**report the discovery** rather than improvising.
