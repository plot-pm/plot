## Implementation brief — a-stale-pulse-keeps-the-sections-it-had (A failed scan keeps the last sections)

- **Plan (canonical):** `docs/plans/2026-09-25-a-stale-pulse-keeps-the-sections-it-had.md` on `main` — **read it in full first**
- **Approved:** 2026-09-25, in-session after panel
- **Branch:** `bug/a-failed-scan-keeps-the-last-sections` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Issue:** #995

### START HERE: the mechanism is NOT known, and finding it is your first task

The plan's first draft blamed `ahead = 0` reading as landed. **A panel refuted it and the refutation was verified**: `packages/domain/src/rules/branch-state.ts:215` returns `claimed` when `realCommitsAhead === 0`, and `merged` is returned only at `:183` (a merge subject was found) or `:187`/`:233` (`pr === 'MERGED'`). A branch with a ref, no commits and no PR **cannot** reach `merged` by that path.

So the reported symptom — five approved, unstarted plans rendering `delivered · merged` under DONE, with no PR and no code on `main` — has **no established cause**. Two candidates, in the plan, neither verified:

- the pulse's refs are simply old, making those rows ones the board had never seen (which is the plan's own *unplaced* case rather than a mis-classification);
- `classify` reaches `done` by **phase** at `fleet.ts:4366` and `:4558`, which fits the observed `delivered` wording but is weakened by all five plans reading `Approved` on `main`.

**Do not build the rule until you can name the arm.** Reproduce it: a board with a successful pulse, then a failed scan, then a freshly dispatched slice. If the cause turns out to be something the rule below does not fix, say so in the plan and stop — that is a correct outcome, not a failure.

### Then: the rule

On a failed or timed-out scan, a row **keeps the section the last successful scan gave it**. Nothing is re-derived from data the banner has already labelled stale. A row absent from the last good pulse renders **unplaced** — shown, but never sorted into a section, and least of all DONE.

`coldState` (`AgentList.tsx:563`) is the model: a named state deciding whether sections may be rendered. This adds a warm-stale arm beside it. The cold arm's own comment states the principle — *"the sections are SUPPRESSED rather than filled. Rendering `none` per section is a claim about the repository"* — and it must keep working unchanged.

**Verify before you build:** the plan asserts the last successful pulse is already retained. Confirm whether the previous **section assignment** is retained, or only the raw pulse. If sections were never stored, carrying one forward means storing something that does not exist today, and the slice is larger than the plan claims — record that.

### This is a trade, not a strict improvement

A slice that genuinely merges during an outage keeps its old section and reads as still working. That is accepted deliberately: a stale *working* row understates progress, a stale *done* row hides work somebody is waiting on, and only the second is acted on by `auto-deliver`. Do not "fix" it by re-deriving.

### Done when

See the plan's `## Done when` — every bullet, including that the arm is identified and named **before** the rule is built.

### Repo gates

- `nvm use` first — Node 24. `pnpm` crashes on 26.
- `pnpm test`, `pnpm run test:board`, `pnpm run typecheck`.
- `pnpm run build:board` before committing — CI has a no-diff gate on the artifact.
- **Do not run `pnpm run test:e2e`** — that is CI's gate, not a local one.
- A changeset naming `@plot-pm/board`, description first.
