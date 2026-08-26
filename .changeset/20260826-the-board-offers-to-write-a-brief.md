---
'@plot-pm/board': patch
---

A branch row whose brief is missing offers a **Write brief** action in its menu.

The button calls `/api/implement` with the plan slug — the same route the plan
head's Implement button uses — because `/plot-implement` writes the brief as
part of its preparation. The label says "Write brief" because that is the
effect the row needs and the gap the row is showing: same route, different word
for the different question.

The action appears only where `needsBrief(row)` is true — the predicate PR #431
introduced — so the narrowing is in the predicate, not the button.
