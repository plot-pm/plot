## Implementation brief — one-card-grammar (wave 2: Stories)

- **Plan (canonical):** docs/plans/2026-11-06-one-card-grammar.md on main (the full amended Spec is identical on `sprint/card-alignment`)
- **Approved:** 2026-11-07, jwloka, in-session
- **Branch:** `feature/one-card-grammar-stories` (base: `sprint/card-alignment`, the sprint's integration branch — not `main`)
- **Ends as:** one PR to `sprint/card-alignment`, opened with `skills/plot/scripts/plot-open-pr.sh --base sprint/card-alignment`
- **Review of the code:** `node skills/plot/scripts/board/plot-review.mjs <pr>`; no HIGH finding may remain

The Tracer slice (#3198) and its follow-ups (#3212) are merged into `sprint/card-alignment`. The Tickets slice waits on this one: its *a story, no plan* row reads the ticket → story index this slice builds.

### What to build

The story card on the Discovery board reads differently from the plan card: no ticket number, an unlabelled ⚠ that carries its meaning only in a hover `title`, a whole-card `<button>` with a nested sprint link, and no action. Ticket #3170 offers *Create story* while its story *Nothing changed, nothing runs* exists, because nothing parses the `issue:` the story wrote.

Build, on top of what the Tracer shipped (`CardFacts`, `presentCard`, `<Card>`, `linkTargetOf`):

- `issue:` in story frontmatter, parsed and validated (`jira:` read as legacy, `{JIRA_TICKET_URL}` read as absent); accepted only for this repository's own issues or a declared Jira project (`Tracker: jira <url> PROJ, OPS`); anything else is an `issue-link-unreadable` alert and never indexed.
- The ticket → story index from `origin/<default>` stories only, plus stories named by a plan's `Story:` where the plan answers the ticket (invariant 5).
- `storyCardFacts` in the domain, computed in the `board.ts` build; `storyCardView` retires with its last caller.
- `POST /api/story-plan {slug}` for *Add plan*; `/api/story`'s brief and the story-tracking template write `issue:`.
- `StoryModal`'s `renderMarkdown` escapes `"` and admits only `http(s)` links; it reads the status alert through the mapping.
- The Stories lanes render through `<Card>`.
- Two Tracer defects: the `⋯` menu focuses its first enabled item and its reason tooltip covers no sibling; the progress bar is correct above 24 slices.

### Settled decisions — do not re-derive

- **Facts in the domain, words in the mapping.** `statusDrift`'s phrase stays for `plot-story-lint.sh`; the board emits `status-behind` with the proven standing and `card-presentation.ts` words it. `check-card-presentation.sh` refuses any other import there.
- **Absent is not unknown.** A story read that failed gives `unknown`; `{ value: [] }` only for a read that found none. An index that could not be built refuses rather than reading as *no story*.
- **The index reads the ref, never the working tree**, so an uncommitted story cannot redirect a create.
- **The request names, the server derives.** `/api/story-plan` takes only a slug matching `^[a-z0-9-]+$` that names a live story on `origin/<default>`; the brief is built from that committed file, never from the request body.
- **One card, one open link.** The title is the only open link; no whole-card button.

### Done when

The plan's Stories line under `## Done when` is the specification. Assertions a naive implementation would pass without:

- An `issue:` naming another repository's issue shows the alert and is absent from the index — a host-only check would accept it.
- A story with 62 plans and 9 sprints renders each relation as one count — rendering the list would make the card as tall as the list.
- `javascript:` in a story's objective or design renders as text, not a link.
- *Add plan* sends the slug only; a slug naming a done or archived story is refused.

Plus: a changeset (`'@plot-pm/board': minor`, `story-tracking` bumped), no generated bundle in the diff. Before each push, commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints; the `CI suites` run in CI. `scripts/check-shell-lines.sh` refuses shell growth under `skills/`; this slice adds no shell.

### Bookkeeping

Append `→ #<number>` to this branch's line in `## Slices` once the PR exists. Push the first real commit as soon as it exists.

### Scope guard

Owns: `packages/domain/src/rules/story-card*.ts`, `story-issue*.ts`, `packages/board/src/server/story*.ts`, `StoriesTab.tsx`'s story lanes, `StoryModal.tsx`, `skills/story-tracking/` template. `ticketCardFacts`, `TicketModal` and the ticket lanes belong to `feature/one-card-grammar-tickets`; this slice only exposes the index they read.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
