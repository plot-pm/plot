## Implementation brief — open-plot-review-findings-from-the (slice: Desk endings)

- **Plan (canonical):** `docs/plans/2026-11-03-open-plot-review-findings-from-the.md` on `main`
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3075 merged
- **Branch:** `bug/holding-work-reads-unpushed-commits` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** the `plot/review` gate (`Review: pr`); no HIGH is open on this slice's finding.

This slice has no `waits:` marker. Its files (`rules/ending-action.ts`, `registryd.ts`) are not edited by the other six slices, except that `bug/an-idle-episode-survives-a-restart` edits `registryd-main.ts` (a different file). Slices 1 to 3 wait on unmerged branches and are not eligible yet.

### What to build

A merged desk that still holds an unpushed commit gets `leave` from `endingAction` and nobody is asked. `endingTableAnswer` (`packages/domain/src/rules/ending-action.ts:352`) answers `leave` for a `holding-work` ending when `prMerged === 'merged' && dirtyTree === 'no'`. `dirtyTree` comes from `dirtyTreeReading(heldFiles)` (`packages/fleet/src/server/entry/registryd.ts:1267`), which reads dirty paths only. The agent loop also ends `holding-work` for `unpushed-commits` (`packages/domain/src/workflows/agent-loop.ts:155-162`), so the one ending reason with two causes is read for one of them.

Add an unpushed-commits reading to `EndingActionReadings` (`none` | `some` | `unanswerable`). The domain rule decides; the controller reads. In `freshAgentDecisions` (`registryd.ts:1259`) read it through the existing `Trees.unpushedCommits` port (`packages/domain/src/ports/trees.ts:457`, implemented at `adapters/trees/trees-git.ts:559`). The second `endingAction` call site (`registryd.ts:1816-1823`, `nothingDoneDecisions`) passes filler with a comment, like its other filler fields.

A merged `holding-work` desk answers `leave` only when the tree is clean AND the unpushed reading is `none`. With an unpushed commit (`some`) or `unanswerable`, it answers `needs-a-person`, never `start-fresh` and never `leave`. No shell line changes; `plot-worker-state.sh` is not the source.

The plan is canonical: read `## Design › Desk endings` and `## Tests › Desk endings tests`.

### Settled decisions — do not re-derive

- **The decision stays in the domain rule.** The alternative, a controller that overrides the verdict after the call, puts a rule in `.tsx`-style controller code and cannot be unit-tested without a fleet fixture. Layering rule (CLAUDE.md): controller calls domain, never decides.
- **Use `Trees.unpushedCommits`, not a new port method and not a script.** The port exists (`ports/trees.ts:457`) and the adapter runs `git rev-list HEAD --not --remotes`. `heldFiles` is not the source: it lists dirty paths and cannot see a committed-but-unpushed change.
- **`unanswerable` takes the destructive-averse arm.** This file already states the rule for every reading: absent is not false, an unreadable tree is not a clean tree. A failed `PortResult` maps to `unanswerable`, never to `none`.
- **`needs-a-person`, not `start-fresh`, for a merged desk with an unpushed commit.** The PR already merged, so a fresh session has nothing to continue and the commit may be stranded work; only a person decides.
- **The `endingAsked` guard still applies** (`needs-a-person` becomes `leave` after one ask). Do not touch it; the existing "one ask per ending" behaviour stands.
- **Ask only where the answer decides**, as `nothingDoneDecisions` does: read the unpushed commits for a `holding-work` ending where `prMerged === 'merged'` and the tree is clean. Every other candidate gets filler, because no other row reads the field.

### Done when

The plan's `## Done when` and `## Tests › Desk endings tests` are the specification:

- `packages/domain/test/rules-ending-action.test.ts:76-82` changes on purpose: the loop gains the unpushed reading and `leave` needs `none`. New: a merged `holding-work` desk with `some` or `unanswerable` answers `needs-a-person` and never `start-fresh`. This catches a rule that only adds the field and never reads it.
- `packages/fleet/test/unit/fresh-agent-tick.test.ts`, new: `a merged desk with a clean tree and an unpushed commit asks a person and starts no agent`. The fixture needs a real unpushed commit (the port fake answers `some`), otherwise a controller that passes filler `none` also passes.
- Every existing `endingAction` test filler of `EndingActionReadings` gets the new field; a missing field is a type error, so `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` finds them.

Plus: a changeset (`plot` patch, description first, `bumps:` block last; `./scripts/check-changeset-packages.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in `CI suites` run in CI and a failure there comes back as a correction. Do not run `test:e2e`. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` is not in play. New functions are arrows.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. Append `→ #<number>` to this branch's line under `## Slices › Desk endings` in the plan. Push the first real commit as soon as it exists.

### Scope guard

Owned by this branch: `packages/domain/src/rules/ending-action.ts`, `packages/fleet/src/server/entry/registryd.ts` (the two `endingAction` call sites and the fresh-agent candidate read), and their tests. In flight elsewhere: `bug/an-idle-episode-survives-a-restart` (`slice-idle.ts`, `registryd-main.ts`), `bug/the-plan-comment-parses-what-it-wrote`, `bug/the-review-comment-tests-can-fail`; none of them edits the files above. #3068's `feature/fleetd-merges-as-the-merger-app` rewrites `slice-pr-next.ts`, not these.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
