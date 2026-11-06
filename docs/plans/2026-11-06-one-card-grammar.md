# Tickets, Stories and Plans cards share one five-row card

> The card grammar is a domain concept: every board item projects into the same five semantic facets in the domain, and the UI presents them in one layout, so a reader learns where to look once.

## Status

- **State:** Design
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Design:** 2026-11-06, jwloka, cli
- **Rounds:** 1

## Changelog

- Ticket, story and plan cards on the board answer the same five questions in the same place: what it is, what it is part of, how far it is, what to do next and why not, and who owns it since when. A ticket whose plan exists links to that plan instead of offering *Create plan*.

<!-- Board impact: board rendering and the domain package. No change to the plan
     format, the plan template, helper scripts or the docs/plans layout — unless
     the Design finds the lineage in row 2 is not readable today (Open Question 1),
     in which case that becomes its own plan. -->

## Motivation

The three boards describe the same work and present it three ways. Measured on the
running board, 2026-11-06:

| Question | Ticket card | Story card | Plan card |
|---|---|---|---|
| What is it? | `3178: title` | title, no number | `3101: title` — the ticket's number |
| Who owns it? | name on its own line | name on its own line | `@jwloka`, bottom right |
| How fresh? | `opened 10h ago` | `Created · Updated` | nothing |
| How far? | nothing | `11 plans · 11 delivered` | `2 slices · 2 branches` — a count, not progress |
| Part of what? | nothing | sprints, not plans | sprint chip, `no story` |
| What next? | `Create plan / Create story` | nothing | `Open / Approve / Start work`, the last greyed with no reason |
| Anything wrong? | nothing | an unlabelled ⚠ | `not measured here`; `checks not asked` once per PR |

Three defects fall out of that table rather than out of taste:

- **Ticket 3102 offers *Create plan* while its plan sits in Development.**
  `ticketCardShowsActions` (`packages/domain/src/rules/ticket-card.ts:87`) answers
  from the lane alone — `open` or `in-progress` shows the actions — and never asks
  whether a plan already answers the ticket.
- **Absence is rendered as content.** `no story` and `not measured here` are chips
  with the same weight as real facts; on the 3077 card they outweigh its five PRs.
- **A disabled action gives no reason.** A greyed *Start work* is a dead end; the
  reader cannot tell *waits on #3105* from *broken*.

The cause is structural: the domain holds **three unrelated card rules** —
`planCardView` (type, owner), `storyCardView` (author), `ticketCardView` (icon,
reference, age, actions) — plus `cardControls`. Each answers a different subset,
so each board renders a different subset, and nothing makes them agree.

## Design

### Approach

**The card grammar is a domain concept, split in two along the layering rule:
the semantic model lives in the domain, the presentation lives in the UI.**

**The domain answers *what is true about this item*, and knows no layout.** It
holds typed facts — kinds, references, counts, enums — and no strings meant for a
reader, no row numbers, no icons, no order on screen:

- **`packages/domain/src/entities/card-facts.ts`** — the `CardFacts` schema (Zod,
  like the other entities): five facets, one per question a reader asks of any
  board item.

  | Facet | Answers | Holds | Absent means |
  |---|---|---|---|
  | `identity` | what is it? | kind (`ticket` · `story` · `plan`), number, title, alerts as typed kinds | — always present |
  | `lineage` | what is it part of? | references to the related ticket, story, plans and sprints, each as kind + id + phase | that relation does not exist — never a placeholder value |
  | `progress` | how far is it? | done / total and the unit (`slices`, `plans`), plus PR counts by check state | nothing was measured |
  | `next` | what can be done now? | one action kind, `enabled`, and when disabled a typed reason with its subject (`waits-on` #3105) | no action belongs here |
  | `ownership` | whose, since when? | owner handle, last change, source reference (`repo#N` or plan path) | — always present |

- **`docs/domain/card-grammar.md`** — the vocabulary: *card grammar*, the five
  facet names, *lineage*, *progress*, *next*, and the alert and reason kinds. Code
  follows the document, as `DESIGN-slice.md` binds Slice.
- **One projection per kind**, each returning `CardFacts`: `planCardFacts`,
  `storyCardFacts`, `ticketCardFacts`. **They extend the existing rules rather than
  replace them** — `planCardView`'s type and owner feed `identity` and
  `ownership`, and its tests keep holding; `storyCardView`, `ticketCardView` and
  `cardControls` fold in the same way. A rule is removed only when no caller reads
  it. Strings the existing rules produce for display (`ticketCardSubtitle`,
  `ticketCardAge`) move to the UI side rather than into `CardFacts`.

**The line between a fact and a word is the second-UI test.** A value belongs in
`CardFacts` if a second presentation — a CLI listing, a Slack digest — would need
the same value; it belongs in the mapping if a second presentation would phrase
or place it differently. So `merged: 2, total: 3` is a fact and *in progress 2/3*
is a word; `status-behind` with the proven standing is a fact and *status behind:
plans delivered* is a word. Two rules return words from the domain today —
`ticketPhase`'s `label` and `statusDrift`'s phrase — and each migrates when the
slice converting its card touches it, not before: the unit is the function, and
neither is rewritten for a card this plan has not reached yet.

**The UI answers *how it looks*, and decides no fact.** In `packages/board`:

- **A presentation mapping** (`card-presentation.ts`, pure, unit-tested without a
  browser) turns `CardFacts` into rows: the five-row order, wording (`4/6 slices
  merged · 1 PR running`, `waits on #3105`), alert labels, icons, which chips
  show, and what collapses (*in 9 sprints*, a PR list behind one line).
- **Every board uses the same row positions; each board emphasises a different
  facet** — the one its reader came for. The Tickets reader asks *is this answered
  yet?*, so `lineage` is strongest there; the Stories reader asks *how far is the
  umbrella?*, so `progress`; the Plans reader asks *what can I do now?*, so `next`.
  Emphasis is weight and colour only, never position, so a reader who learned
  one board can still find every fact on the other two. The mapping takes the
  board as an input and returns the emphasised facet; nothing in `CardFacts`
  knows which board renders it.
- **A long list collapses to a count and expands in place.** Nine sprints read
  *in 9 sprints*, six PRs read *6 PRs · 1 running*, sixty-two plans read *62
  plans · 60 delivered*, and one click expands the list inside the card, so every
  card is the same height until a reader asks for more. The count comes from
  `CardFacts`; the summary sentence, the collapsed state and the expander are
  presentation. A first-three preview was rejected because which three to show
  is a ranking the reader cannot see, and a detail-drawer-only list was rejected
  because it takes the reader off the board for the most common question about
  a PR list: is anything red?
- **One `<Card>` component** renders that mapping on all three boards; one browser
  test per board proves it shows what the mapping returned.

This keeps both halves of *Every rendered state is a domain property*: whether a
relation exists, whether an action is enabled and why not, are domain facts
asserted on `CardFacts`; the words and the order are asserted on the mapping, and
neither needs a browser.

**Six rules, each with an owner:**

| Rule | Owner | Asserted on |
|---|---|---|
| One fixed place per fact — owner and age in the same row on every kind | UI | the mapping |
| Absence is omitted unless actionable (`no plan` + *Create plan*) | domain says absent and what action applies; UI shows nothing else | `CardFacts`, then the mapping |
| One primary action; a disabled one gives its reason | domain: `next.enabled` + typed reason; UI: the words | both |
| A PR list reads as one line and expands | domain: counts; UI: the sentence and the expander | both |
| Every alert carries a label — no bare ⚠ | domain: alert kind; UI: label and icon | the mapping |
| The same number links across kinds | domain: `lineage` references both ways | `CardFacts` |

**The tracer proves the grammar on the Plans board**, the richest card: it is
the only one that exercises all five facets at once — `progress` with a PR
summary, `next` with a disabled reason, `lineage` up to story and sprint — so a
facet that does not fit shows up in wave one rather than after two boards are
converted. The cost is that the most visible defect, a ticket offering *Create
plan* for a plan that exists, waits for wave two; the Tickets slice carries it
first among its changes. A tracer that fixed only that defect would prove
`lineage` and leave `progress` and `next` unproven, and converting one facet on
all three boards would leave every card half in the old layout.

### Open Questions

- [x] **Does the domain already hold ticket ↔ plan ↔ story links?** *Answered
      2026-11-06, from the code: ticket → plan exists and is thrown away; no new
      read is needed.* `ticketPlansOf` (`packages/board/src/server/fleet.ts:1710`)
      already builds a map from each issue key to the plans whose `Issue:` field
      names it, from plan metas the board reads anyway. But it projects each plan
      to `TicketPlan` (`rules/ticket-phase.ts:4`) — `state`, `total`, `merged` —
      and drops the plan's identity, so the ticket knows *that* a plan exists and
      how far it is, never *which*. `ticketPhase` uses it only for the lane label;
      `ticketCardShowsActions` ignores it. **Consequence for scope:** adding the
      plan's slug and title to `TicketPlan` is enough for `lineage` and for `next`
      to offer *Open plan*; it stays inside this plan. Plan → story is the plan's
      `Story:` field and story → plans already feeds the story card's counts. Ticket
      → story is not yet checked.
- [x] **What does each board's primary reader look for first?** Tickets: is this
      answered yet? Stories: how far along is the umbrella? Plans: what can I do
      now? Settled as per-board emphasis over identical positions (Approach).
- [x] **What does the story card's ⚠ mean today?** *Answered 2026-11-06:* status
      drift — the story's written status is **behind** what its plans prove.
      `statusDrift` (`packages/domain/src/transitions/story.ts:468`) reports one
      direction only, and `StoriesTab.tsx:556` shows its phrase solely as a hover
      `title` on a bare ⚠, so on touch or at a glance it carries no meaning. In the
      grammar it is an `identity` alert of kind `status-behind` with the proven
      standing as its subject; the UI labels it (*status behind: plans delivered*).
      `statusDrift` returns a phrase today (`BEHIND[derived]`) — a word made in the
      domain, which this plan's split moves to the mapping.
- [x] **Where does a sprint list go on a story with nine sprints?** It collapses
      to *in 9 sprints* and expands in place, like every long list (Approach).
- [x] **Does `cardControls` become the `next` facet, or stay beside it?**
      *Answered 2026-11-06: beside it, as `next`'s input.* `cardControls`
      (`rules/card-controls.ts:62`, two callers: `board.ts:2687`, `mock-fleet.ts:498`)
      returns nine independent flags — `approve`, `needsDesign`, `interrogate`,
      `roundsBadge`, `dispatch`, `readyToStart`, `approveSpike`, `confirmSlices`,
      `spikeState` — which is the plan's *capability set*, not one next action, and
      carries no reason when a flag is false. `next` derives from it: choose the one
      primary action from the set, and name why it is disabled (`started`, awaiting
      the spike, unapproved). The secondary flags stay available to the UI for
      secondary links. `cardControls` keeps its schema and both callers unchanged.
- [x] **Where exactly is the line between a fact and a word?** The second-UI
      test, with existing domain phrases migrating as their card is converted
      (Approach).

## Spec

_To be filled in during Design._

## Slices

### Tracer

- `feature/one-card-grammar-plans` — the `CardFacts` entity, `docs/domain/card-grammar.md`, `planCardFacts` extending `planCardView`, the presentation mapping and the shared `<Card>` on the Plans board only <!-- builds: CardFacts entity and planCardFacts projection --> <!-- spike -->

### Implementation

- `feature/one-card-grammar-tickets` — `ticketCardFacts`, with `lineage` naming the plan that answers a ticket and `next` offering *Open plan* in place of *Create plan*; the Tickets board renders through the shared `<Card>` <!-- builds: ticketCardFacts projection -->
- `feature/one-card-grammar-stories` — `storyCardFacts`, with plans in `lineage` and progress as delivered out of total; the Stories board renders through the shared `<Card>` <!-- builds: storyCardFacts projection -->

## Notes

- Earlier card work this builds on, all Released: `2026-10-14-the-discovery-ticket-card-shows-its`
  (number, state, age), `2026-10-15-discovery-and-planning-cards-show-the` (type,
  owner), `2026-10-15-discovery-story-cards-read-invalid-date` (dates, quoting).
  This plan changes their layout, not what they fixed.
- Decided at intake, 2026-11-06: extend `planCardView` rather than replace it;
  no tracker issue; enter Design rather than Draft; the card grammar is a domain
  concept with its own vocabulary document — its semantic model in the domain,
  its presentation in the UI.
- A story was considered for problem exploration and declined: the problem is
  evidenced by the table above, and the uncertainty is in the solution, which is
  what Design is for. If Open Question 1 needs a new read, a story wraps both plans.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "Which facet is visually strongest per board?", "a": "Per board: Tickets lineage, Stories progress, Plans next; positions identical", "category": "ux"},
    {"q": "Where is the line between a domain fact and a UI word?", "a": "Second-UI test; existing domain phrases migrate when their card is touched", "category": "technical"},
    {"q": "How do long lists collapse?", "a": "Count plus inline expand", "category": "ux"},
    {"q": "Which card does the tracer prove the grammar on?", "a": "Plans board", "category": "tradeOffs"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": false},
    "domain": true,
    "ux": {"happyPath": true, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
