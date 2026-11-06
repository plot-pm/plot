# Tickets, Stories and Plans cards share one card layout

> The card grammar is a domain concept: every board item projects into the same five semantic facets in the domain, and the UI presents them in one layout, so a reader learns where to look once.

## Status

- **State:** Design
- **Type:** feature
- **Sprint:** card-alignment
- **Review:** pr
- **Impl:** own branches
- **Design:** 2026-11-06, jwloka, cli
- **Rounds:** 5
- **Spike approved:** 2026-11-06, jwloka, plan-PR #3192 merged, feature/one-card-grammar-plans
- **Started:** 2026-11-06, jwloka, `feature/one-card-grammar-plans`

## Changelog

- Ticket, story and plan cards on the board answer the same five questions in the same place: what it is, what it is part of, how far it is, what to do next and why not, and who is assigned since when. Each card has three sections, a header, a status panel and a footer, and its status opens with the item's own state. A related sprint reads as its release number, the way a ticket reads as its number. A ticket links to the plan and the story that answer it instead of offering to create them again, and *Create plan* on a ticket inside a story creates the plan in that story. A story names its ticket in an `issue:` frontmatter field. Each card leads with an icon for its kind, its actions sit in a separate band, and a disabled action shows why on hover or keyboard focus.

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
  | `progress` | how far is it? | the item's own state in its kind's vocabulary (ticket lane, story status, plan phase), then done / total and the unit (`slices`, `plans`), plus PR counts by check state | — always present: every item has a state; a measure that was not taken is absent |
  | `next` | what can be done now? | at most one primary action — kind, `enabled`, and when disabled a typed reason — then the enabled secondary actions | no action belongs here: `primary` is null and `secondary` empty |
  | `ownership` | whose, since when? | assignees, last change, source reference (`repo#N` or plan path) | — always present |

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
  browser) turns `CardFacts` into the card's three sections (header, status,
  footer), wording (`4/6 slices
  merged · 1 PR running`, `waits on #3105`), alert labels, icons, which chips
  show, and what collapses (*in 9 sprints*, a PR list behind one line).
