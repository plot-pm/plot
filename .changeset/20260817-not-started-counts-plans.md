---
"@plot-pm/board": minor
---

NOT STARTED now counts **plans**: one row per plan, carrying the plan's own clock and a summary of its waves, with the branches folded beneath it and expandable. The section sorts by how long each plan has waited, oldest first.

**Its rows were never branches.** Measured live on 2026-08-17, every row in that section carried `pr=—` and `age=—` — the branch name came out of the plan's `## Branches` section and no branch was ever created for it. **Six rows for four plans**, with `activity-shows-itself` appearing three times for one waiting plan, the two extra rows carrying nothing the first did not. Compare WAITING ON YOU in the same pulse: four rows, all four with a real PR and a real age. There the branch is the subject because it holds work that exists.

So this is one row shape carrying two meanings — the defect this board keeps finding, this time not in a field but in the identity of a row.

**Folded, not summarised away.** The branch names are the plan's own words for what it will do, and a reader who wants them must not have to open the plan file to get them back. They are collapsed by default behind an expander and come back whole. A plan with only one branch beneath it gets **no** expander: a control that reveals a row it already shows is noise.

**The wave summary is derived from the group's own rows — no contract field was added.** `waveSummary` on the schema lives on the card, and a fleet row knows only its own wave; but the view already holds every row of the plan in this section, so counting them and reading their notes answers *how many, and is the first one startable*. `first eligible` reads the same `isStartable` predicate the row menu does, so the summary cannot promise an action the menu then refuses.

The limit is recorded rather than hidden: this counts the waves **in this section**. A plan whose first wave already merged has that wave in DONE, so the row reports the remainder — two where the plan file lists three. That is the honest number for the question the section asks, and the plan link on the row carries the full arc.

**The section's sort was broken, and this fixes it.** The group order came from `Math.max(...rows.map((r) => r.ageMinutes ?? -1))`, and `ageMinutes` is `null` on every row here — so every group scored `-1`, the comparator returned 0 for every pair, and the sort did nothing at all. `plot-sprint-support`, approved 187 days ago, sat wherever insertion order put it, beside a plan from that afternoon. It now sorts by `waitingDays`, **oldest first**, because that is the only clock that ticks in this section. Sorting startable-first was rejected: the startable plans are already marked by their own note, and burying a six-month-old plan under a fresh one hides exactly the drift this section exists to surface. An undated plan sorts last — `-1` would assert a wait nobody measured.

This is the **group** order and deliberately not the same question as `compareWithinGroup` in the server, which orders the rows *inside* a group newest-first on the reasoning that six months of availability is evidence nobody wants a branch. That answers *which branch do I pick up*; this answers *which plan has been ignored longest*, which is what a reader scanning section headings asks. The server's row order survives untouched inside each fold.

**A deferred branch keeps its own row**, with its own PR and its own age, beneath its own plan row. Those branches *were* started and were then shelved, and the server records what flattening them costs: an earlier version wrote `deferred` as the note, and *"a branch started and then shelved read as never begun, with its age and its PR erased."* A separate "shelved" section was rejected — it cuts a branch from the plan that explains it.

**The indicator sits with the plan** on a plan row, and with the branch on a deferred row. Same rule every other section follows — the marker belongs to whatever is waiting — applied to a different subject.

**The grid tracks do not move.** A plan row is laid on the same `ROW_TRACKS` as a branch row, so every column keeps its x and the section boundary does not break alignment. The plan takes the plan track; the wave summary takes the branch track, which is where a reader looks for *which slice of it*. The PR track is empty on purpose: a plan has no pull request of its own, and inventing one from a branch beneath it would state something no field says.

**Every other section is unchanged** and still renders branch rows. The six sections stop sharing one row shape, and that is the real cost — but it is the one section whose rows are not the same kind of thing as the others', and forcing them into the shared shape is what produced `pr=—`, `age=—`, and three rows for one plan.

The inner fold is **not persisted**, unlike the section-level collapse. Folding QUIET is a standing preference about a section a reader has decided not to watch; opening one plan's waves is a momentary question — *what were the three branches again* — asked and answered. Restoring it on a board reloaded several times an hour would rebuild the crowding the fold removes.

<!--
bumps:
  skills: {}
-->
