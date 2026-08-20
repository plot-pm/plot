---
"@plot-pm/board": minor
---

board: the row action menu fits the kind, and every row in WAITING ON YOU has one

Two rows of three in WAITING ON YOU carried no `⋯` menu at all: a plain PR
awaiting review offered nothing the menu recognised, so the reader had no route
to any action whatever the row led with. The menu now fits each kind, and every
row has one.

**Open makes the menu fit every WAITING ON YOU row.** Each row in that section
gains an Open item — navigation to a fact the row already carries (`openTarget`:
the PR page, or the branch on the host), so no fetch and no host call. It reads
*Review* on a PR row and *Open* on a bare branch, because opening a PR is
reviewing it. A green PR awaiting review — the row that measured the defect — now
has a menu where before it had none. Open is scoped to WAITING ON YOU on purpose:
a quiet, blocked or done row has an address too but nothing to do, and a `⋯`
opening a link the row already shows is the empty menu a neighbouring plan
removed.

**Per kind, the actions the reader needs:**

| Kind | Menu |
|---|---|
| Ticket | Create plan, Create story, Open on host |
| Plan | Open, Approve, **Commission design** |
| PR | Review, and where checks fail **Show failure** |
| Branch | Open, and per cause Resolve conflict / Show failure |

The ticket's `Create plan` moved out of its bare cell and into the same `⋯` menu
every other row wears — the row says what IS, the menu says what you can DO,
brought to the one kind that had not adopted it.

**Commission design ships the `Design` phase minimally rather than as a
refusal.** The phase landed in #259 and nothing filled it; a menu entry that only
explained why it could not act would leave the phase unreachable for longer. So
the entry spawns a plot agent — through a new `/api/commission`, the twin of
`/api/idea`, slug-scoped and gated on the same loopback binding — that creates a
plan in phase `Design` with an empty spec section. The spec/spike/tracer-bullet
distinction is left to the plan itself; the board does not build three variants.
It refuses any plan that is not a Draft, in the plan's own phase, exactly as
Approve is a decision about a Draft.

**Create story is offered and refuses, with its reason on the control.** A story
is a person's decision — where it lives, whether it is wanted yet — which
`story-tracking` settles through questions an unattended agent has nobody to
answer. There is no `/api/story`, and this is not a gap a later wave fills: the
act belongs to a terminal, not a click. Offering it and naming why is the honest
answer; a reader weighing an unplanned issue is choosing between exactly a plan
and a story, and a menu that dropped one would hide half the decision.

**No host call is added, on the pulse or on a click.** Every kind is derived from
data already on the row, and where a detail is not in the pulse the menu links
out to the host rather than fetching it. `Show failure` opens the run URL the
scan already carried; where the host gave none (Bitbucket has no run listing) the
item is simply absent.

The contract is untouched save one additive server-capability flag,
`board.commission` — defaulted, so an older server validates and a newer client
hides the control rather than offering one that 403s. Which fact LEADS a row, the
`pr.state` → `pr.states` change, the kind label, and the failure-detail reshaping
are sibling branches and are not touched here.