- **Every board uses the same section positions; each board emphasises a different
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
  inside a clickable card is a trap for keyboard and screen-reader users. The
  title row leads with the card's kind icon — ticket, story or plan, from
  `identity.kind` — with the kind as its accessible name, in the same place on
  every kind; a lineage link to another item carries that item's kind icon.
  Every kind icon comes from the board's one Octicon glyph set — the
  `KIND_ICON_PATH` table in `lib/tuple-row.ts` that the tuple rows already draw
  for ticket, plan, slice, PR and branch — which gains Octicons `iterations` for
  a sprint and `book` for a story; no second icon set exists. An icon is as
  large as the text it sits beside (`1em`), so the title's icon matches the
  title and a link's icon matches the link. The
  subtype is a tag beside it: a plan's `feature` / `bug` / `docs` / `infra`, and
  a ticket's tracker issue type, which stops being an icon of its own. Below the
  facts sits the action band, visually separate from the facts above it (a top
  divider, its own tint and padding) and omitted when the card offers no action.
  It holds the primary action from `next` first, styled as the primary, then the
  secondary actions in a fixed order per kind. Every action renders as a control
  — a `<button>` or a link — and never as plain text. A disabled primary stays
  visible as a control with `aria-disabled="true"`, focusable, in a muted style;
  its reason (*waits on #3105*) shows in a tooltip that opens below the control
  on hover and on keyboard focus, so it never covers the card's facts, closes on
  Escape, and is the control's `aria-describedby`, and a tap on touch shows it
  and does nothing else. The native `title` attribute is not the carrier,
  because it shows on neither focus nor touch; this holds for an action the
  board disables (a frozen page, an unconfigured command) as much as for one the
  plan's state disables. A secondary disabled by the item's own state is
  omitted; a secondary the board's configuration refuses stays visible as a
  disabled control with its reason. A ticket's *Create plan* / *Create story* pair and a
  plan's *Approve* / *Interrogate* pair both become one primary plus secondaries
  in that band.
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
  focus group in a fixed tab order — title link, primary action (disabled or
  not), secondaries, then expanders — and each expander is a `<button>` with
  `aria-expanded`. The
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

**`CardFacts` is computed on the server**, where each kind's rows are already
assembled: plans and stories in the `board.ts` build, tickets in
`discovery-lanes.ts` beside `ticketLanes` — which moves the ticket card rule out
of the browser, where it runs today (`StoriesTab.tsx:488`). Each projection is a
pure function over readings already in memory, so none adds a read and the cost
grows linearly with the estate. `/api/board` carries the facts; the browser only
maps them. A cache keyed by a card's readings was considered and left out: it
adds an invalidation to get wrong, and nothing has measured the build as slow.

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

**No untrusted input decides anything.** *Create plan* still sends the issue
number and nothing else — the contract `CreatePlanButton.tsx` states — and the
server re-derives the ticket's stories from `origin/<default>` at click time, so
no slug a browser could forge reaches the idea agent's prompt. *Add plan* on a
story card is the one new request that names an item, and it names it the way
`/api/approve` names a plan: the slug must match an existing live story on the
default branch, and the agent's brief is built from that story's committed file,
never from the request. A ticket linked from two or more stories refuses rather
than guesses; an index that could not be built refuses rather than reading as
*no story*. A story's `issue:` is accepted only when it names this repository's
own issues — owner and repository, not merely the host — or a declared Jira
project; anything else is an alert and never indexed (Spec).

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
      primary action from the set, and name why it is disabled (no fleet scan yet,
      nothing eligible, awaiting the spike, the action unavailable on this board). The secondary flags stay available to the UI for
      secondary links. `cardControls` keeps its schema and both callers unchanged.
- [x] **Where exactly is the line between a fact and a word?** The second-UI
      test, with existing domain phrases migrating as their card is converted
      (Approach).

## Spec

### `CardFacts` (domain — `entities/card-facts.ts`)

```ts
type CardKind = 'ticket' | 'story' | 'plan';

// A relation's phase is typed by the kind it points at — never free text.
type Ref =
  | { kind: 'ticket'; key: string; title: string; lane: TicketLane }
  | { kind: 'story'; slug: string; title: string; status: StoryStatus; archived: boolean }
  | { kind: 'plan'; slug: string; title: string; status: PlanStatus }
  | { kind: 'sprint'; slug: string; title: string; state: SprintState; release: string | null }   // release: the sprint's Release:, verbatim
  | { kind: 'slice'; plan: string; branch: string; pr: number | null };

// One unknown vocabulary, the domain's own: HostReach without 'ok'.
type Known<T> = { value: T } | { unknown: Exclude<HostReach, 'ok'> };

type CardFacts = {
  identity: {
    kind: CardKind;
    id: string;                       // issue key, story slug or plan slug
    key: string | null;               // the shared issue key ('3102', 'PROJ-12'), where one exists
    title: string;                    // content, verbatim
    summary: string | null;           // content, verbatim: a story's objective, ≤ 280 chars
    type: PlanType | null;            // feature | bug | docs | infra, where the item has one
    opens: Ref;                       // the board's own detail view of this item
    alerts: Alert[];
  };
  lineage: {                          // each relation separately; absent = read, and none exists
    tickets: Known<Ref[]>;
    stories: Known<Ref[]>;
    plans: Known<Ref[]>;
    sprints: Known<Ref[]>;
  };
  progress: {                         // always present: every item has a state
    state: Known<ItemState>;          // the item's own state in its kind's vocabulary
    work: null | { unit: 'slices' | 'plans'; done: Known<number>; total: number };   // a ticket: its one answering plan's work; null with several
    prs: Known<{ number: number; branch: string; checks: Checks }[]>;   // Checks incl. 'pending', 'unknown'
    design: null | { rounds: number | null; spike: SpikeCardState | null };
    verification: VerificationReading | null;
    cost: Known<CostReading>;
  };
  next: {
    primary: Action | null;           // null: this card has no primary action
    secondary: Action[];              // a secondary disabled by the item's state is omitted; one the board refuses carries its reason
  };
  ownership: {
    assignees: Known<string[]>;       // handles via People; { value: [] } = read, unassigned
    since: null | { at: string; event: 'opened' | 'updated' | 'transitioned' };
    source: Ref | { path: string };
  };
};

type ItemState =
  | { kind: 'ticket'; lane: TicketLane }
  | { kind: 'story'; status: StoryStatus }
  | { kind: 'plan'; status: PlanStatus };

type Action = { action: ActionKind; enabled: boolean; reason: Reason | null };

type ActionKind =
  | 'create-plan' | 'create-story' | 'add-plan'
  | 'needs-design' | 'interrogate' | 'approve' | 'approve-spike' | 'confirm-slices'
  | 'start-work' | 'deliver';

type Reason =
  | { kind: 'action-unavailable'; action: ActionKind }   // board-wide; the board's own action entry says why
  | { kind: 'awaiting-fleet-scan' }
  | { kind: 'nothing-eligible'; waitsOn: Ref[] }        // slice refs from the pulse's blockedBy; [] when none is named
  | { kind: 'awaits-spike'; spike: Ref }
  | { kind: 'linked-from-many-stories'; stories: Ref[] }
  | { kind: 'lineage-unknown'; relation: 'plans' | 'stories'; reach: Exclude<HostReach, 'ok'> };

type Alert =
  | { kind: 'status-behind'; proven: StoryStanding }
  | { kind: 'issue-link-unreadable'; value: string }    // value capped at 120 chars
  | { kind: 'not-pushed'; commits: number };
```

`PlanType`, `TicketLane`, `StoryStatus`, `PlanStatus`, `SprintState`, `Checks`,
`HostReach`, `SpikeCardState`, `StoryStanding` are the domain's existing types,
imported, not redeclared. `VerificationReading` and `CostReading` are the
readings `PlanCard.tsx` renders today (`card.verification`, `card.cost`), moved
into the domain as types; the words built from them (`plan-spend.ts:138-144`,
`slice-spend-record.ts:279`, `checks-reading.ts:216`) move to the mapping.

**Invariants, each a unit test:**

1. **No generated words.** The only string fields are identifiers (`id`, `key`, `release`,
   `slug`, `branch`, `plan`, the handles in `assignees`, `path`), ISO dates (`at`), and **content
   copied verbatim from the item** (`title`, `summary`, `value`). The schema gate
   refuses any other string field.
2. A `Known` relation is `unknown` whenever its input was not read —
   `plansUnreadable` from `discovery-lanes.ts`, a failed story read, a host
   reach other than `ok` — and `{ value: [] }` only when the read succeeded and
   found none.
3. `reason` is non-null exactly when `enabled` is false.
4. A ticket offers `create-plan` only when `lineage.plans` is `{ value: [] }`, and
   `create-story` only when `lineage.stories` is `{ value: [] }`. Either relation
   `unknown` gives a disabled `create-plan` with `lineage-unknown`, never an
   enabled one.
5. A ticket's `lineage.stories` is the union of stories whose `issue:` names it
   **and** stories named by the `Story:` field of any plan in its
   `lineage.plans`.
6. `start-work` follows `cardControls.dispatch`: enabled while the plan is
   approved or in progress and the pulse has an eligible slice — started or not.
   It is primary when `cardControls.readyToStart`, secondary otherwise.

### Projections (domain — `rules/`) and where each runs

| Projection | Runs in | Reads | Replaces |
|---|---|---|---|
| `planCardFacts` | `board.ts` build, where `planCardView` and `cardControls` run | plan meta, `cardControls`, pulse slices and `blockedBy`, PR index rows with reach, spend readings, verification | `planCardView` |
| `storyCardFacts` | `board.ts` story read (`:2225-2262`) | story frontmatter incl. `issue:`, its plans, `derivedStanding` | `storyCardView` |
| `ticketCardFacts` | `discovery-lanes.ts`, server side, beside `ticketLanes` | ticket row, `TicketPlan` (now `slug`, `title`, `story`), the ticket → story index, `plansUnreadable` | `ticketCardView`, `ticketCardShowsActions`, `ticketCardSubtitle`, `ticketCardAge` — today run in the browser at `StoriesTab.tsx:488` |

**`ownership.assignees`**: a ticket's tracker `assignees`; a story's `author:` (the template's *who owns/drives this story*); a plan's assignee. The approver is not an assignee: the `Approved:` record names the approver, and the card no longer switches to them after approval. A tracker that did not answer gives `unknown`; a read with nobody assigned gives `{ value: [] }`.

**`progress.state`**: a ticket's lane, a story's `status:`, a plan's `State:`. A ticket whose tracker did not answer reads `unknown`, never *open*.

**`ownership.since`**: a plan's newest transition record (`Approved:`,
`Started:`, `Delivered:`, `Design:`), else its file date — `transitioned`; a
story's `updated:` — `updated`; a ticket's `createdAt` — `opened`.

**Ticket `progress.work`**: no plan — `null`; one plan — that plan's slices; two or
more — `unit: 'plans'`, `done` counting plans Delivered or Released.

**`statusDrift`** keeps its phrase for its non-board callers (`standing.ts:83` →
`plot-story-lint.sh`), which are a second presentation of their own. The board
stops calling it: `storyCardFacts` emits `status-behind` from `derivedStanding`,
and `StoryModal.tsx` reads that alert through the mapping.

### The ticket → story link

- **The field** is `issue:` in story frontmatter, as `DESIGN-story.md:484`
  already specifies it (inbound ticket; `published:` is the outbound one and out
  of scope). `jira:` is read when `issue:` is absent; the template's unfilled
  `{JIRA_TICKET_URL}` placeholder reads as absent.
- **Accepted values**, all reduced to the issue key the ticket rows already use
  (`issueKey`):
  - on GitHub: `https://github.com/<owner>/<repo>/issues/<n>` or `#<n>`, where
    `<owner>/<repo>` equals the repository's own, read from `origin` through the
    `host` adapter — the host alone is not enough;
  - on Bitbucket: the same with the workspace and repository slug;
  - on Jira: a key `<PROJECT>-<n>` whose project is declared. **`Tracker: jira`
    gains an optional project list** (`Tracker: jira <url> PROJ, OPS`); with
    none declared, a Jira key is `issue-link-unreadable` rather than trusted.
- **Anything else** is an `issue-link-unreadable` alert on the story card and is
  never indexed.
- **The index is built from `origin/<default>`**, as `ticketPlansOf` reads plans —
  never from the working tree, so an uncommitted story cannot redirect a create.
- **"Live"** means `status` other than `done` and not archived; Draft is live.

### Endpoints

- **`POST /api/idea`** — body unchanged, `{number, type}`. At click time the
  server re-derives the ticket's stories from `origin/<default>` and refuses, by
  name, exactly as the card would have rendered it:
  `stories-unread` (the index could not be built — never *outside any story*),
  `linked-from-many-stories` (naming them). One live story → the brief carries
  its slug; only a done or archived story, or none → the plan is created outside
  any story, and the response says which. A slug enters the brief only after it
  matches `^[a-z0-9-]+$` and names an existing story, on a line **above** the
  quoted issue body.
- **`POST /api/story-plan`** (new) — body `{slug}`. Refuses `unknown-story`
  unless the slug matches `^[a-z0-9-]+$` and names a live story on
  `origin/<default>`, and `unattended` like its siblings. It starts the idea
  agent with a brief built from the story's committed file — never from the
  request — and the created plan carries `Story: <slug>`. Same spawn path and
  allow-list entry as `/api/idea`; nothing from the body reaches `sh -c`.
- **`POST /api/story`** — the story agent's brief instructs `issue: <issue URL>`
  in the frontmatter it writes; the test asserts the brief, since an agent's
  output cannot be asserted.
- **`/api/board`** — each kind's items carry `facts: CardFacts`. Fields a reader
  still needs stay until that reader converts: filters, swimlanes (`Swimlanes.tsx`),
  `PlanModal`, `StoryModal` and menus are converted in the slice of their kind,
  and a field is removed only in the slice that converts its last reader.

### Presentation (board — `card-presentation.ts`, `<Card>`, detail views)

`presentCard(facts, board) → sections`. The five facets are the model; the card
has three sections, each in a fixed place on every kind and each on its own
surface, and the mapping decides which facet parts go into which section. An
empty section, and an empty line inside one, is not drawn.

| Section | Surface | Holds | From |
|---|---|---|---|
| **Header** | the card surface | the kind icon and the title (the `opens` link, at most two lines); below it one muted meta line: number, subtype tag, labelled alerts, then each related item as icon + identifier | `identity`, `lineage` |
| **Status** | an inset panel, rounded, one surface step lighter (dark) or darker (light) than the card | line 1: the state pill, then work done / total with a progress bar stretched to the panel's width; line 2, the signals: PR check dots and counts, design rounds and spike state, verification | `progress` |
| **Footer** | a tinted band flush at the bottom with a top hairline | the assignees and the age on the left, the actions on the right: primary, then secondaries | `ownership`, `next` |

**A related item reads as icon + identifier**, the way a ticket reads as its
number, with its title and state in the tooltip:

| Item | On the card | Tooltip |
|---|---|---|
| ticket | `◎ #3170` or `◎ PROJ-12` | title, tracker state |
| story | `▥ <slug>`, shortened to fit | title, status |
| plan | `▤ 3092` (its issue key) or `▤ <slug>` | title, phase |
| sprint | `↻ 2.32.0` — the sprint's `Release:` copied verbatim; its short title when it names none | title, release, state |

Two or more of one kind fold to a count (*↻ 2 sprints*) that expands in place.
The release is not validated, as `/plot-sprint` states: it is named before it
is cut, so the card copies it.

The card shows what a reader scans for; the detail view holds the rest. **Not on
the card**: the source path or `repo#N` (`ownership.source`), the author or
approver, and cost unless it was measured — these show in `PlanModal`,
`StoryModal` and `TicketModal`. Age reads relative (*2 days ago*) with the
exact date and its event (*opened*, *updated*, *transitioned*) in the same
tooltip that carries disabled reasons. Assignees are round initials avatars;
two or more show the first plus a count, all names in the tooltip; nobody
assigned is an empty dashed circle whose accessible name and tooltip say
*Unassigned*; an unread assignee is the same circle named *Assignee unknown*.
The footer is drawn on a card with no actions too, because it holds the
assignees and the age.

**Visual design.** The card reads as one calm object with three groups, told
apart by surface and spacing rather than by rules:

- **Surface steps**: column → card → status panel, each one step apart, the same
  tokens in both themes; the footer has its own tint and a top hairline. The
  emphasised section takes the stronger tint: the status panel on the Testing
  column and discovery's story lanes, the footer on Design and Development and
  in swimlanes, the header's meta line on discovery's ticket lanes.
- **Spacing**: 16 px card padding, 12 px between sections, 4–6 px between lines
  inside a section, 12 px between cards. Every section aligns to the card's
  left padding; only the title is indented past the kind icon.
- **Card**: rounded corners (`rounded-xl`), a 1 px hairline border, a soft
  shadow that deepens on hover and on keyboard focus within the card, and a
  3 px left accent in the state's colour.
- **Type scale**: three steps only — title 15 px semibold; body 13 px; meta 12
  px in tabular figures. No italics for facts. An unknown is a muted word with a
  dotted underline, the same treatment everywhere. A measure takes a warning or
  error tone only when it reports one (a failing check, a conflict), never
  because it is a count.
- **Kind icon**: the board's Octicon glyph, 1 em of the text beside it, in the
  kind's hue (ticket, story, plan, sprint each one hue, AA contrast in both
  themes).
