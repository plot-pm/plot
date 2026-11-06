# The card grammar

Every board item — a ticket, a story, a plan — renders as one card that answers
the same five questions in the same place. The semantic model is the domain's
(`packages/domain/src/entities/card-facts.ts`); the words and the layout are the
board's (`packages/board/src/app/lib/card-presentation.ts`, `<Card>`). Code
follows this vocabulary.

## Terms

| Term | Means |
|---|---|
| **card grammar** | The rule that every board item projects into the same five facets, and that every board shows them in the same row positions. |
| **`CardFacts`** | One item's facts in the five facets. Typed facts only: kinds, references, counts, enums, identifiers, ISO dates and content copied verbatim (`title`, `summary`, `value`). Never a generated word. |
| **facet** | One of the five questions, and one row: `identity`, `lineage`, `progress`, `next`, `ownership`. |
| **projection** | A domain rule that builds `CardFacts` for one kind: `planCardFacts` (plans); `storyCardFacts` and `ticketCardFacts` follow in later slices. |
| **mapping** | `presentCard(facts, board)`: the rows, every word on them, and which row is emphasised. Pure, tested without a browser. |
| **emphasis** | The row a board's reader came for, drawn heavier. Weight and colour only, never position: `next` on the planning board and in swimlanes, `progress` on the Stories lanes, `lineage` on the Tickets lanes. |

## The five facets

| Facet | Answers | Holds | Absent means |
|---|---|---|---|
| `identity` | What is it? | kind, id, key, title, summary, type, the ref the title opens, alerts | always present |
| `lineage` | What is it part of? | ticket, story, plan and sprint refs, each `Known` | read, and no relation exists |
| `progress` | How far is it? | work done/total and its unit, PRs with their checks, design rounds and spike, verification, cost | nothing to measure |
| `next` | What can be done now? | at most one primary action, then the enabled secondaries | no action belongs here |
| `ownership` | Whose, since when? | owner handle, the dated event, the source | always present |

## Known, unknown and absent

**`Known<T>`** is `{ value }` or `{ unknown: <reach> }`, where the reach is the
domain's `HostReach` without `ok`: `unasked`, `throttled`, `secondary`,
`failed`. It is the only unknown vocabulary on a card.

- **Absent** — the board read, and nothing is there. A relation is `{ value: [] }`;
  the card shows nothing for it.
- **Unknown** — the board did not read, or the read failed. The card shows one
  muted word in that fact's own place: *checks unknown*, *cost not measured
  here*, *stories unknown — unreadable*. Never a zero, never nothing.

Unknown is per item: a PR list of six with one unreadable reads *6 PRs · 1
checks unknown*.

## Refs

A **ref** names another board item with the phase of the kind it names:
`ticket` (lane), `story` (status, archived), `plan` (status), `sprint` (state)
and `slice` (plan, branch, PR). A story or sprint a plan names with no file
behind it is a ref whose status or state is `null` and whose title is its slug.
A ticket a plan names by its `Issue:` key is a ref whose lane is `null` and
whose title is the key; the first key is the plan's `identity.key`, and the
card shows the rest in its lineage row.

## Actions and reasons

An **action** is `{ action, enabled, reason }`; `reason` is set exactly when
`enabled` is false. Opening is not an action: the title is the card's only open
link. A disabled primary stays on the card with its reason beside it. A
secondary the plan's own state disables is omitted; one the board's
configuration refuses stays, disabled, with `action-unavailable`.

| Reason | Means | Card words |
|---|---|---|
| `action-unavailable` | This board will not run the action (a board-wide fact). | *unavailable on this board* |
| `awaiting-fleet-scan` | No pulse covers the plan yet. | *no fleet scan yet* |
| `nothing-eligible` | No branch can start; `waitsOn` names the slices in the way. | *waits on feature/x #3105* |
| `awaits-spike` | A Design plan waits on its spike's merge. | *waits on its spike feature/s #41* |
| `linked-from-many-stories` | A ticket two or more stories name. | *linked from 2 stories* |
| `lineage-unknown` | The relation an action depends on was not read. | *plans unread — host throttled* |

## Alerts

| Alert | Means | Card words |
|---|---|---|
| `not-pushed` | The item exists only in the board's working tree. | *not pushed* |
| `status-behind` | A story's written status is behind what its plans prove. | *status behind: …* |
| `issue-link-unreadable` | A story's `issue:` names something not indexed. | *issue link unreadable: …* |

## The line between a fact and a word

A value belongs in `CardFacts` if a second presentation — a CLI listing, a Slack
digest — would need the same value; it belongs in the mapping if a second
presentation would phrase or place it differently. `merged: 2, total: 3` is a
fact; *2/3 slices complete* is a word.

Two gates hold the line. The schema gate (`packages/domain/test/card-facts.test.ts`)
refuses any string field on `CardFacts` outside the identifier, date and content
names. `scripts/check-card-presentation.sh` refuses any import in
`card-presentation.ts` other than the `CardFacts` types and the board's UI helpers.

## Rows and lists

`presentCard` returns the rows in a fixed order: title (with type and alerts),
lineage, progress, the action row, ownership. A list of two or more entries
collapses to a count and expands in place under a `<button aria-expanded>`. The
tab order is title, primary, secondaries, then the rows' links and expanders.
