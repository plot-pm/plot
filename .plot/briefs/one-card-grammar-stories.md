## Implementation brief — one-card-grammar (wave 2: Stories)

- **Plan (canonical):** `docs/plans/2026-11-06-one-card-grammar.md` — read its `## Spec` and `### The ticket → story link`; this brief orients, the Spec decides
- **Approved:** 2026-11-07, jwloka, in-session (the whole plan; the Tracer's spike approval is spent)
- **Branch:** `feature/one-card-grammar-stories` (base: **`sprint/card-alignment`**, not `main`)
- **Ends as:** one PR into **`sprint/card-alignment`** — `plot-open-pr.sh --base sprint/card-alignment`. Sprint `card-alignment` is an integration branch: nothing of it reaches `main` until the sprint PR merges at sprint close. A PR against `main` is wrong.
- **Review of the code:** `plot/review` (required) plus CI `validate`.

The Tracer (`feature/one-card-grammar-plans`, #3198, with follow-ups #3212) is merged on the sprint branch, so `CardFacts`, `presentCard`, `<Card>` and both gates exist. The Tickets slice (`feature/one-card-grammar-tickets`) waits on this one: its *a story, no plan* row needs the ticket → story index built here, and without it a Tickets card offers *Create story* on 3170 exactly as today. A shape this slice gets wrong is paid for twice.

### What to build

Story cards on the Stories lanes render through the shared `<Card>` from a new `storyCardFacts`, and a story can name its ticket. Start from the observed failure: ticket 3170 offers *Create story* while its story *Nothing changed, nothing runs* sits in Draft, because nothing parses the link — the template writes `jira:`, the one story made from a ticket wrote `issue:`, and no code reads either. The story card's bare ⚠ is `statusDrift` shown as a hover `title` (`StoriesTab.tsx:556`), which carries no meaning on touch or at a glance.

Concretely, in the plan's order:

1. **`issue:` field and validator.** Parse `issue:` in story frontmatter (the read is the regex block at `board.ts:2059-2080`), `jira:` as legacy when `issue:` is absent, the template's unfilled `{JIRA_TICKET_URL}` as absent. Accepted values reduce to the issue key the ticket rows use (`issueKey`): this repository's own GitHub or Bitbucket issue URL or `#<n>` — owner **and** repository must match `origin` through the `host` adapter, the host alone is not enough — or a Jira key of a declared project. Anything else is an `issue-link-unreadable` alert, never indexed.
2. **Writers.** `skills/story-tracking/STORY-template.md` writes `issue:` (skill change, bumped in the changeset); the `POST /api/story` brief (`server/story.ts`, `handleStory`) instructs `issue: <issue URL>`. The test asserts the brief — an agent's output cannot be asserted.
3. **Ticket → story index** from `origin/<default>`, the way `ticketPlansOf` reads plans (`planMetasAtDefault`), never the working tree, so an uncommitted story cannot redirect a create. "Live" means `status` other than `done` and not archived; Draft is live.
4. **`storyCardFacts`** (`rules/`, replaces `storyCardView` in `rules/story-card.ts`, runs in the `board.ts` story read). `status-behind` alert from `derivedStanding`; `lineage` up to tickets, plans and sprints; `progress.work` as `unit: 'plans'`; `ownership.since` from `updated:`. `storyCardView`'s author feeds `ownership` and its tests move to the projection; no deprecated wrapper.
5. **`POST /api/story-plan`** `{slug}` for *Add plan*, with its allow-list entry beside `/api/idea` in `server/index.ts`.
6. **`StoryModal`**: `renderMarkdown` (`components/StoryModal.tsx:14`) escapes `"` and admits `http(s)` link schemes only; the modal reads `status-behind` through the mapping instead of `statusDrift`.
7. **Stories lanes through `<Card>`** with `progress` emphasised, the title as the only open link (the whole-card button goes), collapsed lists with expanders.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

- **`issue:` is the field, not `jira:`.** It is what was actually written, the name plans already use, neutral between a GitHub URL and a Jira key, and `DESIGN-story.md:484` already specifies it (inbound ticket; `published:` is the outbound one and out of scope). `trackerKeyOf(slug)` (`entities/story.ts:56`) stays: it reads a Jira key from a slug prefix, cannot match a GitHub number, and has no caller — do not wire it in as the link.
- **Repository identity, not host.** A story whose `issue:` names another repository on the same host is `issue-link-unreadable` and not indexed. Host-only matching would let any committed story attach itself to any ticket, and the index decides which plan agent gets which brief. The security panel's finding; `.plot/panels/2026-11-06-one-card-grammar/spec-security.md` holds it.
- **The index is built from `origin/<default>`, and an index that could not be built is not "no story".** It answers unknown (`Known` → `{unknown: …}`), never `{value: []}`. A ticket with two or more live stories gets `linked-from-many-stories`, not a guess.
- **`/api/story-plan` takes a slug and nothing else, and builds the brief from the story's committed file.** The slug must match `^[a-z0-9-]+$` and name a live story on `origin/<default>`, else `unknown-story`; `unattended` like its siblings. Nothing from the body reaches `sh -c`; same spawn path as `/api/idea`. The created plan carries `Story: <slug>`.
- **`statusDrift` keeps its phrase** for its non-board caller (`standing.ts:83` → `plot-story-lint.sh`). The board stops calling it; `status-behind` is a typed alert and the label is the mapping's word. Do not delete `statusDrift`.
- **`StoryCard.statusDrift` leaves `/api/board` only when its last reader converts** — `StoriesTab` and `StoryModal` are both in this slice, so it goes here. Check `mock-fleet.ts` (emits facts through the same projection), `release-smoke.sh` and `plot-ask.mjs board` before removing any field.
- **Carried over from the Tracer, unchanged:** `CardFacts` holds no generated string (the schema gate refuses one — do not widen its allow-list); `Known<T>` uses `HostReach`, no new unknown vocabulary; `reason` non-null exactly when `enabled` is false; absent is not false; read the exit code, not the emptiness; domain code is arrow functions with factual TSDoc.
- **`Tracker: jira` project list — check before adding.** The plan says `Tracker: jira` gains an optional project list. The Jira adapter already reads a declared project list from `## Plot Config`'s `Ticket prefixes`, at one place (`adapters/tracker/tracker-jira.ts:133`, "THE ONE READ"). A second declaration of the same fact is the thing to avoid. Read that site first; if reusing `Ticket prefixes` meets the plan's *Done when*, report the divergence in the PR body and use it. Do not add a second list without saying so.

### Done when

The plan's `### Done when → Stories` is the specification:

- Story *Nothing changed, nothing runs* links ticket #3170, and #3170 offers no *Create story*. *(The second half is the Tickets slice's rendering; here, assert the index maps 3170 to that story and that `storyCardFacts` carries the ticket in `lineage.tickets`.)*
- A ticket whose plan names a story shows that story (index union, invariant 5: `issue:` **and** the `Story:` field of the ticket's plans).
- The ⚠ reads as a labelled alert.
- An `issue:` to another repository shows `issue-link-unreadable` and is not indexed.
- *Add plan* on a live story reaches `/api/story-plan`, whose brief names the story.
- A fixture story with 62 plans and 9 sprints renders collapsed at uniform height.
- `StoryModal` refuses a `javascript:` link.

Assertions that exist because a naive implementation passes without them:

- **A same-host, other-repository `issue:` is not indexed.** Catches host-only matching. Seed it with the real repository's host.
- **An index read that fails yields `unknown`, not `[]`.** Catches an empty catch turning a throttled host into *no story*.
- **A working-tree-only story does not enter the index.** Catches reading the checkout instead of `origin/<default>`.
- **`/api/story-plan` with a done or archived slug refuses `unknown-story`; with `../x` or a body-supplied brief it refuses or ignores it.** Catches a brief built from the request.
- **The story agent's brief names `issue:`, and the template writes `issue:`.** Catches the `jira:` drift that caused 3170.
- **`javascript:` and a `"`-bearing URL both render inert in `StoryModal`.** Catches the scheme check without the escape, or the reverse.
- **Seeded-violation proof still holds:** the schema gate and `check-card-presentation.sh` fail on a free-text field and on a reading import, and pass on the branch.
- **One browser test** proves the Stories lanes render what the mapping returned (rows, tab order: title, primary, secondaries, expanders, `<button aria-expanded>`), and that clicking the card body opens nothing.

Plus the repo's gates: a changeset for `@plot-pm/board` (description first, `plan: docs/plans/2026-11-06-one-card-grammar.md` in the trailing block) and `skills/story-tracking` in its `bumps:` block for the template change. Do not commit a generated bundle (`check-no-bundle-diff.sh`). For tests: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the `CI suites` run in CI and a failure comes back as a correction. Do not run `test:e2e` locally.

The shell gate: `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches no `.sh` under `skills/` by design; the `issue:` rule belongs in the domain, so `plot-story-lint.sh` stays as it is. If you find it must change, growth is paid for in the same change — remove shell elsewhere, or ask the domain through a bundle. The gate counts commands, not lines, and has no override.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh --base sprint/card-alignment` (`--draft` while moving) — never `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` — on `sprint/card-alignment`.

### Scope guard

This branch owns: `entities/story.ts` (the `issue:` field and validator), `rules/story-card.ts` and a new `rules/story-card-facts.ts`, the ticket → story index (new, beside `ticketPlansOf` in `server/`), the story read and `facts` in `server/board.ts`, `server/story.ts`, the new `/api/story-plan` handler and its entry in `server/index.ts`, `mock-fleet.ts` story facts, `components/StoriesTab.tsx` (story half), `components/StoryModal.tsx`, `skills/story-tracking/STORY-template.md`, `docs/domain/card-grammar.md` (story vocabulary only), and the story fixtures in `test/fixtures/card-facts.ts`.

Not this branch: ticket cards and `TicketRowView`, `ticketCardView*`, `discovery-lanes.ts`, `TicketPlan`'s new fields, `/api/idea`'s story derivation and refusals, `TicketModal` — all Tickets, which has no branch yet. Not the plan card, `PlanModal` or `Swimlanes.tsx`: the Tracer converted them. Other work in flight: the sprint `follow-ups-2-30-1` lands on `main` and may touch `packages/board`; merge `origin/main` into `sprint/card-alignment` (not into this branch) when it does.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
