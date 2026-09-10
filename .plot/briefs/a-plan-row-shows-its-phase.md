## Implementation brief — a-plan-row-shows-its-phase (wave: Showing)

- **Plan (canonical):** `docs/plans/2026-09-09-a-plan-row-shows-its-phase.md` on `main`
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #866 merged
- **Branch:** `bug/a-plan-row-shows-its-phase` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — CI green, Definition of Done

Sole slice of a one-wave plan. Nothing waits on it and it waits on nothing.

### What to build

A PLAN row emitted by the SERVER shows its PR's CI state in slot 5 where it should show the plan's phase. Measured on the live board 2026-09-09:

```
PLAN  an-adopting-repo-installs-its-gates   865   green      draft   46m
PLAN  a-lifecycle-action-needs-a-controller-receipt  863   CI running  draft   14m
PLAN  the-supervisor-is-loaded-or-it-is-reported     864   green      draft    0m
```

The file is **`packages/board/src/app/lib/tuple-row.ts`** (1519 lines on `main`). Two arms project a PLAN row and only one sets `status`:

- `tupleFromPlan` (`:1140`) — the CLIENT arm, assembling a plan row from the branches under it. Sets `status: facts.phase` at `:1156`. **Correct already; do not change it.**
- `tupleFromRow`'s `if (kind === 'plan')` arm (`:628`) — the SERVER arm, for a plan on its own `idea/` branch. Spreads `...base` and never sets `status`, so it inherits `:529`:

```ts
const status = row.pr ? prStatus(row.pr) : stateStatus(row);
```

An idea branch's PR *is* the plan, so `row.pr` is always truthy and the ternary never reaches `stateStatus`.

Set `status` from the row's phase on the idea arm, and give the PR's CI state a rank below it. The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The phase is already on the wire. No new reading, no schema change.** `AgentRow.phase` exists (`packages/board/src/contract/schema.ts:2327`). The plan says `planFile` is resolved on the arm anyway; the phase is simpler still — it is a field on the row the arm already has. **Verified 2026-09-09**: `AgentRowSchema` carries `phase: z.enum(BOARD_PHASES).nullable().default(null)`. Adding a field to the contract for this would be re-deriving a reading that is already there.

**Both arms read the SAME field, so agreement is achievable.** `agent-rows/rows.tsx:571` feeds the client arm with `group.rows[0]?.phase ?? ''` — the identical `AgentRow.phase`. This is what makes the plan's assertion *both arms agree* a real property rather than two coincidences.

**The vocabulary is `BOARD_PHASES`, NOT the plan file's lifecycle words. The plan's own motivation is wrong on this, and it is the trap.** `BOARD_PHASES` is `['Discovery', 'Design', 'Development', 'Testing', 'Released']` (`packages/domain/src/entities/workflow.ts:35`). The plan writes *"A Draft awaiting approval says `Draft`"* — it will say **`Discovery`**. `Draft` and `Approved` are plan-file states; `AgentRow.phase` is the board's five-column partition, derived by `rowPhase` from the PAIR of plan phase and branch git state, never from the plan file alone. Do not "fix" this by reaching past `AgentRow.phase` for the raw plan state: the client arm shows `Discovery` for the same plan today, and matching it is the point. **A slice that makes the two arms print different vocabularies has failed its own assertion while appearing to satisfy the plan's prose.**

**`phase` is nullable, and the plan does not mention it.** Its docstring: *"null where no phase can honestly be named — a plan whose phase is rejected, superseded or simply unknown — and the cell then renders empty rather than guessing a column."* The client arm handles this by `?? ''`. Decide deliberately what the server arm does when `phase` is null: today that row shows its CI state, and an unconditional assignment turns a populated cell into an empty one. Renders-empty is the contract's stated intent for the phase FACT, but slot 5 going blank on a row that currently says something is a regression a reader will report. This is the one genuine design choice in the slice.

