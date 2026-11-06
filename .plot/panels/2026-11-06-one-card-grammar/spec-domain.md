Position: amend

Lens: domain-model purist. The split is right: facts in the domain, words in the mapping, enforced by gates. But the `CardFacts` types in the Spec cannot hold three rows of the plan's own table. They also rename two vocabularies the domain already has. Both problems are in the type, which is what gets built first, so they need fixing before approval.

## Findings

### 1. Decisions a slice cannot be built without

**Tracer**
- **The `next` type cannot hold a card with secondary actions and no primary.** Spec line 334 types `next` as `null | { primary: {...}; secondary }`, so `primary` is required. Three rows of the Approach table (lines 160, 164, 165) need secondaries with no primary:
  - a ticket with a plan and no story: no primary, *Create story* as secondary;
  - a story with plans and no lifecycle action: *Add plan* as secondary;
  - a plan with no lifecycle action: *Interrogate* where the phase allows it.

  Either `primary` becomes nullable, or the plan decides that a secondary is promoted to primary. Invariant 3 (line 364) also has to say how it reads a missing primary.
- **Where do `roundsBadge` and `spikeState` go?** Today the plan card reads both (`PlanCard.tsx:223-224`; `card-controls.ts:18`). The Spec says three things that cannot all hold:
  - the plan kind's old card fields are removed in the tracer (line 397-398);
  - `card-presentation.ts` may import only `CardFacts` types (line 392);
  - `CardFacts` has no rounds fact and no spike-state fact.

  The Open Questions answer (line 302) says the secondary flags "stay available to the UI", which contradicts the import gate. The plan must decide: either `controls` stays on `/api/board`, or the rounds count and the spike standing become typed facts.
- **`ActionKind` (line 352) does not cover what `cardControls` offers.**
  - `needsDesign` (`card-controls.ts:9`) has no kind, although the `needs-design` endpoint exists.
  - `dispatch` and `readyToStart` both collapse into `start-work`, with no rule for which one the card means.
  - `deliver` has no `cardControls` flag, so its source is unnamed (presumably `PlanStatus` `deliverable`, `rules/phase.ts:22-23`). The `planCardFacts` row lists `cardControls` as an input but not `status`.
- **`Reason` does not match the Open Questions.** The union has no `unapproved`, although line 302 names it. `started` is not a reason a primary is disabled: once a plan has started, *Start work* is no longer the next action.

**Stories**
- **"Live story" is undefined.** `StoryStatus` is `draft | ready | active | in-review | paused | done`, and `StoryStanding` adds `archived` (`entities/story.ts:15`, `transitions/story.ts:36`). The plan excludes only done and archived. It does not say whether `paused` is live. The Done-when depends on `draft` being live, because story 3170 is in Draft (line 274).
- **The `Story` entity needs a declared field shape.** The Spec says nothing about how `Story` (`entities/story.ts:28-45`) gains the parsed issue. It needs something like `issue: IssueRef | null` plus the unreadable value. The parser needs the host and tracker config passed in as values, since the domain takes readings as values. Neither is stated.
- **`statusDrift`'s phrase has a second, shell caller the plan never names.** `entry/standing.ts:83`, through `plot-standing.mjs`, prints `statusDrift`'s phrase into `plot-story-lint.sh:174-176` (finding S5). If the phrase moves into the board's mapping, the lint loses its words. By the plan's own second-UI test, two presentations share this phrase. The plan must decide: keep a typed drift fact in the domain with the lint mapping its own words, or keep the phrase for the lint.
- **The story lifecycle action has no `ActionKind`.** The table row "its lifecycle action, if any" (line 164) needs one. `setStoryStatus` and `archiveStory` exist (`transitions/story.ts:227`, `:324`), but no kind names them.