- **Status panel**: the state is a pill with a coloured dot and its word; the
  progress bar fills the panel's width so cards compare at a glance; the PR
  summary shows one dot per check state with its count, the words in the
  tooltip.
- **Footer**: the primary is a small solid button; secondaries are ghost
  buttons of the same height; a disabled control is an outline in the muted
  tone with a not-allowed cursor.
- **Every colour carries a word** beside it or in its accessible name.

The mapping names the kind icon and its accessible name per `identity.kind`;
`<Card>` draws it. It returns the emphasised section as the visual design above names it — and every word: summaries, reasons (*waits on
feature/x #3105*, *no fleet scan yet*, *linked from 2 stories*, *plans unread —
host throttled*), unknowns (*checks unknown*, *cost not measured here*) and alert
labels. **Every list with two or more entries collapses to a count and expands
in place** — lineage relations and the PR list alike. `<Card>` renders sections and
decides nothing; tab order is title, primary, secondaries, expanders; each
expander is a `<button aria-expanded>`. The action band renders every action as
a control; a disabled one is `aria-disabled`, focusable, and described by a
tooltip holding the mapping's reason. Every string from `CardFacts` renders as
text, never as HTML.

**Detail views.** Plans open `PlanModal`, stories `StoryModal`, and **tickets a
new `TicketModal`**: title, body read through the existing issue read, the
`lineage` relations as links, the action band, the source, author or approver, cost, and a link out to the host
issue. `StoryModal.renderMarkdown` (`StoryModal.tsx:14-31`) is fixed in the
Stories slice before the story title becomes its only way in: it escapes `"`
and admits `http(s)` link schemes only.

