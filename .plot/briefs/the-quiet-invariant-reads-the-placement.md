## Implementation brief — board-readings-take-the-domain-answer (wave: Quiet invariant)

- **Plan (canonical):** `docs/plans/2026-11-21-board-readings-take-the-domain-answer.md` on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3613 merged
- **Branch:** `bug/the-quiet-invariant-reads-the-placement` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Slice 7 of 8, issue #3159. The six slices before it are merged or in review. It touches different files from every other slice, so nothing waits on it and it waits on nothing.

### What to build

The quiet-kind invariant in `packages/board/test/unit/classifier-is-total.test.ts` (`it('the cross-product carries no PR-less abandoned/orphaned-claim note under waiting-on-you')`, at about `:690-712`) checks nothing it claims to check. It runs over `classify`, which returns `{ group, note }` and no `quietKind`, and it selects violators with the regex `/commits, no PR ever opened|claimed, no work committed/` over `result.note`. Rewording either `quietNote` sentence empties the violator list, and the test still passes with no check made.

Rebuild it on the layer that carries the kind: `withHandOver(rowsFromPulse(pulse, ages, 'plot', QUIET), agents)`. The sibling test *"no row reading someone-is-on-it or no-known-worker has group not-started"* (about `:720-760`) already builds exactly this shape, with a `FleetReading` of one plan, one slice and one branch. Copy its pulse construction. Run the product over the pulse axes: claim (claimed or not), commits ahead (`state` of `claimed` or `wip`), worker state, slice verdict, plan phase, and age past `QUIET`, with no PR. Select a violator by `row.quietKind` (`'abandoned'` or `'orphaned-claim'`) together with `row.group === 'waiting-on-you'`. Never read `row.note`.

Three further edits, all prose:

- A second case in the same `describe` feeds the predicate one hand-built row with `group: 'waiting-on-you'` and `quietKind: 'abandoned'` and expects it as a violator. This proves the predicate is not empty by construction.
- The two comments in `packages/board/src/server/fleet.ts` (about `:5774-5776` and `:5793-5795`, in the `wip` arm of `classify`) say `abandoned` and `orphaned-claim` go to *waiting on you*. `quietPlacement` (`packages/domain/src/rules/quiet.ts:196-206`) returns `'quiet'` for both, and the code under the comments uses its answer. Make both comments say `quiet`.
- In `docs/board-domain-model.md`, delete the `| pr | present, or **absent** | — |` row (about `:1099`) from the QUIET table. It names no forbidden value. The prose after the table already carries the rule.

The plan is canonical. This brief is orientation.

### The decisions the plan settles — do not re-derive them

**Read `quietKind` and `group`, never `note`.** A note is a sentence. The prior test tied its verdict to one sentence and so could be emptied by a reword. Do not replace the regex with another regex or a looser one.

**Keep the placement fact in the domain, not the test.** The test asserts the property *no abandoned or orphaned-claim row sits in waiting-on-you*. It does not restate `quietPlacement`'s switch. Do not import `quietPlacement` to compute the expected group.

**Change no production behaviour.** `quietPlacement` already returns `'quiet'` for both kinds, and `classify` already routes through it. The slice corrects two comments and one table. If the new invariant fails on real code, stop and report it. Do not adjust `classify`, `quietPlacement` or the predicate to make it pass.

**Prove the product reaches its target.** A product with no row of the kind passes for the wrong reason. Count the rows with `quietKind` of `abandoned` and of `orphaned-claim` and assert each count is above zero, the way the sibling test counts `unworked`.

**Carried rules.** Absent is not false: a row whose `quietKind` is `null` is not a violator. Read the group a row has, not the one its note suggests. New helpers you write are arrow functions.

### Done when

The plan's `## Done when` list is the specification. Beyond it:

- The invariant selects rows by `quietKind` and `group`. Rewording a `quietNote` sentence must leave it unchanged. Check this by changing a sentence locally, running the test, and reverting.
- The planted case fails the predicate for the right reason: it is listed as a violator, and removing the `quietKind` check from the predicate makes it pass wrongly.
- The product contains at least one `abandoned` row and one `orphaned-claim` row, and the test asserts it.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. It touches `docs/board-domain-model.md` and `fleet.ts` comments, so add a changeset (`'@plot-pm/board': patch`, description first, `bumps:` block last, `plan:` line inside the block). Commit no generated bundle.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### Quiet invariant` in the plan's `## Slices` section.

### Scope guard

This branch owns `packages/board/test/unit/classifier-is-total.test.ts`, the two comments in `packages/board/src/server/fleet.ts`, the QUIET table in `docs/board-domain-model.md`, and one changeset file. The other slices of this plan hold: `delivery-readings.ts` and `AgentRow` fixtures (slice 2, merged as #3652), the spike card (slice 3), the plan-store corpus (slice 4), `plot-verdicts.mjs` (slice 5) and `plot-ask.mjs spike` (slice 6), and `escalation.ts`, `worker-question.ts` and `fleet.ts:4623` (slice 8, the last). Slice 8 edits `questionNote` in `fleet.ts` far from the two comments here, so the merge is a known non-collision. If you find something the plan did not anticipate, report it rather than improvising outside scope.
