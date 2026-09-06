---
'plot': patch
---

`DESIGN-slice.md` and `DESIGN-plan.md` stop carrying slice counts as standing facts and name the command that produces them.

**The numbers were wrong when the plan found them, and are wrong again now.** `DESIGN-slice.md` stated *271 of 303 conform, 21 hold several, 11 hold none* across 158 plans. Re-run 2026-09-07 the estate holds **219 plans and 500 slices** — 39% more plans in ten weeks — with 24 multi-branch and 22 empty. The shapes held; the population did not, and every count in both specs was stated against the smaller number. A fresh number goes stale the same way one cycle later.

**Two readers counting the same property by different means differ by 4x.** A hand-rolled markdown scan over the same files answers 106 multi-branch and 181 empty where the parser answers 24 and 22, because a regex reads prose subheadings under `## Slices` as slices and the parser does not. That is the argument for naming the command rather than any figure: `plot-plan-meta.sh` is the plan-format contract, and a count taken any other way is a different question wearing the same words.

**Nothing new was built.** `plot-reconcile-scan.sh` already reports `uncut_slices=` and prints each one by name with a `/plot-reslice` hint; the specs cite it.

**`uncut_slices=` and `prose_slice_names=` are not interchangeable, which the slice spec now says.** The second counts over-long slice *names*, a different population from slices with no *branch*: measured 2026-09-07, 22 empty slices against 26 long names, **14 in both**. No counter answers "empty slice" alone, so the spec gives the parser query and says what subtracting yields.

**The plan spec's field table keeps its counts, dated and labelled `n=158`**, because what the column is for is the shape of each field — always present, usually present, never seen — and those readings held across both samples. The arguments they support are re-measured: `rounds` is still the format's one optional key (68 of 158 then, 101 of 219 now), and `phase_alt` and `design_raw` still read zero over 219, which is what makes them modelled rather than merely rare. A verified regeneration command sits above the table.

**Two sentinels a re-run must respect are now stated**, both found by running it: the table spells a field `state_alt` where the parser emits `phase_alt`, so a re-run keyed on the table reports zero for the wrong reason; and an unset `phase_alt` is the literal string `"NONE"` rather than empty, so testing it for `""` counts every plan as carrying one.

<!--
plan: docs/plans/2026-09-05-the-slice-contract-says-what-it-reads.md
bumps:
  skills:
    plot: patch
-->
