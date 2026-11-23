## Implementation brief — reconcile-section-13-suggests-an-annotation (wave 1: Scan)

- **Plan (canonical):** docs/plans/2026-11-21-reconcile-section-13-suggests-an-annotation.md on main
- **Approved:** 2026-11-22, Jan Wloka, plan-PR #3606 merged
- **Branch:** `feature/reconcile-13-hint-names-only-the-tick` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** per repo convention (`Review: pr`, auto-review on)

This is the plan's only slice. Nothing waits on it and it waits on nothing.

### What to build

Issue #3586: section 13 ("Stale sprint tally") of `skills/plot/scripts/plot-reconcile-scan.sh` prints `fix: tick the item, or add an annotation explaining why it stays unchecked` (line 1866), but the loop reads nothing after the slug, so no annotation clears the finding. A Bitbucket consumer kept an item unchecked over a Delivered plan, added an HTML comment and a Scope Changes line, and still read `stale_tally=1`. The finding is correct and only the hint is wrong.

The change is two edits in place:

1. Line 1866: the hint reads `fix: tick the item`.
2. Line 1809: the body comment `# 11. Stale sprint tally` reads `# 13. Stale sprint tally`.

Add one assertion in `test/reconcile/scan.test.mjs` and one `plot` patch changeset. The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

- **Do not read an annotation.** The plan chose "name only the action the scan honours". An unchecked item over a Delivered or Released plan is already `done` to `scoreItem`, `plot-sprint-release.sh:72-79`, `deliver.ts:248` and `/plot-sprint close` step 2a. A kept-open state would exist in this one section only. Round 2 of the panel settled this; three of four jurors recommended it and the fourth accepted it.
- **Do not touch the member regex.** It is shared with `board.ts` and sections 9 to 11. Do not touch `annotateSprintItem`'s `branchPattern`, `sprint-annotation.ts:44-48`, or the `<!-- reconciled: <phase> -->` form from close step 2a.
- **Do not add a footer counter and do not change `stale_tally=`.** The literal summary assertion at `test/reconcile/scan.test.mjs:298` must hold unchanged.
- **Do not change `staleTally` (`workflows/reconcile.ts:125-130`), the `sprint-tally-stale` finding, or the board decoder (`entry/reconcile.ts:170`).** Their input and output do not change, so no corpus pair is needed.
- **Leave the header list entry at `:113` ("13. Stale sprint tally") and the comment at `:1986` ("13. Stale interrogation rounds").** `:1986` belongs to another section; its rename is out of scope.
- **Section 17 owns the release reading.** An unshipped `Release:` suppresses nothing, because a tag proves no completion.
- Absent is not false, and read the exit code, not the emptiness. Neither applies to a string edit, so do not widen the change.

### Done when

The plan's `## Done when` list (the slice line's `builds:` and `tests:` annotations) is the specification:

- `plot-reconcile-scan.sh` section 13's finding reads `fix: tick the item`, and `git grep 'add an annotation explaining'` returns nothing.
- The body comment at `:1809` reads "13.".
- `test/reconcile/scan.test.mjs` asserts, in the existing section 13 case (fixture `stRepo`, near line 1700-1870), that the finding's hint contains `fix: tick the item` and no `annotation`. The negative half exists because a naive edit could append text and still match the positive one. Reuse the fixture; add no new one.
- The existing assertions `stale_tally=2` (line 1849 and 1866) and the summary line at `:298` pass unchanged. They catch a change that moves the counter or the footer.

Add a changeset in `.changeset/` for package `plot`, patch, description first, no `bumps:` block needed unless a skill version moves (`plot-reconcile` is the skill; patch it there). Run `./scripts/check-changeset-packages.sh`.

Gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. `scripts/check-shell-lines.sh pr` has no headroom: edit the two lines in place and add none. The gate counts commands, not lines, and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves). Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists. Do not commit a rebuilt board bundle.

### Scope guard

This branch owns `skills/plot/scripts/plot-reconcile-scan.sh` (two lines), `test/reconcile/scan.test.mjs` (one assertion) and one new file in `.changeset/`. No other branch of this plan exists. Verified at dispatch: no other open slice in this brief's scope edits the section 13 hint. If you find something the plan did not anticipate, report it rather than improvising outside scope.
