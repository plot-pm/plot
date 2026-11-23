## Implementation brief — board-readings-take-the-domain-answer (wave 5: Spike verdicts)

- **Plan (canonical):** `docs/plans/2026-11-21-board-readings-take-the-domain-answer.md` on `main`
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3613 merged
- **Branch:** `bug/the-verdict-line-drops-the-spike-columns` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

No slice waits on this one and it reads nothing another slice builds. It touches `packages/board/src/server/entry/verdicts.ts` and two test files only.

### What to build

`slicesFrom` (`packages/board/src/server/entry/verdicts.ts`, the parse near `:86-116`) accepts three optional spike columns after the states column: `spikes`, `spikeApproved` and `planSpikes`. Nothing produces them. `plot-fleet-scan.sh` has 0 lines matching `spike`, and `skills/plot/scripts/README.md:159` states that no shipped script calls `plot-verdicts.mjs`. The parse therefore tests columns that no caller sends, and the doc comment (`:65-71`) describes a format that does not exist.

After this change `slicesFrom` parses exactly three columns, `outstanding<TAB>phase<TAB>state|state|...`, and **rejects a line with more**, with the same refusal as any malformed line (the whole batch refuses; exit 2 through the bundle). `SliceLine` loses `spike` and `spikeApproved`. The `spikeSliceOf` import and the `planSpikes`/`spikeAt` computation go. The doc comment loses the spike sentence and keeps the rest.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The bundle stays.** Operator decision, 2026-11-21: remove only the three spike columns from `plot-verdicts.mjs`, not the bundle. `test/reconcile/scan-spike-readings.test.mjs` still names it, and deleting a shipped bundle is a different plan. Do not remove `plot-verdicts.mjs` or its README row; the README row at `:159` already says no shipped script calls it, so leave it as is.

**The spike exception keeps its proof, elsewhere.** The spike exception for a Design plan is decided by the domain walk (`slice-readings.ts`), not by this parse. What still proves it, and must stay **unchanged**: `packages/domain/test/slice-readings.test.ts:17-19` and the three `--list-eligible` tests at `scan-spike-readings.test.mjs:176-186`. If one of those fails after your change, stop and report it; do not edit it to pass.

**A longer line is refused, not ignored.** Ignoring extra columns would keep a silent second format. The repo's rule applies here: an unreadable line must not become the most permissive answer. Refuse the whole batch.

**Do not touch `PlanMetaSchema` / `PlanSchema` tracer tests.** The describes at `a-slice-is-marked-spike.test.ts:6` (`PlanMetaSchema — spike readings`) and `:34` (`PlanSchema — tracer`) test fields that have producers. Only the two describes named below go.

### Done when

The plan's `## Done when` list for this slice is the specification. In test terms:

- `packages/board/test/unit/a-slice-is-marked-spike.test.ts` loses `slicesFrom — the three spike columns` (`:40`) and the four `answer` tests at `:67-86`: *offers the spike when it stands alone*, *offers neither branch of a slice holding the spike and a sibling*, *offers nothing where the plan holds two annotations*, *offers nothing where the second annotation sits in a slice the scan does not show*. Remove the imports they alone used.
- `test/reconcile/scan-spike-readings.test.mjs` loses the two `viaShell` column tests (`:155`, `:164`), the `viaShell` constant (`:141`), and the `node` shim tap that recorded stdin for them, if nothing else reads it. Its header (`:1-8`) is rewritten to state what the file tests now: the scan puts `tracer` on the pulse plan, the widened `P` row still reads the phase, and `--list-eligible` offers the approved spike of a Design plan. Check that `before`/`after` still clean up everything the removed tap created.
- **New test** (the one a naive change would pass without): `slicesFrom` refuses a six-column line. It catches an implementation that only deletes the destructured names and leaves extra columns silently ignored.
- A three-column line, and a line whose states field is empty, still parse as before.

Plus: add a changeset (`.changeset/<name>.md`, package `@plot-pm/board`, description first, `bumps:` block last, at least 20 characters of description; `./scripts/check-changeset-packages.sh` checks it). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e`. Run `pnpm build:board` locally only to test, and commit no bundle (`scripts/check-no-bundle-diff.sh` refuses one). The change touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. In a `packages/board` file you edit, a function you write is an arrow.

### Bookkeeping

Push the first real commit as soon as it exists. When the PR opens, append `→ #<number>` to this branch's line under `### Spike verdicts` in the plan's `## Slices` section. Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`.

### Scope guard

This branch owns `packages/board/src/server/entry/verdicts.ts`, `packages/board/test/unit/a-slice-is-marked-spike.test.ts`, `test/reconcile/scan-spike-readings.test.mjs` and a changeset. Other branches of this plan hold other files: `the-plan-store-corpus-checks-both-lists` (`plan-store.corpus.test.ts`), `plot-implement-asks-for-the-spike` (`entry/main.ts`, `skills/plot-implement/SKILL.md`, `skills/plot/scripts/README.md`, `CLAUDE.md`), and `the-spike-card-names-its-reason` (card facts and presentation, PR #3658). `skills/plot/scripts/README.md` is edited by the implement-spike slice, so do not edit it here.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
