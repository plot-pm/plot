## Implementation brief — a-spent-correction-budget-gets-a-fresh-agent (wave 1: The correction budget counts per slice)

- **Plan (canonical):** `docs/plans/2026-10-05-a-spent-correction-budget-gets-a-fresh-agent.md` on `main`
- **Approved:** 2026-10-05, jwloka, in-session
- **Branch:** `bug/the-correction-budget-counts-per-slice` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review on GitHub

Wave 2 (`feature/a-spent-correction-budget-gets-a-fresh-agent`) waits on this branch: its `freshAgentAfterCorrections` rule reads a per-slice count, and a per-agent count would start a fresh session for the wrong slice. Do not implement wave 2 here.

### What to build

**The correction count belongs to the agent, and it should belong to the slice.** `plot-worker-loop.sh` counts corrections in the manifest's `correctionAttempts` (`manifest_corrections`, `raise_manifest_corrections`, read at the `build_says_failed` branch near `:2886`). Nothing resets it when the agent hops. Measured 2026-10-05: agent `aec50e92` spent correction 1 on `infra/the-shell-loop-holds-unlanded-work` and correction 2 on `infra/the-loop-has-a-workflow`. On its third slice, `infra/the-loop-writes-through-ports`, the first CI failure read as "failed after 2 corrections", and the loop stopped with `PLOT-BLOCKED`. That slice never got a correction.

Build: `update_manifest_on_hop` (`:311`) sets `correctionAttempts` to 0 when the branch it leaves differs from the branch it joins — the same condition that already mints a new `resumeId` (`previous_branch != new_branch`). The marker text, the correction file, `Correction budget` and the `attempts` field keep their meaning; only the scope of the correction count changes. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The reset lives in the hop, not in the correction path.** The hop is the one writer that knows the slice changed, and it already round-trips the whole manifest object through one `node -e`. A reset in the correction path would have to compare branches itself, which is a second place that decides "same slice".

**Only a hop to a different branch resets.** A hop that lands on the same branch keeps `resumeId` today (`:282-285`) and must keep its count: the agent is still fixing the same slice, and resetting there would give a failing slice an unbounded budget. This is the shape a naive "zero on every hop" passes without.

**`attempts` is not touched.** The start budget stays per agent; the docstring at `:296-299` says `attempts` stays fixed because the node one-liner round-trips every field it does not name. That sentence must stay true for `attempts` and be amended for `correctionAttempts`, in the same change, so the comment does not claim that every field survives.

**No net shell growth.** `scripts/check-shell-lines.sh pr` refuses a pull request whose shell under `skills/` is longer than at its merge base; the gate stores no number and has no override. The reset is one expression inside the existing `node -e` plus one argument, so fold it into existing lines (for example set a flag inside the existing `if [ -n "$previous_branch" ] ...` and test it in the existing `manifest.wavesCount` statement) and trim the docstring to pay for any added line. If the change cannot be made without growth, remove shell elsewhere in the same change; do not move the logic into a new helper to hide it.

**The JS loop is not this slice.** `packages/domain/src/workflows/agent-loop.ts:212-235` reads `correctionAttempts` from its readings. It has no hop in this slice's scope (`the-worker-loop-runs-in-js` owns that loop). Check that it takes the count as a reading and does not keep its own; report what you find rather than editing it.

**Rules carried over unchanged:** absent is not false — an absent or unreadable manifest reads zero corrections (`manifest_corrections`), and a hand-started loop with no manifest has nothing to reset (`update_manifest_on_hop` returns 0 when the file is absent). Read the exit code, not the emptiness.

### Done when

The plan's `## Slices` entry for this wave and its Design section are the specification: the loop keys the correction count to the branch it works on, and a hop to a different branch resets it.

Then lift the assertions that exist because a naive implementation would pass without them:

- **An agent that spent its budget on slice A starts slice B with `Correction 1 of 2` on B's first failure.** Catches a count still stored per agent. Assert the correction file and the marker text, not only the manifest field.
- **A hop to the same branch keeps the count.** Catches "reset on every hop", which gives a failing slice an unbounded budget.
- **A hop leaves `attempts`, `relaunches` and `wavesCount` semantics as before.** Catches a reset written as a whole-object rewrite that drops fields.
- **The marker text for a spent budget names the slice's own count.** Catches a marker built from the agent's count after the reset.
- **A hand-started loop with no manifest hops without error.** Catches a reset that assumes the file exists.

Plus the repo's gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. `scripts/check-shell-lines.sh` also applies, as above. Run `nvm use` first (Node 24; `pnpm` crashes on 26) and `pnpm install` if `node_modules` is missing. Do not run `pnpm run test:e2e`.

Put the new tests beside the existing ones in `test/reconcile/correction.test.mjs` (see *"the correction counter is its own manifest field, not `attempts`"* at `:275` for the manifest fixture). Run the whole `test/reconcile/*.test.mjs` glob that `Local checks` names, not only that file.

A **changeset** is required: `.changeset/*.md` with the description FIRST and the `bumps:` block LAST, package `plot`, and a `plan:` line naming this plan inside the same comment block. A `bumps:` block or `plan:` line written first becomes the published release note.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-worker-loop.sh` — `update_manifest_on_hop` and its docstring
- `test/reconcile/correction.test.mjs`
- `.changeset/`

**Do not touch** the `corrections-spent` ending, `EndingReasonSchema`, `freshAgentAfterCorrections` or `.plot/state/fresh-agents.tsv` — that is wave 2. If you want the loop to say `corrections-spent` here, note it and move on.

Other branches in flight, verified at dispatch: none names these files (`git ls-remote --heads origin` shows no branch for this plan other than the one dispatched). `.changeset/` holds siblings' changesets — add your own, touch none.

If you find something the plan did not anticipate, report it rather than improvising outside scope. The plan's two Open Questions (a stronger model for the fresh session; same-gate failures going to a person at once) belong to wave 2 and are not yours to settle.
