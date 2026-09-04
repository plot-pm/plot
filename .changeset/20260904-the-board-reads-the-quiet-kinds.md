---
'@plot-pm/board': patch
---

The board tells a closed PR from an abandoned branch from an unworked claim,
instead of filing all three under QUIET with a commit age.

QUIET was the classifier's fallthrough, and its last two lines described
whatever nothing else matched by how long ago the branch was touched. **Age is
not a state.** *"No commit for 126 days"* is equally true of work somebody
rejected, work somebody abandoned, and work nobody started. Measured on this
estate 2026-09-03: 26 rows said QUIET — 17 closed PRs, 2 claim-only branches, 6
abandoned — and the last eight said *in progress* while zero workers ran.

The rule that tells them apart shipped in the previous slice and decided
nothing on screen. Both readers now call it.

**`classifyGroup` answers the branch kinds, `prState` the closed one**, and the
split is not an implementation detail: that function's `byHead` map is
open-only, so a closed PR never reaches it, and it says so twice. The closed
case is read in `rowsFromPulse` from the any-state map, where both are in hand.

**A declined PR reads as declined and stays on the board.** An earlier draft had
it leave; interrogation disproved that — #53, #363 and #654 all still have live
refs. The branch exists, still holds a worktree slot, and is still findable by
everything except the surface a person acts through. It stays in QUIET rather
than DONE, because DONE would read a declined branch as an equal outcome to a
merged one, and it asks for nothing: somebody already decided, which is the
answer that empties 17 of the 26 rows.

**The rows MOVE, they are not only relabelled.** An orphaned claim and abandoned
work each go to WAITING ON YOU, because the group is the half that asks a person
for something and both need one — reap it or dispatch it, revive it or drop it.
#669 changed a withdrawn plan's sentence and kept its group, calling that
conservative, and the row went on requesting a decision its own note said was
made.

**The status word moved too**, which is the half a note cannot fix. `stateStatus`
maps `wip` to *in progress*, so a four-month-old branch rendered as work under
way whatever its sentence said. `AgentRow.quietKind` now carries the rule's
answer onto the row and the client maps four values to four words — `declined`,
`unclaimed`, `abandoned`, `quiet` — deriving nothing, per the Layering Rule.

The age is not lost. It rides beside the state rather than standing in for it:
*commits, no PR ever opened — last commit 126 days ago* is what a revive-or-drop
call is made on.

QUIET keeps what it still means — a shelved branch with a written reason, a
record of work nobody is coming back for.
