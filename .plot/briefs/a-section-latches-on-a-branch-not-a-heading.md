## Implementation brief — a-section-latches-on-a-branch-not-a-heading

- **Plan (canonical):** `docs/plans/2026-09-28-a-section-latches-on-a-branch-not-a-heading.md` on `main`
- **Approved:** 2026-09-28, jwloka, in-session
- **Branch:** `bug/a-section-latches-on-a-branch-not-a-heading` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Issue:** #1042

Single-slice plan: nothing waits on this branch and it waits on nothing.

### What to build

One line. `slice_shape` latches on a Slices section's **first** `###` heading (`plot-plan-meta.sh:926-928`); where that heading is narrative, the whole section routes to the list consumer and every branched heading below it is lost.

```awk
section == "slices" && $0 ~ /^###[ \t]/ && slice_shape == "" {
  if (index($0, "(Branch:") > 0) slice_shape = "heading"
}
```

Drop the `: "list"` arm. `slice_shape` stays `""` until a heading carries `(Branch:`, and `""` already routes to the old consumer — which is exactly what the comment at `:922-925` says it is for. **Removing the latch makes the code match its own documentation.**

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**The measurement is already done, and it is the work.** Both versions run over all 357 plans: **4 diff lines, 2 changed records, 355 byte-identical**, recovering exactly the 5 lost slices — `the-pulse-is-an-entity` +4, `opus5-longhorizon-hardening` +1. `parser.test.mjs` 106/106.

**If you write a different fix, re-run that whole-estate diff.** "Widens and narrows nothing" is measured here, not argued.

**56 plans have a narrative first heading and only 2 lose slices.** The blast radius cannot be inferred from the shape — an implementer assuming 56 over-fixes. Test that a section with no branched heading anywhere still parses as the old shape, against one of the 54.

**CONFIRM THE PATCH IS PRESENT BEFORE TRUSTING A GREEN RUN.** Measured while planning: the first 106/106 ran against the **unpatched** file, because `cp` is aliased to `cp -i` here and printed *not overwritten*. The #1031 juror hit the identical trap. Use `git diff --stat` (or `command cp`) and check.

**Do not scan the whole section before latching.** It was considered and is unnecessary: nothing reads `slice_shape` before a heading is seen, so leaving it `""` has the same effect at a fraction of the cost.

**Out of scope:** the extraction regex (#1031, merged as #1044 — rebase onto current main and you have it); the template; the 10 legitimately empty waves; making an unreadable heading an error.

### Done when

The plan's `## Done when` is the specification. Assertions a naive implementation passes without:

- **The minimal pair gives `["bug/real-work"]` in BOTH orders** — narrative-first and branched-first. One order alone proves nothing.
- **The five recovered slices are named in a test**, by plan and branch. A test asserting only "more branches" passes on an over-wide fix.
- **The whole-estate diff is re-run and reported in the PR** if the fix differs from the one above.
- `parser.test.mjs` passes with the patch **confirmed present**, and the PR says how it was confirmed.