**The CI state is demoted, not deleted, and the plan declines to pick where it lands.** *"Where it goes is the slice's measurement, not this plan's guess."* Two shapes are named, and one is already built: `rows.tsx:715` uses `statusExtra` — *"a second element in the same cell, so `tupleFromPlan`'s phase is never at risk"* — for the client arm's PR fold. That is a working precedent for exactly this, with the ordering rule already argued. The constraint the plan does fix: **the phase is first.** Note `TupleRow.status` is a `string`, so a second element is a rendering-layer concern rather than a projection one; the projection may need nothing more than the phase.

**Not chosen, and settled** — the plan rejects both, do not revisit: setting the phase only when CI is green (one cell meaning two things depending on a third), and a separate phase column (two places to look for one fact; the six slots are a settled contract).

**Carried over unchanged:** the projection imports the contract's TYPES only — a gate asserts *"One import, and it is the contract's types"*, because the projection must not reach for behaviour. `tuple-row.ts` carries no React.

### Done when

The plan's `## Done when` list is the specification — the four `Asserted:` clauses under the `Showing` slice. Then these, which exist because a naive implementation passes without them:

**A test drives `tupleFromRow({kind: 'plan', pr: …})` with a truthy `pr`.** This is the one that catches the real defect, and the suite does not have it. `test/unit/tuple-row.test.ts:698` — *"gives a plan phase to the PLAN and to no other kind"* — looks like coverage of exactly this rule and is a **false witness**: its `projections.plan` entry (`:654`) calls `tupleFromPlan`, the arm that was never broken. The server arm has no entry in that table. **Expect the existing test to stay green whether or not you fix anything.** The same blind spot is in `test/integration/tuple-row.browser.test.ts:78`, whose `plan` fixture is also `tupleFromPlan`. A truthy `pr` is required: `row.pr` falsy takes the `stateStatus` path and never reproduces the bug.

**The defect is reproducible before you fix it — reproduce it first.** Measured 2026-09-09 on `main` with a throwaway vitest case: `tupleFromRow` on a `kind: 'plan'` row with `phase: 'Discovery'` and `pr: {number: 865, state: 'green', draft: true}` returns `status: "green"`. That is the board output above, in a unit test. Your new test should fail with `"green"` and pass with `"Discovery"`.

**An assertion that the two arms agree**, given the same phase — the plan's actual claim, and the only form that keeps the divergence from re-opening. Two arms each independently asserted against a literal can drift back apart; one assertion comparing them cannot.

**The null-phase case is asserted**, whichever behaviour you choose. It is the branch a reader will hit and no test covers it today.

Plus the repo's gates: `nvm use` (Node 24 — pnpm crashes on 26), `pnpm test`, `pnpm run test:board` (rebuilds the artifact), `pnpm run typecheck`, and a changeset. This is a `packages/board` change, so the changeset uses `'@plot-pm/board': patch` frontmatter with **no** `bumps:` skills block. **Do not run `pnpm run test:e2e`** — CI's gate, not a local one. Commit the rebuilt `skills/plot/scripts/board/board-server.mjs` with the source; a stale artifact fails new-feature tests reassuringly.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh            # or --draft while work is moving
```

It takes the title from the plan's wave heading. Three slice PRs opened with `gh pr create` on 2026-09-08 each took their title from the last commit subject instead.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Branches` section on `main`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/app/lib/tuple-row.ts`, its tests (`test/unit/tuple-row.test.ts`, `test/integration/tuple-row.browser.test.ts`), and the rebuilt board artifact. `agent-rows/rows.tsx` is read for reference — the client arm is correct and changing it re-opens the defect from the other direction.

**Measured 2026-09-09: no collision.** Of the seven other live `origin/*` branches, **zero** touch `tuple-row.ts` or `agent-rows/`. The artifact `board-server.mjs` is the usual shared file; on a conflict there take either side, run `pnpm build:board`, commit the result — never read its diff.

Two Open Questions in the plan are unresolved and both sit in your scope. **Does the `draft` badge stay?** It renders the PR's draft flag beside what becomes the phase, and the two read as one fact while meaning different things. **What does an idea branch with no PR show?** `Plan PRs: never` and `Review: in-session` both produce one; the arm assumes a PR exists and whether it renders at all is unmeasured. Answer them with a measurement or record why they stayed open.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
