---
'plot': patch
---

The skills teach `## Slices`, the name `plot-plan-meta.sh`'s own comment calls accurate: a Slice holds one branch and belongs to one plan, a Wave is the fleet cohort that spans plans, and the section was always the former. They taught `## Branches` eighteen times against one correct use, so every plan written from a skill carried the legacy word forward. **The highest-value target was not a skill at all** — `skills/plot/templates/plan.md` is the template every adopting project receives, and it said `## Branches` while this repository's own `.plot/templates/plan.md` said `## Slices`: we had fixed ours and shipped theirs. **This is not a find-and-replace, and the difference is invisible to a count.** A `sed -i 's/## Branches/## Slices/g'` over `skills/` produces the same occurrence total and breaks the change three ways, each now pinned by a named test: two instructions in `plot-deliver` and `ralph-plot-sprint` describe what their reader ACCEPTS, so they GAIN `## Slices` and KEEP `Branches` — narrowed to strict they silently stop reading the 600+ plans on this estate that say the legacy word while every other test still passes; one line in `plot-reslice/README.md` states what the parser accepts and keeps BOTH words while three instruction lines in the SAME FILE change, so the exemption unit is the SENTENCE and no per-file rule can express it; and a blanket `grep → 0` gate would falsify the parser's own recorded measurement — *"renaming its `## Branches` to `## Slices` took it from 6 branches to 0"*, a sentence that must keep the word to stay true — as well as rewriting shipped changelog entries and the fixtures whose whole purpose is proving the parser still reads it. The Slice/Wave distinction is now stated **once**, in `intro-to-using-plot.md` two lines above where waves are introduced, because that is the first place a reader is asked to tell them apart; before this it lived only in a script comment, invisible to the person writing a plan. **The parser is untouched and still reads all three spellings**, verified byte-identically: `plot-plan-meta.sh` over all 289 plans in `docs/plans/` produces the same SHA before and after. `packages/board/test/`, `packages/domain/test/`, `docs/plans/`, `MANIFESTO.md` and `changelog.md` are unchanged, asserted as **paths untouched by the diff** rather than as a count — the repo-wide total went 632 → 656 between the plan's approval and its dispatch, so a gate phrased as a total would already have been failing for a reason unrelated to the work. Every target was located by content rather than by line number, which is what caught the one that had already moved.

<!--
plan: docs/plans/2026-09-15-the-skills-say-slices.md
bumps:
  skills:
    plot: patch
    plot-approve: patch
    plot-deliver: patch
    plot-implement: patch
    plot-pulse: patch
    plot-reconcile: patch
    plot-reslice: patch
    ralph-plot-sprint: patch
    tracer-bullets: patch
-->