**Tickets**
- **`ticketCardFacts` cannot be computed where the Spec says.** Line 198 places all `CardFacts` in the `board.ts` build. But tickets are `null` in that walker and are filled in by `index.ts` at response time (`board.ts:2938-2954`). The old ticket rule runs in the browser (`StoriesTab.tsx:488`). Ticket facts need stories from `board.ts`, plans from `fleet.ts`'s `ticketPlansOf`, and the ticket rows, all together. The Spec should name `index.ts`, or wherever `discoveryLanes` assembles them.
- **`ownership.changedAt` has no source for tickets.** A ticket row carries only `createdAt` (`rules/ticket-lanes.ts:11`), and today's card shows "opened 10h ago". "Last change" is either a new read, which contradicts "no projection adds a read" (line 201), or it means created-at. Plans likewise have no last-change reading named.
- **Plans in `rejected` or `superseded` state are not decided.** `allFinished` already ignores them (`ticket-phase.ts:71-72`). Invariant 4 (line 365) says any plan naming the ticket withdraws *Create plan*, so a ticket whose only plan was rejected could never get a new one.
- **The `Unknown` reason has no input to come from.** `TicketPlan.merged` is a bare `null` (`ticket-phase.ts:10`) and carries no reason. The projection cannot choose between `throttled`, `not-asked` and `unreadable` unless its input carries one.

### 2. Where the Spec contradicts today's code
- **Check states.** `prs.byChecks` uses `green | running | failing | none` (line 332). The domain already has `ChecksSchema = ['green','pending','failing','none','unknown']` (`entities/pr.ts:32`), and `PrIndexRow.ciChecks` uses the same values (`entities/pr-index.ts:153`).
  - Renaming `pending` to `running` breaks the binding-vocabulary rule; *running* is a word, not a fact.
  - Wrapping the whole record in `Known<...>` cannot express "5 green, 1 unknown". A row-level `unknown` must then either collapse the whole count or be dropped. That breaks invariant 5, the invariant the plan itself puts first.
- **A third vocabulary for missing answers.** `Unknown`'s reasons (`throttled | not-asked | unreadable`, line 315) duplicate `HostReach = 'ok' | 'unasked' | 'throttled' | 'secondary' | 'failed'` (`rules/branch-state.ts:34`). `pr-index.ts:96` already has `checksLookup: 'skipped' | 'broken'`. The Spec should reuse `HostReach`, or say why it does not.
- **`identity.number: number | null` (line 322) does not fit Jira.** Ticket ids are strings: `ticketCardShorthand` returns `PROJ-12` verbatim (`ticket-card.ts:26`). On a Jira tracker every ticket would get `number: null`, and the rule "the same number links across kinds" (line 196) silently fails. The repo is project-agnostic and has a `Tracker` connector, so the field should hold the issue key as a string.
- **The Spec's line citations are accurate:**
  - `ticket-card.ts:87`, `fleet.ts:1710`, `card-controls.ts:62`, `story.ts:56`, `statusDrift` at `transitions/story.ts:468` and `StoriesTab.tsx:556` all match.
  - `cardControls` has three callers, not the two line 296 states: `board.ts:2687`, `mock-fleet.ts:498`, and a test fixture at `board/test/fixtures/card-controls.ts:48`. The third is a test fixture, so the difference is minor.

### 3. Does each "Done when" prove its slice?
- **Tracer: no.** It proves the plumbing: `<Card>` renders `facts`, `planCardView` is gone, both gates trip on a seeded violation, and one browser test passes. It does not name either Plans-board defect from Motivation:
  - absence rendered as content (`no story`, `not measured here`, `checks not asked`);
  - a disabled *Start work* with no reason.

  The tracer could pass with both defects still present. It should state: an absent story renders nothing; an unknown check renders "checks unknown", never 0; a disabled primary carries a typed `Reason`.
- **Stories: mostly.** It proves the `issue:` link and the labelled alert. It does not prove the `jira:` legacy read, or that a story in a non-live status is excluded from the index.
- **Tickets: yes, for its named defect.** It proves the 3102 and multi-story cases. It does not cover the "only a done or archived story" row or the done lane.
- **None of the three tests invariant 5 (throttled host reads as unknown).** That is the invariant most likely to regress.
- **Several criteria name live estate items** (3102, 3170). They should also exist as fixtures in the projection tests, so the proof survives after those items change state.

