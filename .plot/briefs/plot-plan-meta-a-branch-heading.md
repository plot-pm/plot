## Implementation brief — plot-plan-meta-a-branch-heading

- **Plan (canonical):** `docs/plans/2026-10-23-plot-plan-meta-a-branch-heading.md` on `main`
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2403 merged
- **Branch:** `bug/plot-plan-meta-a-branch-heading` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (plot-review App on the PR)

One wave, one branch. Nothing waits on it and it waits on nothing.

### What to build

A plan with `### A (Branch: bug/x)` and a list item `` - `bug/x` — foo → #12 `` below it parses with `"prs": []`. `plot-plan-meta.sh` sets `slice_shape = "heading"` at `:1265`, and the heading handler at `:1332` runs `next` on every line that is not a `### ` heading. The list item's `→ #N` and its `builds:`, `waits:` and `deferred:` markers are lost, and no scan section reports it. ewz-kus-portal has five delivered plans in this shape; `/plot-release` step 5b refuses them.

Build the plan's repair 1 plus repair 2:

1. **Parser (`skills/plot/scripts/plot-plan-meta.sh`).** In the heading shape, a list item that matches `branch_claim_re` (`:1026`) and names the branch of the most recent heading contributes its `→ #N` and its annotations to that branch. Reuse the `→ #N` loop (`:1297`–`:1316`) and `read_notes()` instead of copying them. Every other line stays unread.
2. **Scan (`skills/plot/scripts/plot-reconcile-scan.sh`).** A heading-shape section holding a branch-claiming list item that the parser could not attribute (it names a branch no heading names) gets a finding in the `unread_headings` / `unread_waits` family (sections 24 and 24a, around `:3225`–`:3273`). The scan reports and never gates.

### Settled decisions — do not re-derive

- **Not repair 3.** Writing `PR: #N` into the heading changes two skills' instructions and leaves the five existing plans unread. It cannot fix the reported plans.
- **The prose guarantee stays.** The comment at `:1330` says body lines are never scanned, so a backticked name in prose cannot become a second claim. Do not drop the guard. `branch_claim_re` is anchored to `- ` plus backticks plus a known prefix, and that anchoring is what makes the list item safe to read. A list item naming a *different* branch, and every prose line, stays unread.
- **Absent is not false.** An unattributable list item is reported, never silently dropped and never read as a second claim.
- **Heading `PR: #M` plus list `→ #N`** is the plan's open point. Measure how many plans in `docs/plans/` carry both before choosing, and write the figure in the PR. If none do, take both into `prs` and state it.
- **Corpus check is owed.** Run the parser over `docs/plans/` before and after and list every record that changes. The 2026-09-28 latch change reported 355 of 357 byte-identical; this change reports its own figure in the PR body. Run the before-side from a pristine `main` worktree, not from your edited tree.
- **Domain duplicate.** Check whether `packages/domain` reads the same `## Slices` section with the same skip (`rules/slice-tokens.ts`, `rules/slice-name.ts` are the candidates). If it does, add the repair there and a corpus test at `packages/domain/corpus/`. If it does not, say so in the PR. On a corpus disagreement the branch stops; do not adjust either side to make it pass.

### Done when

The plan's `Changelog` entry holds: a plan whose slice heading carries `(Branch: …)` and whose list item below claims the same branch keeps the `→ #N` annotation and the list item's markers, and the scan reports a list item the parser cannot read.

Assertions a naive implementation passes without:

- **A list item naming another branch stays unread.** Catches a parser that reads every list item under a heading.
- **A prose line with a backticked branch name stays unread.** Catches loosening `branch_claim_re`.
- **A list item with `<!-- deferred: … -->` puts its PR in `deferred_prs`.** Catches reading `→ #N` but not the markers.
- **A heading-only plan is byte-identical before and after.** Catches a change to the existing shape.
- **The scan finding fires on the unattributable item and is silent on the attributable one.** Catches a report that fires on both.

Plus: a changeset (description first, `bumps:` last, `plan:` line in the block), and `scripts/check-shell-lines.sh` — this change touches `.sh` files, so growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

Tests: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. Name the new tests in `test/reconcile/` beside `branch-heading.test.mjs` and `scan-unread-headings.test.mjs`. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` and not `gh pr create`. Then append `→ #<number>` to the branch line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-plan-meta.sh`, `skills/plot/scripts/plot-reconcile-scan.sh` (sections 24 and 24a), their row in `skills/plot/scripts/README.md` if the behaviour text changes, new tests under `test/reconcile/`, a changeset, and, only if the domain reads the same section, `packages/domain/src/rules/` plus one file in `packages/domain/corpus/`. Do not edit `board-server.mjs` or any generated bundle. Sprint `bugfix-2-28-2` holds other plans; none is dispatched on these two scripts at the time of writing — confirm with `git branch -r` before touching shared lines.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
