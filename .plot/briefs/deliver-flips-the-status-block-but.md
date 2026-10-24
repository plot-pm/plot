## Implementation brief — deliver-flips-the-status-block-but (wave 1: Delivery writes both formats)

- **Plan (canonical):** `docs/plans/2026-10-24-deliver-flips-the-status-block-but.md` on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2492 merged
- **Branch:** `bug/deliver-flips-the-status-block-but` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

The plan's only wave. Nothing waits on it and it waits on nothing.

### What to build

Issue #2439 (plot 2.28.0): a plan with YAML front matter (`status: Approved`, `phase: Approved`) plus a `## Status` block, delivered through `/plot-deliver`, printed `phase=flipped` and left the front matter at `Approved`. The reconcile scan then named `status: 'Delivered' disagrees with phase: 'Approved'` for each of three plans (`skills/plot/scripts/plot-reconcile-scan.sh:1011`). Your fix is the one that makes a delivered two-format plan read the same in both places, or refuses before writing.

The writer is no longer shell. `flipStatusValue` in `packages/domain/src/rules/plan-record-edit.ts:70` flips the first `State:`/`Phase:` line inside `## Status` and nothing else. It never touches front matter. Its callers are `packages/board/src/server/entry/deliver.ts` and `packages/board/src/server/entry/approve.ts`. Read `plot-undeliver.sh` as well (it flips at line 351): the plan names `plot-approve` and `plot-undeliver` as the same shape, and the fix must not recur on the next transition.

Start by reproducing, as the plan's Approach says, on the reporter's fixture: front matter `status:`+`phase:` plus a `## Status` block, all `Approved`, delivered through the real entry point. The open question is whether this reproduces on current `main` or only on the 2.28.0 plugin. If it does not reproduce, say so in the PR, keep the regression test, and report what changed.

### Settled — do not re-derive

**The parser is not a witness for the front matter.** `fef2cf296` (#944) made the parser read the `## Status` block before front matter, and `planPhaseOf` in `packages/domain/src/rules/phase-gate.ts:50` does the same. So the read-back `b147e6a6b` (#924) added returns `delivered` from the block alone, however stale the front matter is. The scan still compares the two fields, so only the scan sees the disagreement. A verification that asks `planPhaseOf` or `plot-plan-meta.sh` proves nothing here. Check `status:` and `phase:` directly, or run the scan.

**Front matter reads `status:` first, then `phase:`, first occurrence of each wins** (`frontMatterPhaseOf`, `phase-gate.ts:29`). A fix that writes only one key leaves the other for the scan to read. Cover both.

**Decide flip-both versus refuse, and say which and why in the PR.** The issue accepts either. Flip-both repairs without a person but writes a field the adopting repo documents as its own extension. Refuse is smaller but stops a delivery the operator cannot fix without hand edits, which is what the reporter did. Whichever you pick, apply it to approve and undeliver too, or record in the PR why one of them differs.

Rules carried over unchanged:

- **Absent is not false.** A plan with a `## Status` block and no front matter, or front matter and no block, must deliver exactly as it does today. The new check fires only where both formats are present.
- **Read the exit code, not the emptiness.** A summary line is not proof: `phase=flipped` was printed with the front matter unchanged. The write succeeded, the outcome did not.
- **Arrow functions** for anything you write in the domain package (`CLAUDE.md`, *The Domain Package*). Do not convert neighbours.
- **A controller owns the write.** Do not edit a `State:` line by hand in a plan to set up a fixture in the repo's own plans. Fixtures live in temp sandboxes, and `plot-state-gate.sh` will refuse the commit otherwise.

### Done when

The plan's `Done when` list is the specification: it names the acceptance test, which is what the reconcile scan reports after a delivery, never whether a line changed. Lift these:

- A fixture with both formats, delivered, then the real scan run over it. The assertion is that the scan emits no `disagrees with phase` line. A test that only re-reads the front matter passes against a fix that is wrong in the way #944 hid.
- The same fixture where only `status:` is present, and where only `phase:` is present. A fix keyed on one key passes the first fixture and fails these.
- A plan with the front matter already `Delivered` (a re-run). It stays a no-op and does not refuse.
- A mutation check: revert your fix in place and confirm the new test fails. A test that passes against unfixed code is the one #924 shipped.

Plus: a changeset (`plot` package, description first, `bumps:` block last, `plan:` line inside the block). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally. If the slice touches a `.sh` file, `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base, so growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override. A change under `packages/board/src/` also needs `pnpm build:board` to test locally, and the generated bundle is restored before the push (`scripts/check-no-bundle-diff.sh`).

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/plan-record-edit.ts` and its test, the two board entry callers, `plot-undeliver.sh`, and a new or extended test under `test/reconcile/`. It does not change the parser's read order, the board's parser or the plan template: the plan's board-impact note says none expected, so confirm that and do not widen it. Verified at dispatch: no other branch in flight touches these files (no commits to `skills/plot/scripts` or `packages/domain/src` since 2026-10-24).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
