## Implementation brief — a-section-latches-on-a-branch-not-a-heading

- **Plan (canonical):** `docs/plans/2026-09-28-a-section-latches-on-a-branch-not-a-heading.md` on `main`
- **Approved:** 2026-09-28, jwloka, in-session
- **Branch:** `bug/a-section-latches-on-a-branch-not-a-heading` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Issue:** #1042

Single-slice plan: nothing waits on this branch and it waits on nothing.

### What to build

One line. `slice_shape` latches on a Slices section's **first** `###` heading (`plot-plan-meta.sh:959-961` on `main` at `59a70313`, after #1031 moved it from the `:926-928` the plan cites); where that heading is narrative, the whole section routes to the list consumer and every branched heading below it is lost.

```awk
section == "slices" && $0 ~ /^###[ \t]/ && slice_shape == "" {
  if (index($0, "(Branch:") > 0) slice_shape = "heading"
}
```

Drop the `: "list"` arm. `slice_shape` stays `""` until a heading carries `(Branch:`, and `""` already routes to the old consumer — which is exactly what the comment at `:955-958` says it is for. **Removing the latch makes the code match its own documentation.**

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**The measurement is already done, and it is the work.** Both versions run over all 357 plans: **4 diff lines, 2 changed records, 355 byte-identical**. Re-run 2026-09-28 at `59a70313`, after #1031 merged: 358 plans (this plan's own file is the new one), **4 diff lines, 2 changed records, 356 byte-identical**, the same 5 branches, recovering exactly the 5 lost slices — `the-pulse-is-an-entity` +4, `opus5-longhorizon-hardening` +1. `parser.test.mjs` 106/106.

**If you write a different fix, re-run that whole-estate diff.** "Widens and narrows nothing" is measured here, not argued.

**56 plans have a narrative first heading and only 2 lose slices.** The blast radius cannot be inferred from the shape — an implementer assuming 56 over-fixes. Test that a section with no branched heading anywhere still parses as the old shape, against one of the 54.

**CONFIRM THE PATCH IS PRESENT BEFORE TRUSTING A GREEN RUN.** Measured while planning: the first 106/106 ran against the **unpatched** file, because `cp` is aliased to `cp -i` here and printed *not overwritten*. The #1031 juror hit the identical trap. Use `git diff --stat` (or `command cp`) and check. The re-run at `59a70313` hit a third form of the trap: `sed` on this machine is GNU, so `sed -i ''` treated the script as a filename, patched nothing, and the diff reported 0 changes. A zero diff is not a clean result until the patch is shown present.

**Do not scan the whole section before latching.** It was considered and is unnecessary: nothing reads `slice_shape` before a heading is seen, so leaving it `""` has the same effect at a fraction of the cost.

**Out of scope:** the extraction regex (#1031, merged as #1044 — rebase onto current main and you have it); the template; the 10 legitimately empty waves; making an unreadable heading an error.

### Done when

The plan's `## Done when` is the specification. Assertions a naive implementation passes without:

- **The minimal pair gives `["bug/real-work"]` in BOTH orders** — narrative-first and branched-first. One order alone proves nothing.
- **The five recovered slices are named in a test**, by plan and branch. A test asserting only "more branches" passes on an over-wide fix.
- **The whole-estate diff is re-run and reported in the PR** if the fix differs from the one above.
- `parser.test.mjs` passes with the patch **confirmed present**, and the PR says how it was confirmed.

Plus the repo's gates: `pnpm test`, `pnpm run test:contracts` (the parser suite is `test/reconcile/parser.test.mjs`), and a changeset — `'plot': patch` with the description first and `plan: docs/plans/2026-09-28-a-section-latches-on-a-branch-not-a-heading.md` in the trailing comment. No board artifact rebuild: this branch changes no board source. Do not run `test:e2e` locally.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. The PR body reports the estate diff and how the patch was confirmed present.
- When the PR exists, append `→ #<number>` inside this slice's heading in the plan's `## Slices` section: `(Branch: bug/a-section-latches-on-a-branch-not-a-heading, PR: #N)`. A trailing arrow after a heading parses as `prs=[]`.

### Scope guard

This branch owns `skills/plot/scripts/plot-plan-meta.sh` (the `slice_shape` rule at `:959-961` only), `test/reconcile/parser.test.mjs` and one changeset. Verified 2026-09-28 at dispatch: no other remote branch changes either file. `bug/a-post-merge-commit-is-not-merged-work` is in flight in `.worktrees/` and touches neither.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