### Gates

- **Schema gate** — a domain test enumerating `CardFacts`' string fields against
  invariant 1's list.
- **Import gate** — `scripts/check-card-presentation.sh`: `card-presentation.ts`
  may import only from `@plot-pm/domain/entities/card-facts` and
  `packages/board/src/app/ui/`. Added to `ci.yml` and to the `Local checks` key,
  then `./scripts/check-agents-md.sh --write`.

### Done when

- **Tracer:** every plan card on the planning and delivery boards and in swimlanes
  renders through `<Card>` from `facts` in the three sections, and `planCardView`
  is gone. Type, rounds, spike state, verification, `not-pushed` and the PR list
  all still show on the card; the plan path, the approver and an unmeasured cost
  show in `PlanModal` instead. The status section opens with the plan's phase,
  shows slices done / total (never *progress unknown* when the pulse answered),
  and ends with the plan's assignees and a relative age whose exact date is in
  the tooltip; an approved plan still shows its assignee, not its approver. A
  spike merged with no `Spike approved:` record offers *Approve spike* as the
  primary and *Confirm slices* as a secondary. The card follows the visual
  design above in both themes. A plan in a sprint with a `Release:` shows `↻ <release>` in its meta line. The status panel and footer keep their lines aligned across cards: a card with no PRs has no empty signals line, and the assignee and age sit in the footer on every card.
  No plan card shows *not measured here* or *checks not asked* as a chip of its
  own; each shows as an unknown in its row. Every plan card leads with the plan
  kind icon from `KIND_ICON_PATH`, sized to the title text, with an accessible
  name, and its type as a tag; its sprint and story links carry the `iterations`
  and `book` glyphs at link-text size. The action band is
  visually separate, and no action renders as plain text. A disabled *Start
  work* is a focusable `aria-disabled` control whose reason appears on hover and
  on focus and is its `aria-describedby`. A fixture with a throttled host reads
  *checks unknown*, never zero. Both gates fail on a seeded violation. One
  browser test proves the section order, the tooltip on focus, and tab order
  through the action band including the disabled control.
