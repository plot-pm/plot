# Tickets, Stories and Plans cards share one five-row card

> The card grammar is a domain concept: every board item projects into the same five semantic facets in the domain, and the UI presents them in one layout, so a reader learns where to look once.

## Status

- **State:** Design
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Design:** 2026-11-06, jwloka, cli
- **Rounds:** 4

## Changelog

- Ticket, story and plan cards on the board answer the same five questions in the same place: what it is, what it is part of, how far it is, what to do next and why not, and who owns it since when. A ticket links to the plan and the story that answer it instead of offering to create them again, and *Create plan* on a ticket inside a story creates the plan in that story. A story names its ticket in an `issue:` frontmatter field.

<!-- Board impact: board rendering, the domain package, the story format and two
     endpoints. No change to the plan format, the plan template, helper scripts or
     the docs/plans layout. The story format gains a parsed `issue:` frontmatter
     field (legacy `jira:` still read), and the story-tracking template writes it —
     a skill change, bumped in the changeset. `POST /api/idea` still takes only the
     issue number; the server finds the ticket's story itself and tells the idea
     agent, which writes the plan's `Story:`;
     `POST /api/story` writes `issue:` into the story it creates. -->

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
  | `identity` | what is it? | kind (`ticket` · `story` · `plan`), number, title, the item's own reference that *open* resolves to, alerts as typed kinds | — always present |
  | `lineage` | what is it part of? | references to the related ticket, story, plans and sprints, each as kind + id + phase | that relation does not exist — never a placeholder value |
  | `progress` | how far is it? | done / total and the unit (`slices`, `plans`), plus PR counts by check state | nothing was measured |
  | `next` | what can be done now? | one primary action kind, `enabled`, and when disabled a typed reason with its subject (`waits-on` #3105); then the secondary action kinds this item offers | no action belongs here |
  | `ownership` | whose, since when? | owner handle, last change, source reference (`repo#N` or plan path) | — always present |

  **Absent and unknown are different values, and the schema keeps them apart.**
  Every fact the board reads from somewhere that can fail to answer — a PR's
  checks, a host lookup, a merge state — is either a value or `unknown` with the
  reason it was not read (`throttled`, `not-asked`, `unreadable`). Absent means the
  board read and nothing is there; `unknown` means it did not read. The same
  invariant as *the index never says no*: a throttled host must never make a card
  read as finished, unstarted or check-free. `checks not asked` and `not measured
  here` on today's plan cards are this distinction, rendered as noise.

  **Opening is not an action.** It is a property of `identity`: every item opens to
  the board's own detail view of that item — ticket, story and plan alike — and
  the detail view links out to the host issue, the PR or the plan file. `next`
  holds only actions that change something.

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
- **Every card opens and acts the same way.** The title is the card's only open
  link, on every board, so no card carries a separate *Open* word and none opens
  on a click anywhere — Stories' whole-card button goes, because an action nested
  inside a clickable card is a trap for keyboard and screen-reader users. Below
  the facts sits one action row: the primary action from `next` first, styled as
  the primary, then the secondary actions as text links in a fixed order per
  kind. A disabled primary stays visible with its reason beside it (*Start work —
  waits on #3105*); a disabled secondary is omitted. A ticket's *Create plan* /
  *Create story* pair and a plan's *Approve* / *Interrogate* pair both become one
  primary plus secondaries in that row.
- **Creating is a `next` action, and `lineage` decides which create is offered.**
  An item offers to create only the relation it does not have yet, so a ticket
  whose plan exists can never offer *Create plan* again — the 3102 defect is
  ruled out by the shape rather than by a check:

  | Card | Its `lineage` holds | Primary | Secondary |
  |---|---|---|---|
  | ticket | no plan, no story | *Create plan* | *Create story* |
  | ticket | a live story, no plan | *Create plan*, inside that story | — |
  | ticket | two or more stories, no plan | *Create plan*, disabled: *linked from N stories*, naming them | — |
  | ticket | only a done or archived story, no plan | *Create plan*, outside any story, saying why | — |
  | ticket | a plan, no story | — the plan shows in `lineage` | *Create story* |
  | ticket | a plan and a story | — | — |
  | ticket | done lane | — | — |
  | story | no plans | *Add plan* | — |
  | story | plans | its lifecycle action, if any | *Add plan* |
  | plan | — | its lifecycle action (*Approve*, *Start work*, *Deliver*) | *Interrogate* where the phase allows |

  *Create plan* is the primary on a bare ticket because most tickets become one
  plan; *Create story* is the secondary for work that will span several, which is
  the same choice `/plot-idea` makes when it declines a story the problem does not
  need. A plan card creates nothing: what it could create — a story around it —
  belongs to the ticket or the story.
- **An unknown fact shows one muted word in its own place** — *6 PRs · checks
  unknown*, never *0 failing* and never nothing. Absent facts are omitted.
- **No meaning by colour alone.** Emphasis may use colour, but every alert, check
  state and disabled reason also carries text, in both themes. Each card is one
  focus group in a fixed tab order — title link, primary action, secondaries,
  then expanders — and each expander is a `<button>` with `aria-expanded`. The
  mapping's tests assert the text exists; the browser test asserts the tab order.
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

**`CardFacts` is computed on the server, once per board build**, where
`planCardView` and `cardControls` run today (`board.ts`), from readings the build
already holds — about 220 tickets, 60 plans and a handful of stories, each a pure
function over values in memory, so no projection adds a read and the cost grows
linearly with the estate. `/api/board` carries the facts; the browser only maps
them. A cache keyed by a card's readings was considered and left out: it adds an
invalidation to get wrong, and nothing has measured the build as slow.

**`/api/board` changes shape one kind at a time.** Each slice adds `facts` beside
its kind's existing fields and removes the old fields in the same slice once no
reader reads them — the board app, `mock-fleet.ts` (which emits facts through the
same projections rather than shapes of its own), `release-smoke.sh` and
`plot-ask.mjs board`. **The old rules retire with their last caller, in the slice
that converts it:** `planCardView` in the tracer, `storyCardView` in Stories,
`ticketCardView`, `ticketCardShowsActions`, `ticketCardSubtitle` and
`ticketCardAge` in Tickets — their tests move to the projection that replaces
them, and no deprecated wrapper is left behind. `cardControls` stays, as `next`'s
input.

**The split is a gate in both directions, not a rule.** A schema test in the
domain refuses a free-text string field on `CardFacts` other than a title, an id,
a handle or a reference — the shape a sentence would have to take to sneak in.
`scripts/check-card-presentation.sh` refuses an import in `card-presentation.ts`
other than the `CardFacts` types and UI helpers, so the mapping cannot reach a
reading and decide a fact. Both run with the existing `check-*.sh` set in CI and
in the Local checks list. The split is revisited if a second presentation needs a
word the mapping owns — that word then moves into the domain as a typed value,
never as a string.

**No new input crosses the trust boundary.** *Create plan* still sends the
issue number and nothing else — the contract `CreatePlanButton.tsx` states — and
the server finds the ticket's story in its own ticket → story index, so no slug a
browser could forge reaches the idea agent's prompt. A ticket linked from two or
more stories gets a disabled *Create plan* naming them, because which umbrella a
plan belongs to is a person's call and the domain never guesses it; a done or
archived story does not receive new plans, and the ticket falls back to a plain
*Create plan* outside any story with that reason shown. A story's `issue:` value
is written by a person or an agent, so the parser accepts only an issue URL on
this repository's configured git host or a key matching its configured tracker;
anything else is an `issue-link-unreadable` alert on the story card and is never
indexed, so a stray cross-repository link cannot attach a story to the wrong
ticket.

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
      plan's slug and title to `TicketPlan` is enough for `lineage` to link the
      plan and for `next` to withdraw *Create plan*; it stays inside this plan. Plan
      → story is the plan's `Story:` field and story → plans already feeds the story
      card's counts.
- [x] **Does the domain know ticket → story, and can *Create plan* from a ticket
      inside a story write the plan's `Story:` field?** Neither, and both are in
      this plan. The `Story` entity holds no ticket; the one link the domain
      defines, `trackerKeyOf(slug)` (`entities/story.ts:56`), reads a Jira key from
      a slug prefix, has no caller, and cannot match a GitHub number. What gets
      written disagrees with itself: the story-tracking template writes `jira:`,
      the one story created from a ticket wrote `issue:`, and nothing parses
      either — which is why ticket 3170 offers *Create story* while its story
      *Nothing changed, nothing runs* sits in Draft, the 3102 defect for stories.
      And `POST /api/idea` takes `{number, type}` only, so the idea agent never
      learns the story. **The field is `issue:`** — what was actually written, the
      name plans already use, and neutral between a GitHub URL and a Jira key;
      the parser still reads `jira:`. `trackerKeyOf` stays until a caller needs a
      slug-only link, which no story here relies on.
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

### `CardFacts` (domain — `entities/card-facts.ts`)

```ts
type CardKind = 'ticket' | 'story' | 'plan';
type Ref = { kind: CardKind | 'sprint'; id: string; title: string; phase: string | null };
type Unknown = { unknown: 'throttled' | 'not-asked' | 'unreadable' };
type Known<T> = T | Unknown;

type CardFacts = {
  identity: {
    kind: CardKind;
    id: string;                     // issue key, story slug or plan slug
    number: number | null;          // the shared #N, where the item has one
    title: string;
    opens: Ref;                     // the board's own detail view of this item
    alerts: Alert[];
  };
  lineage: Ref[];                   // ordered ticket, story, plan, sprint; absent relations omitted
  progress: null | {                // null: nothing measured
    unit: 'slices' | 'plans';
    done: Known<number>;
    total: number;
    prs: null | { total: number; byChecks: Known<Record<'green' | 'running' | 'failing' | 'none', number>> };
  };
  next: null | {                    // null: no action belongs to this card
    primary: { action: ActionKind; enabled: boolean; reason: Reason | null };
    secondary: ActionKind[];        // enabled only; a disabled secondary is omitted
  };
  ownership: { owner: string | null; changedAt: string | null; source: Ref | { path: string } };
};

type Alert =
  | { kind: 'status-behind'; proven: StoryStanding }
  | { kind: 'issue-link-unreadable'; value: string };

type Reason =
  | { kind: 'waits-on'; ref: Ref }
  | { kind: 'started' }
  | { kind: 'awaits-spike' }
  | { kind: 'linked-from-many-stories'; stories: Ref[] }
  | { kind: 'story-not-live'; story: Ref };

type ActionKind =
  | 'create-plan' | 'create-story' | 'add-plan'
  | 'approve' | 'approve-spike' | 'confirm-slices' | 'interrogate'
  | 'start-work' | 'deliver';
```

**Invariants, each a unit test on the schema or a projection:**

1. No string field other than `title`, `id`, `owner`, `path`, `value`, `phase` and the
   ISO dates — the schema gate refuses any other.
2. `lineage` holds each relation at most once per referenced item, in the fixed
   kind order; an item never appears in its own `lineage`.
3. `next.primary.reason` is non-null exactly when `enabled` is false.
4. A ticket offers `create-plan` only when no plan's `Issue:` names it, and
   `create-story` only when no story's `issue:` names it.
5. A value read from a host that did not answer is `Unknown`, never `0` and never
   omitted.

### Projections (domain — `rules/`)

| Projection | Reads | Replaces |
|---|---|---|
| `planCardFacts(reading, controls, directory)` | plan meta, pulse slices, PR index rows, `cardControls` | `planCardView` |
| `storyCardFacts(story, plans, issueIndex, directory)` | story frontmatter incl. `issue:`, its plans | `storyCardView`; `statusDrift`'s phrase becomes the `status-behind` alert |
| `ticketCardFacts(row, plans, stories, directory)` | ticket row, `TicketPlan` (now with slug and title), ticket → story index | `ticketCardView`, `ticketCardShowsActions`, `ticketCardSubtitle`, `ticketCardAge` |

`TicketPlan` gains `slug` and `title`. The ticket → story index is built where the
build reads stories, keyed by issue key, from `issue:` values that passed
validation.

### Presentation (board — `card-presentation.ts`, `<Card>`)

`presentCard(facts, board) → rows` returns, in this fixed order: title (the
`opens` link) with labelled alerts; the lineage line; the progress line with an
expander for each list longer than one; the action row; the ownership line. It
returns which row is emphasised — `lineage` on Tickets, `progress` on Stories,
`next` on Plans — and every word: summaries (*6 PRs · 1 running*), reasons
(*waits on #3105*, *linked from 2 stories*), unknowns (*checks unknown*) and alert
labels. `<Card>` renders the rows and decides nothing; its tab order is title,
primary, secondaries, expanders; each expander is a `<button aria-expanded>`.
The import gate allows `card-presentation.ts` the `CardFacts` types and UI
helpers only.

### Endpoints and formats

- `/api/board`: each kind's items carry `facts: CardFacts`; that kind's old card
  fields are removed in the same slice.
- `POST /api/idea`: body unchanged, `{number, type}`. When the ticket → story
  index names exactly one live story, the idea agent's brief carries that story's
  slug and the created plan's `## Status` has `Story: <slug>`.
- `POST /api/story`: the story it creates carries `issue: <issue URL>`.
- Story frontmatter: `issue:` holds an issue URL on this repository's git host or
  a key of its configured tracker; `jira:` is read when `issue:` is absent. The
  story-tracking template writes `issue:`.

### Done when

- **Tracer:** the Plans board renders every plan through `<Card>` from `facts`;
  `planCardView` is gone; both gates fail on a seeded violation and pass on the
  branch; one browser test proves the Plans board shows the mapping's rows and tab
  order.
- **Stories:** story 3170's card links ticket #3170; ticket #3170 no longer offers
  *Create story*; the ⚠ reads as a labelled alert; a story with an `issue:` to
  another repository shows `issue-link-unreadable` and is not indexed.
- **Tickets:** ticket #3102 links its plan and offers no *Create plan*; *Create
  plan* on a ticket in one live story produces a plan whose `Story:` names it; a
  ticket linked from two stories shows a disabled *Create plan* naming both.

## Slices

### Tracer

- `feature/one-card-grammar-plans` — the `CardFacts` entity and its schema gate, `docs/domain/card-grammar.md`, `planCardFacts` replacing `planCardView`, plan `facts` in `/api/board`, the presentation mapping and its import gate, and the shared `<Card>` on the Plans board only <!-- builds: CardFacts entity and planCardFacts projection --> <!-- spike -->

### Stories

- `feature/one-card-grammar-stories` — the story's `issue:` field (parsed, `jira:` read as legacy, the story-tracking template and `POST /api/story` writing it), the ticket → story reverse index, and `storyCardFacts` with its ticket and plans in `lineage` and progress as delivered out of total; the Stories board renders through the shared `<Card>` <!-- builds: storyCardFacts projection and the story issue field -->

### Tickets

- `feature/one-card-grammar-tickets` — `ticketCardFacts`, with `lineage` naming the plan and the story that answer a ticket and `next` offering only the creates its lineage lacks; `POST /api/idea` still takes only the issue number and the server derives the story, so *Create plan* on a ticket inside a story writes the plan's `Story:`; the Tickets board renders through the shared `<Card>` <!-- builds: ticketCardFacts projection -->

The Tickets slice follows the Stories slice rather than running beside it: its
*a story, no plan* row needs the ticket → story index that Stories builds, and a
Tickets card that could not yet see stories would offer *Create story* on 3170
exactly as today.

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
  "round": 4,
  "questionHistory": [
    {
      "q": "Which facet is visually strongest per board?",
      "a": "Per board: Tickets lineage, Stories progress, Plans next; positions identical",
      "category": "ux"
    },
    {
      "q": "Where is the line between a domain fact and a UI word?",
      "a": "Second-UI test; existing domain phrases migrate when their card is touched",
      "category": "technical"
    },
    {
      "q": "How do long lists collapse?",
      "a": "Count plus inline expand",
      "category": "ux"
    },
    {
      "q": "Which card does the tracer prove the grammar on?",
      "a": "Plans board",
      "category": "tradeOffs"
    },
    {
      "q": "How are actions presented consistently on every card?",
      "a": "Title is the open link; one action row: primary from next, then secondaries in fixed order",
      "category": "ux"
    },
    {
      "q": "Where does open take the reader?",
      "a": "The board's own detail view for every kind; detail links out to host",
      "category": "ux"
    },
    {
      "q": "How does a card show a fact it could not read?",
      "a": "CardFacts separates absent from unknown; unknown shows one muted word in its facet",
      "category": "domain"
    },
    {
      "q": "What accessibility bar do cards meet?",
      "a": "No meaning by colour alone; one focus group per card; expanders are buttons with aria-expanded",
      "category": "ux"
    },
    {
      "q": "Where do Create plan and Create story fit?",
      "a": "next actions decided by lineage; a bare ticket's primary is Create plan, Create story secondary",
      "category": "domain"
    },
    {
      "q": "How does this plan handle ticket -> story?",
      "a": "All in this plan: parse the link, reverse index, server derives the story for /api/idea, template writes issue:",
      "category": "technical"
    },
    {
      "q": "Which field names a story's ticket?",
      "a": "issue:, with jira: read as legacy",
      "category": "domain"
    },
    {
      "q": "Where are CardFacts computed?",
      "a": "Server, once per board build, from readings in hand; no cache",
      "category": "nonFunctional"
    },
    {
      "q": "How do the old card rules retire?",
      "a": "Deleted in the slice converting their last caller; tests move; cardControls stays",
      "category": "technical"
    },
    {
      "q": "Is the domain/UI split a rule or a gate?",
      "a": "Gate both directions: CardFacts schema test and a check script on card-presentation imports",
      "category": "tradeOffs"
    },
    {
      "q": "How does /api/board change shape?",
      "a": "Per kind: add facts, drop old fields in the same slice; mock-fleet uses the projections",
      "category": "technical"
    },
    {
      "q": "How does the server learn the story for Create plan?",
      "a": "Server derives it from its ticket->story index; client still sends only the number",
      "category": "nonFunctional"
    },
    {
      "q": "Ticket linked from several stories?",
      "a": "Disabled Create plan naming the stories",
      "category": "domain"
    },
    {
      "q": "Which stories may receive a new plan?",
      "a": "Live only; otherwise plain Create plan outside any story, with the reason",
      "category": "domain"
    },
    {
      "q": "What does the issue: parser accept?",
      "a": "Only this repo's host issue URLs or configured tracker keys; else an alert, never indexed",
      "category": "nonFunctional"
    }
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {
      "stack": true,
      "architecture": true,
      "implementation": true
    },
    "domain": true,
    "ux": {
      "happyPath": true,
      "edgeCases": true,
      "errors": true,
      "accessibility": true
    },
    "nonFunctional": {
      "security": true,
      "performance": true,
      "scalability": true
    },
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
