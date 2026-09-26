## Implementation brief — a-draft-plan-asks-for-a-decision

- **Plan (canonical):** `docs/plans/2026-09-26-a-draft-plan-asks-for-a-decision.md` on `main`
- **Approved:** 2026-09-26, Jan Wloka, in-session after panel (round 1)
- **Branch:** `bug/a-draft-plan-asks-for-a-decision` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code
- **Issue:** #1009

One slice, one wave. Nothing waits on it and it waits on nothing.

### What to build

A plan at `Draft` appears nowhere on the Agents tab. Measured 2026-09-26: `/api/fleet` served 28 rows, 0 without a branch, 0 Draft plans, while an operator and an agent worked on one. Every row on that tab derives from a branch, and a Draft plan correctly has none: branches are cut at dispatch, after approval.

Add a second non-branch row source to WAITING ON YOU, the sibling of `brokenAgentRows` (`src/app/lib/agent-rows/working-agents.ts:80`). One row per Draft plan that has no branch row. The note is `DRAFT_PLAN_NOTE` (`src/contract/schema.ts:1570`), and the row names the plan's `rounds`. Carry the Draft plans on the fleet payload as a new field.

The plan is canonical. This brief gives orientation only.

### Facts the plan did not have — verified at dispatch

**The pulse cannot be the source.** `plot-fleet-scan.sh:3824` drops a plan with no slice lines (`[ -n "$wave_lines" ] || … continue`), and the scan's `P` line (`:2966`) carries no `rounds`. A Draft plan that has not named its slices yet never reaches `rowsFromPulse`. The plan forbids a scan change, so do not add one.

**The server already reads the plan estate beside the pulse.** `fleet.ts:36` imports `planStatusBySlug` from `board.ts:2250`, and `activeSprints` (`fleet.ts:7471`) calls it. That reader parses every working-tree plan with `plot-plan-meta.sh`, which emits `phase` and `rounds` (`PlanMetaSchema.rounds`, `schema.ts:172`). Take the Draft plans from the same estate read, not from a second parse. Its comment says a Draft plan lives on a prefixed branch; under `Review: in-session` (257 plans against 88 for `pr`) it lives in the working tree, which is the case this plan targets.

**The payload has no plans list today.** `FleetShape` (`schema.ts:3777`) carries `rows`, `slices`, `agents`, `sprints` and no plan entries. The new field is a contract change on both sides.

### Decisions the plan settles — do not re-derive them

**Not the per-branch classifier.** The `draft` arm at `fleet.ts:4405-4429` needs a branch by construction; that is the defect. Leave the arm untouched: it is correct for the plans it can see.

**A non-branch row is not a new kind.** `brokenAgentRows` already puts an agent, not a branch, in WAITING ON YOU. The Draft plan row is the second instance of that pattern. Do not reopen whether the tab's subject changes.

**Dedup by branch row, not by phase.** A Draft plan under `Impl: same branch` already has a row through the `draft` arm. Emit the plan row only when no row in the row set belongs to that plan. Use the unfiltered `fleet.rows` for the test, as `AgentList.tsx:422-428` does for the agent join: the sprint filter hides rows, not facts.

**Rounds is reported, never judged.** Absent `rounds` means unquestioned; `Rounds: 0` means interrogated and found nothing (`schema.ts:160-163`). Keep the field optional end to end. A `.default(0)` in the new schema flattens the two and fails the fourth Done-when line.

**No action on the row.** No approve button, no phase write. The row says a decision is owed.

### Rules carried over

- **The client casts the fleet and never parses it.** Zod defaults do not apply in the browser, so a new `FleetShape` field is `undefined` in the renderer on an older payload. Read it as `fleet?.draftPlans ?? []` (or whatever the field is named) at the call site beside `brokenAgentRows(fleet?.agents ?? [], …)`.
- **Absent is not false.** `rounds: undefined` and `rounds: 0` render differently; test both.
- **Browser tests load the built artifact.** Run `pnpm build:board` before a browser test, or a stale `board-server.mjs` fails the new test for the wrong reason.

### Done when

The plan's `## Done when` list is the specification. The assertions a naive implementation passes without:

- **Draft plan WITH a branch row appears once.** Catches a source that filters on phase only and doubles the `same branch` plan.
- **Approved, Delivered and Released plans produce no row.** Catches a source that reads "no branch row" as the trigger; a Released plan drains from the pulse and has no row either.
- **No `Rounds:` field vs `Rounds: 0` render differently.** Catches a schema default or a `?? 0` in the renderer.
- Each of the four as a unit test against the row function, plus one browser test in `test/integration/agents-tab.browser.test.ts` (or a sibling) that the row is seen. `test/unit/broken-agent.test.ts` is the model for the unit tests.

Plus the repo gates: `pnpm test`, `pnpm run test:board` (rebuilds the artifact), `pnpm run typecheck`, `pnpm run test:contracts`. Commit the rebuilt `skills/plot/scripts/board/board-server.mjs`. Add a changeset with `'@plot-pm/board': patch` frontmatter, description first. Not `test:e2e` — CI runs it.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's heading in the plan's `## Slices` section on `main`.

### Scope guard

This branch owns:

- `packages/board/src/app/lib/agent-rows/working-agents.ts` (or a sibling file for the new row source)
- `packages/board/src/app/components/AgentList.tsx` — the WAITING ON YOU composition only
- `packages/board/src/contract/schema.ts` — the new fleet field
- `packages/board/src/server/fleet.ts` — populating the field; not the classifier
- new tests under `packages/board/test/unit/` and `packages/board/test/integration/`
- the rebuilt board artifact and one changeset

Other branches in flight at dispatch: `bug/a-dispatch-does-not-hold-the-loop` (`server/dispatch.ts`, `app/lib/agent-rows/menus.tsx`) and the `a-decision-reads-the-index` slices. Expect a conflict on `board-server.mjs` only; resolve it by rebuilding, per the Definition of Done.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
