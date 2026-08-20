---
"@plot-pm/board": minor
---

board: a failing check shows its step and its age, and its file list moves to the menu

`#266` carried its failure as prose: a wrapped list of six changed files and a
raw `2026-08-20T03:55:23Z`, in the row. Both facts were right and both were in
the wrong form — the row dumped what it should have shaped.

**The changed-file list moves behind the `⋯` menu.** It was the third of three
evidence lines a `ci-failing` row printed, and it is the one that is unbounded
and consulted rarely — so every reader scrolled past a paragraph of paths so
that the occasional reader who wanted them did not have to click. The menu item
COUNTS rather than lists (*Changed 6 files*), because an item naming the paths
would put the dump one click away instead of removing it; the count is also what
a reader uses to decide whether to open it at all. The panel it opens prints the
paths in the order the host gave them, unsorted and unhighlighted — the contract
is explicit that nothing maps a failing step to a changed path.

*EVIDENCE TRAVELS WITH THE STATE* is unchanged and is what licensed the move:
the rule is honoured by the evidence being reachable from the row, not by all of
it being printed in the row. The three facts of a failing check are not equal in
cost — a step name is four words and often ends the investigation, a path list
is a paragraph — and the row now spends its width accordingly.

**The run time renders as an age.** The host reports ISO 8601 and the contract
keeps it verbatim, which is right for a contract and wrong for a row:
`2026-08-20T03:55:23Z` makes a reader do date arithmetic to answer the only
question they asked — *is this fresh*. It reads `failure 2h ago` now, through
`agoLabel`, the board's existing age dialect rather than a second one. An
unparseable timestamp omits the age and still reports the run's conclusion,
rather than rendering `Invalid Date`.

**No new field, no new route, and no fetch on click.** `changedPaths` was
already on the row, on the pulse that drew it — so the menu item asks the server
nothing at all, which makes it the purest read in that menu. The contract is
untouched: `startedAt` stays ISO 8601 as the host sent it, and the formatting
happens where formatting belongs.

The row's two remaining evidence lines still say *unavailable* where a field is
empty, and the changed-path line deliberately does not: its absence from the row
is now the design rather than a missing fact, so a placeholder there would be
prose of the same width making a weaker — and, where the menu holds the paths —
false statement.

A fixture is fixed on the way past: the `ci-failing` browser row carried
`startedAt: '10:19'`, which no host ever sends. An unparseable stub is why a
test watching that row could not have failed for the raw timestamp that reached
the screen.
