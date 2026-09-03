---
'@plot-pm/board': patch
---

The board says *slice* wherever it means the part of a plan that one branch carries out.

The warning that named the defect stated its opposite. `stuckEvidence` printed *"a wave is carried out in one branch, so this plan needs slicing"*, and a Wave is the fleet's cohort — it spans plans and is supposed to hold many branches (`DESIGN-slice.md`). Read literally the sentence said a wave holds one branch. The verdict underneath it was right and had been right since it shipped; only the prose taught the model backwards, and the author of the plan the warning fired on had already made that exact mistake.

**The board's `Wave` is a Slice, and that is measured rather than argued.** `contract/schema.ts` defines it as `{ plan, name, branches }` — belonging to one plan, named by its `### ` heading in the plan file. 58 slices on this estate, every one holding exactly one branch; not one has ever held the cohort that would make it a wave.

So every message, label, `aria-label`, title and agent prompt follows: the row kind reads **Slice** where it read *Wave*, a plan head counts *3 slices* rather than *3 waves*, a blocked branch waits on *an earlier slice*, and `/plot-reslice`'s prompt asks an agent to cut one slice per branch. 1130 lines of comment prose move with them, because a comment that contradicts the entity is what produced this.

**No identifier changes.** `WaveRow`, `waveGroupsFor`, `WaveSchema`, `data-wave-row` and the `unsliced-wave` state all keep their names, so this diff reviews as prose and `git blame` moves for text only. `branches` stays plural — the array is what lets the board DETECT an over-full slice, and the warning above exists because it can.

**One use of *wave* was correct and stays.** `contract/schema.ts` distinguishes the domain's `Slice` from the domain's `Wave` in the same sentence — *"a Slice belongs to one plan, a Wave is the fleet's cohort"* — which is the one place in the board the word means what the spec says it means.

The sentence is now pinned by a test that asserts the rendered text on a two-branch heading, not the enum. A test on `'unsliced-wave'` passes whatever the prose says, which is how the wrong sentence survived.

<!--
bumps:
  skills:
    plot: patch
-->