- **Stories:** story *Nothing changed, nothing runs* links ticket #3170, and
  #3170 offers no *Create story*. A ticket whose plan names a story shows that
  story. The ⚠ reads as a labelled alert. An `issue:` to another repository
  shows `issue-link-unreadable` and is not indexed. *Add plan* on a live story
  reaches `/api/story-plan`, whose brief names the story. A fixture story with 62
  plans and 9 sprints renders collapsed at uniform height. `StoryModal` refuses
  a `javascript:` link. Every story card's status opens with its status and
  shows its `author:` as assignee.
- **Tickets:** #3102 links its plan and offers no *Create plan*. With plans
  unreadable, every ticket's *Create plan* is disabled with *plans unread*. A
  ticket in two stories gets a disabled *Create plan* naming both, and
  `POST /api/idea` for it refuses `linked-from-many-stories`. A ticket in one
  live story produces a brief carrying its slug above the issue body.
  `TicketModal` opens from the title. A ticket's issue type shows as a tag, and
  the ticket kind icon leads its title row. Every ticket's status opens with its
  tracker state (*state unknown* when the tracker did not answer) and shows its
  tracker assignees.


## Slices

### Tracer

- `feature/one-card-grammar-plans` — the `CardFacts` entity and its schema gate, `docs/domain/card-grammar.md`, `planCardFacts` replacing `planCardView`, plan `facts` in `/api/board`, the presentation mapping and its import gate, and the shared `<Card>` on the Plans board only → #3198 <!-- builds: CardFacts entity and planCardFacts projection --> <!-- spike -->

