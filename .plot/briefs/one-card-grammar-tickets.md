## Implementation brief — one-card-grammar (wave 3: Tickets)

- **Plan (canonical):** docs/plans/2026-11-06-one-card-grammar.md on main
- **Approved:** 2026-11-07, jwloka, in-session
- **Branch:** `feature/one-card-grammar-tickets` (base: `sprint/card-alignment`, the sprint's integration branch — not `main`)
- **Ends as:** one PR to `sprint/card-alignment`, opened with `skills/plot/scripts/plot-open-pr.sh --base sprint/card-alignment`
- **Review of the code:** `node skills/plot/scripts/board/plot-review.mjs <pr>`; no HIGH finding may remain

This is the last wave. The Tracer (#3198, #3212) and Stories (#3216) are merged into `sprint/card-alignment`; nothing waits on this slice except the sprint PR #3204.

### What to build

Ticket #3102 offers *Create plan* while its plan sits in Development, and #3170 offered *Create story* while its story existed. `ticketCardShowsActions` (`packages/domain/src/rules/ticket-card.ts:87`) answers from the lane alone and never asks whether a plan or story already answers the ticket. The ticket card also runs in the browser (`StoriesTab.tsx:476`, `ticketCardView`) and shares no layout with the plan and story cards the earlier waves converted.

Build, on top of what waves 1 and 2 shipped (`CardFacts`, `presentCard` in `packages/board/src/app/lib/card-presentation.ts`, `<Card>`, `Known<T>`, `ticketStoryIndex`, `ticketStoriesOf` and `Board.ticketStories`):

- `TicketPlan` (`rules/ticket-phase.ts`) gains `slug`, `title` and `story`; `ticketPlansOf` (`server/fleet.ts:1710`) stops dropping the plan's identity. `ticketPhase` keeps its `label` until this slice touches it, then the label moves to the mapping (the unit is the function).
- `ticketCardFacts` in the domain, computed server-side in `discovery-lanes.ts` beside `ticketLanes`, so the card rule leaves the browser. It reads the ticket row, the `TicketPlan`s, the ticket → story index Stories built, and `plansUnreadable`. `/api/board` carries `facts` on each ticket; the old ticket-card fields go in this slice once no reader reads them.
- `POST /api/idea` (`server/idea.ts`, `handleIdea`) re-derives the ticket's stories from `origin/<default>` at click time and refuses by name, exactly as the card rendered it: `stories-unread`, `linked-from-many-stories` (naming them). One live story puts its slug in the brief, on a line above the quoted issue body; a done or archived story, or none, creates the plan outside any story and the response says which. `IdeaRefusal` gains the two names; `composeIdeaPrompt` gains the slug line.
- A new `TicketModal`: title, the body through the existing issue read, `lineage` as links, the action row, a link out to the host issue. The ticket title becomes the card's only open link.
- The Tickets lanes render through `<Card>`, and the `⋯` menu's *Create plan* (`lib/agent-rows/menus.tsx:1725`) follows the same facts.
- `ticketCardView`, `ticketCardShowsActions`, `ticketCardSubtitle` and `ticketCardAge` retire with their last caller; their tests move to `ticketCardFacts` and the mapping. No deprecated wrapper. `ticketCardIssueRow` stays while `CreatePlanButton` and `CreateStoryButton` read it. `mock-fleet.ts` emits ticket facts through the same projection, and `release-smoke.sh` and `plot-ask.mjs board` keep reading whatever `/api/board` still sends.

### Settled decisions — do not re-derive

- **`lineage` decides which create is offered.** The plan's table is the specification: bare → *Create plan* primary, *Create story* secondary; live story, no plan → *Create plan* inside that story; two or more stories → disabled *Create plan*, reason `linked-from-many-stories` naming them; only a done or archived story → *Create plan* outside any story, saying why; a plan, no story → *Create story* only; a plan and a story → none; done lane → none. The 3102 defect is ruled out by this shape, not by a check added beside it.
- **Absent is not unknown.** `plansUnreadable` or a failed story read gives `unknown`, and `{ value: [] }` only for a read that found none. With plans unread, every ticket's *Create plan* is disabled with `lineage-unknown` (*plans unread*) — never enabled, never hidden. An index that could not be built refuses at the endpoint rather than reading as *no story* (a throttled host once read as no PRs and refused four merged plans).
- **Invariant 5 holds.** A ticket's `lineage.stories` is the union of stories whose `issue:` names it and stories named by the `Story:` field of a plan in its `lineage.plans`. Stories already builds that union in `ticketStoryIndex`; read it, do not recompute it.
- **The request names, the server derives.** `/api/idea` still takes `{number, type}` and nothing else. The story slug comes from `origin/<default>` and enters the brief only after it matches `^[a-z0-9-]+$` and names an existing story (`STORY_SLUG_PATTERN`, `storyIsLive` in `rules/story-issue.ts`). A browser cannot forge a slug into the idea agent's prompt.
- **Facts in the domain, words in the mapping.** `ticketCardSubtitle` and `ticketCardAge` strings move to `card-presentation.ts`; `CardFacts` holds `ownership.since` (`opened`, from `createdAt`) as an ISO date. The schema gate refuses any other generated string field, and `scripts/check-card-presentation.sh` refuses an import there other than `CardFacts` types and UI helpers.
- **Ticket `progress.work`:** no plan — `null`; one plan — that plan's slices; two or more — `unit: 'plans'`, `done` counting Delivered or Released. Emphasis on the Tickets board is `lineage`.
- **One card, one open link.** The title is the only open link; no whole-card click, no separate *Open* word. Every string from `CardFacts` renders as text, never as HTML.
- **Carried over unchanged:** the index reads `origin/<default>`, never the working tree; a disabled secondary is omitted; `reason` is non-null exactly when `enabled` is false.

### Done when

The plan's Tickets line under `## Done when` is the specification. Assertions a naive implementation would pass without:

- #3102 links its plan and offers no *Create plan* — a fixture with a plan named in `Issue:` but a ticket in the `open` lane catches the lane-only rule.
- With `plansUnreadable`, every ticket's *Create plan* is disabled with *plans unread* — an implementation that treats unread as an empty list enables it.
- A ticket in two stories gets a disabled *Create plan* naming both, and `POST /api/idea` for it refuses `linked-from-many-stories` — the endpoint test must not trust the card, since the request carries only the number.
- A ticket in one live story produces a brief whose slug line sits above the issue body — an issue body containing a story slug or instruction must not move it.
- A ticket whose only story is done or archived creates a plan outside any story and the response says so.
- `TicketModal` opens from the title and renders an issue body with `javascript:` text as text.
- `ticketCardFacts` for a ticket in the `done` lane offers nothing, and a fixture with a throttled host reads *unknown*, never zero.

Plus: a changeset (`'@plot-pm/board': minor`; the write-up names the *Create plan* fix and the new `TicketModal`), no generated bundle in the diff. Before each push, commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints; the `CI suites` run in CI and a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses shell growth under `skills/`; this slice adds no shell. Run the browser tests that name `discovery-ticket-card` only when the board is not open on this machine.

### Bookkeeping

Append `→ #<number>` to this branch's line in `## Slices` once the PR exists. Push the first real commit as soon as it exists.

### Scope guard

Owns: `packages/domain/src/rules/ticket-card*.ts`, `ticket-phase.ts`, `packages/board/src/server/discovery-lanes.ts`, the `ticketPlansOf` change in `server/fleet.ts`, the ticket branch of `server/idea.ts`, `StoriesTab.tsx`'s ticket lanes, a new `TicketModal.tsx`, `lib/agent-rows/menus.tsx`'s *Create plan* entry, and `mock-fleet.ts`'s ticket rows. The story lanes, `story-plan.ts`, `story-issue.ts` and `StoryModal.tsx` belong to the merged Stories slice: read them, change none. No other branch of this plan is in flight.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
