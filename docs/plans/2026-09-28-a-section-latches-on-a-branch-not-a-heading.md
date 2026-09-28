# A section latches on a branch, not a heading

> A Slices section whose first `###` is narrative routes to the list consumer, and every branched heading below it is lost. One line, measured: 2 plans gain 5 slices, 355 are byte-identical, 106/106 tests pass.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1042
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 0

## Changelog

- A wave heading that names a branch is read wherever it sits in the section, not only when the section's first heading also names one.

Board impact: two plans start rendering slices they already declared. No schema change.

## Motivation

### Measured 2026-09-28

`slice_shape` latches on the section's **first** `###` heading (`plot-plan-meta.sh:926-928`) and is then fixed. Where that heading carries no `(Branch:`, the whole section routes to the **list** consumer, which never reads headings for branches.

Minimal pair — identical content, reordered:

```
### A narrative heading with no branch     ← first
### Real work (Branch: bug/real-work)
  → branches: []

### Real work (Branch: bug/real-work)      ← first
### A narrative heading with no branch
  → branches: ["bug/real-work"]
```

**Five slices lost across two plans**, every one a correct, unbackticked heading:

```
the-pulse-is-an-entity.md        4  (Freeing the word, Naming, Ticking, Waiting)
opus5-longhorizon-hardening.md   1  (Recovered)
```

`the-pulse-is-an-entity`'s section opens at line 206 with `` ### `Pulse` already means something else … `` — narrative, no `(Branch:`.

### Found by a panel that was asked about something else

A juror interrogating #1031 found it inside that plan's own control group. #1031 had classified these waves as *"narrative waves in older plans"* — legitimate emptiness — and four of them name a branch. Its first Done-when would have instructed an implementer to assert silence against one of them, pinning this defect shut in a test.

### Why it is not #1031

Both produce `branches: []` with a wave present, so they look identical from outside. **#1031 fixes the extraction and does not touch this**: the patched parser gives the same wrong answer on the pair above. This is classification.

## Design

### The rule

**A section is `heading`-shaped once any heading in it names a branch, not only if the first does.**

```awk
section == "slices" && $0 ~ /^###[ \t]/ && slice_shape == "" {
  if (index($0, "(Branch:") > 0) slice_shape = "heading"
}
```

One line: drop the `: "list"` arm. `slice_shape` stays `""` until a heading carries `(Branch:`, and `""` already routes to the old consumer — which is exactly what the surrounding comment says it is for:

> `slice_shape` therefore stays `""` until a heading is seen, and `""` routes to the old consumer.

The latch to `"list"` is what makes that comment false for a section whose first heading is narrative. **Removing it makes the code match its own documentation.**

### Measured, not argued

Both versions run over all 357 plans, output diffed:

```
diff lines: 4       (2 changed records, 355 byte-identical)
  opus5-longhorizon-hardening  []  →  ["infra/recover-opus5-hardening"]
  the-pulse-is-an-entity       []  →  4 branches
```

`test/reconcile/parser.test.mjs`: **106 pass, 0 fail**, with the patch verifiably applied — `git diff --stat` confirmed `1 insertion, 1 deletion` before the run.

**That verification step is not ceremony.** The first attempt reported 106/106 against the *unpatched* file: `cp` is aliased to `cp -i` here and printed *"not overwritten"*. The #1031 juror hit the identical trap and caught it the same way. **The slice confirms the patch is present before trusting any green run.**

### Why the whole-file scan is not needed

A candidate fix was to scan the section before latching. It is unnecessary: nothing reads `slice_shape` before a heading has been seen, so leaving it `""` until a branched heading appears has the same effect at a fraction of the cost. The parser reads 357 plans in 0.46 s and this adds nothing measurable.

### What this does NOT do

- **It does not change the old shape.** A section with no branched heading anywhere still routes to the list consumer, which is 54 of the 56 plans whose first heading is narrative.
- **It does not touch extraction.** Backticked values are #1031's.
- **It does not change the template or what `/plot-idea` writes.**
- **It does not repair the two plans' text.** They were always correct; the parser was not.

## Done when

- The minimal pair above gives `["bug/real-work"]` in both orders, asserted as a test.
- **The five recovered slices are named in a test**, by plan and branch — a test asserting only "more branches" passes on an over-wide fix.
- **The whole-estate diff is re-run and reported in the PR**: 2 changed records, 355 identical. A different diff means a different fix.
- `parser.test.mjs` passes **with the patch confirmed present**, and the PR says how that was confirmed.
- A section with no branched heading anywhere still parses as the old shape, asserted against one of the 54.

## Slices

### A section latches on a branch, not a heading (Branch: bug/a-section-latches-on-a-branch-not-a-heading)

Drop the `"list"` arm, add the ordering test and the five-slice assertion, re-run the estate diff.

## Notes

**The fix is one line and the measurement is the work.** 56 plans have a narrative first heading and only 2 lose slices — so the blast radius had to be measured rather than inferred from the shape, and an implementer who assumes 56 will over-fix.

**This was found inside another plan's control group**, which is the second time today a panel found a defect by questioning a claim about *legitimate* behaviour. The lesson is the same both times: a population asserted as normal is worth counting.