### Stories

- `feature/one-card-grammar-stories` — the story's `issue:` field and its validator (`jira:` read as legacy, the story-tracking template and `/api/story`'s brief writing it, `Tracker: jira` project keys), the ticket → story index from `origin/<default>`, `storyCardFacts`, `POST /api/story-plan` for *Add plan*, the `StoryModal` link fix, and the Stories lanes rendering through `<Card>` <!-- builds: storyCardFacts projection, the story issue field and the story-plan endpoint -->

### Tickets

- `feature/one-card-grammar-tickets` — `ticketCardFacts` in `discovery-lanes.ts` (moved out of the browser), `TicketPlan` gaining `slug`, `title` and `story`, `/api/idea`'s click-time story derivation and refusals, a new `TicketModal`, and the Tickets lanes rendering through `<Card>` <!-- builds: ticketCardFacts projection and TicketModal -->

The Tickets slice follows the Stories slice rather than running beside it: its
*a story, no plan* row needs the ticket → story index that Stories builds, and a
Tickets card that could not yet see stories would offer *Create story* on 3170
exactly as today.

## Notes

- 2026-11-06: The panel (round 5) returned a unanimous *amend*; the author chose
  to grow the plan rather than narrow the Spec, so the Spec now builds a
  `TicketModal` and a `POST /api/story-plan` endpoint, and addresses the six
  blocking findings and the should-fixes in `.plot/panels/2026-11-06-one-card-grammar/spec-panel.md`.
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
  "round": 5,
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
    },
    {
      "q": "Panel of four lenses on the Spec (operator, domain, implementer, security)",
      "a": "unanimous amend; six blocking findings in .plot/panels/2026-11-06-one-card-grammar/spec-panel.md",
      "category": "tradeOffs"
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