### 4. What I would change before approval
- **blocking:** Let `next` hold secondaries with no primary, or state the promotion rule. Make the table rows at lines 160, 164 and 165 typeable, and fix invariant 3 to match.
- **blocking:** Use `ChecksSchema`'s values in `byChecks`, including `pending` and an `unknown` bucket, and drop the whole-record `Known` wrapper. Per-row unknowns become a count, so invariant 5 holds at row level.
- **blocking:** Decide where `roundsBadge` and `spikeState` live, given that the old fields are removed and the import gate allows only `CardFacts`. Either add typed facts, such as `identity.rounds` and a spike standing, or keep `controls` on the wire and widen the gate.
- **should:**
  - Complete `ActionKind`: add `needs-design`, the story status/archive action, and a declared mapping from `dispatch`/`readyToStart` to `start-work`.
  - Align `Reason` with the Open Questions: add `unapproved`, and reconsider `started`.
- **should:** Make `Ref` a union discriminated by `kind`, with `phase` typed per kind: `PlanStatus`, `StoryStanding`, `TicketLane`, and the sprint state. A free `phase: string` is a hole in the schema gate (invariant 1 whitelists `phase`), the one field a sentence could ride in on.
- **should:** Reuse `HostReach`, or declare the `Unknown` vocabulary in `docs/domain/card-grammar.md` with its mapping from `HostReach` and `checksLookup`. Say which input carries the reason.
- **should:**
  - Make `identity.number` the issue key as a string, so Jira estates link across kinds.
  - Define "live story" over `StoryStanding`.
- **should:** Name `plot-standing.mjs` / `plot-story-lint.sh` as a `statusDrift` caller, and decide how it survives the phrase's move.
- **should:**
  - Name where ticket facts are computed (`index.ts` / `discoveryLanes`, not the `board.ts` walker).
  - Define `ownership.changedAt` per kind from readings already held. For tickets that is `createdAt`, so the field should be called something other than "changed".
- **should:** Add the two Plans-board defects and a throttled-host case to the tracer's Done-when.
- **could:**
  - `identity.opens: Ref` repeats `kind`, `id` and `title` from `identity`. A boolean, or nothing ("every item opens to its detail view"), would do.
  - Decide whether `TicketPlan` should carry `state` as `PlanStatus` rather than `string` while gaining `slug` and `title`.
  - Say whether rejected or superseded plans count in invariant 4.

### 5. What I did not check, and what I used
- **Read:** the whole plan; `CLAUDE.md`; and these files in `packages/domain/src`:
  - `rules/ticket-phase.ts`, `rules/ticket-card.ts`, `rules/plan-card.ts`, `rules/story-card.ts`, `rules/card-controls.ts`, `rules/phase.ts:15-30`, `rules/branch-state.ts:28-40`;
  - `entities/story.ts`, `entities/pr.ts`, `entities/pr-index.ts` (via grep);
  - `transitions/story.ts`, mainly the export lines.
- **Grepped for callers:** `board.ts:2285-2310` and `:2925-2954`, `StoriesTab.tsx:488` and `:550-560`, `PlanCard.tsx:213-236`, `entry/standing.ts:60-90`, `plot-story-lint.sh:96-176`, and the `fleet.ts` `ticketPlansOf` and `ticketLaneData` call sites.
- **Ran nothing:** no tests and no typecheck. Every claim above comes from reading code.
- **Not checked:**
  - `POST /api/idea` and `POST /api/story` handlers, the idea agent's brief, or the `CreatePlanButton.tsx` trust contract;
  - `mock-fleet.ts` beyond its `cardControls` call, `release-smoke.sh`, or `plot-ask.mjs board`'s field use;
  - the sprint entity's state enum (relevant to a typed `Ref.phase`);
  - the accessibility and visual-emphasis claims.
