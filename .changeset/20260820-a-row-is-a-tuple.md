---
"@plot-pm/board": minor
---

board: a row is a tuple — six slots, seven kinds, and the kind is a field

Every row on this board is one of seven things — a ticket, a plan, a PR, a
build, an agent, a branch, a release — and each answers the same six questions.
It carried **23 fields** through **two competing grid definitions**, chosen by
whether the row was a plan, and which fact reached which column depended on the
plan's wave count, which a reader cannot see. Five row defects were reported from
screenshots in one night; they share one cause — **there was no shape that every
row is**, so each kind grew its own rendering and its own exceptions.

This lands the shape. It **deletes nothing**: `Row`, `PlanRow` and
`IssueRowView` keep working, and the wave that replaces them goes last on
purpose — `AgentList.tsx` took eleven commits on 2026-08-20 alone and conflicted
on nearly every merge that day, so the collapse goes when no sibling branch is
open against it.

**`kind` is a FIELD, set where the row is created.** Deriving it in the renderer
from `row.pr`, `row.planFile` or the branch name is declined, and the reason is
the defect this exists to fix: a derivation is a guess with a rule attached, and
the rule breaks first where two kinds share fields. **A release is a PR** whose
branch is named `changeset-release/main`, so any renderer-side rule must either
hardcode that name or misclassify the one row nobody should merge by reflex —
and that row arrives through the planless loop, where nothing else marks it. The
four-meanings phase column was also a derivation, from the plan's wave count,
and it produced four answers in one column. A structural test strips comments
and asserts the release name is matched in the server and nowhere else.

**`kind` is what the row is ABOUT, not which object it came from.** Measured
2026-08-20: of 80 live rows, **67 carry both a branch and a PR** and only 13 a
branch alone — so the both-case is the normal case and `branch`/`pr` are two
ROLES one row can be in. A **merge conflict** makes it `branch`, because no PR
resolves a conflict and the reader has to go rebase; anything else with an open
PR makes it `pr`, because the fix updates the PR. This costs the design a
simplification worth stating: `kind` is not a property of a thing, it is a
judgement about a row, made once where both facts are in hand.

**Slot 4 is zero-or-more, and that is where the slot count bends.** A branch
carries no artifact link and a PR carries two — its plan and its branch — so a
fixed second slot would force a PR to drop one and the reader would lose
whichever lost. Every named thing is a link and each says WHAT it points at, so
three links on a PR row do not read as three interchangeable words. All three
facts were already on the row; what was missing is that only some rendered and
only one was a link. It also repairs the measured defect that branch rows
carried **zero of seven** URLs, so a plan name was a link and the branch beside
it was inert text.

**Age is one clock — since last change — and the label marks the exception.**
The schema had already reached half of this and written down the reason: the
comment on `waitingDays` argues that `22d` (no commits for three weeks) beside
`22d` (never begun) is why *the row labels it rather than merging it*. The row
did not. Now a not-started row's approval clock and an agent's two clocks are
labelled, and nothing else is — the inverse of the phase column, which was
unlabelled *because* its meaning varied. An agent gets `27m · idle 4m` because
an agent does not change, it acts.

**The contract carries all seven kinds and four render nothing.** A kind with no
data renders NO ROW, not an empty one. A shape that admits only what exists
today has to be reopened per kind, which is exactly how three components and two
grids happened. The agent kind is designed against a registry that does not
exist yet, and the risk is named rather than discovered later: its name is the
**session id** the runtime writes as its transcript filename — the identity that
survives the branch — and the plan's own `@Dev-Agent` example is dropped as a
placeholder that was never a fact.

**A release carries only a mark, never an action.** Its menu holds *Open on
host* and nothing else; even *show what this would ship* is declined, because it
reads harmless and makes the board the place release decisions are prepared,
which is the first step toward being where they are taken. Enforced rather than
promised: the kind is handed no menu item and the component invents none.

**No new host call, and no new field fetched.** Every slot is derivable from what
the pulse already carries — this is a shaping change. A test asserts the
projection imports the contract's types and nothing else, and that no `fetch` or
host adapter appears in it.

A DOM half is tested in a real browser against a bundled harness, because the
tuple has no live call site yet and `/api/fleet` therefore cannot reach it. This
repo has no component-test seat — `environment: 'node'`, no jsdom — and reading
source is the honest answer for *which utility did this component choose* but not
for *is this text visible without hovering*: a regex over JSX would pass on a
`title` attribute holding the same word. When the collapse wave gives the row a
call site, those assertions move to the board's own page and the harness goes.
