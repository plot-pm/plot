Position: amend

Juror lens: implementer and code reviewer. The direction is sound and the wave order (Tracer, then Stories, then Tickets) is correct. The Spec is not yet buildable without decisions the implementer would have to make alone. Five of them touch the schema, so the gate would freeze whichever guess comes first.

## Findings

### 1. Decisions the Spec leaves open, by slice

**Tracer**
- **The `Reason` union cannot express the reasons Start work gives today.** `startRefusal` (`packages/board/src/app/components/StartWorkButton.tsx:59-67`) has three refusals. The first is the server's own `DispatchInfo.reason`, a free sentence (`packages/board/src/contract/schema.ts:1122-1126`). The second is *waiting for the first fleet scan*, which is really an `Unknown`. The third is *no branch is eligible*. None of the five `Reason` kinds covers these. Invariant 1 also forbids carrying the server sentence as a string. Invariant 3 requires a non-null reason whenever a primary is disabled, so the implementer would have to invent the reason vocabulary.
- **`waits-on` has no source.** No reading names what a plan waits on as a `Ref`. The nearest fact is `blockedBy`/`blockedNote`, which holds a slice name (`schema.ts:1995-2006`), and `Ref.kind` has no `slice`. The headline example, *waits on #3105*, has nothing to derive it from.
- **Facts the plan card shows today have no facet.** `PlanCard.tsx` reads `card.type`/`typeLabel`, `rounds`, `cost` (the *not measured here* line, `PlanCard.tsx:155-182`), `verification`, `notPushed`, spike state (`SPIKE_CARD_TEXT`) and the per-PR list (number, url, checks).
  - The Approach says `planCardView`'s type "feeds `identity`" (line 100), but the Spec's `identity` has no `type` field.
  - The Notes say this plan "changes their layout, not what they fixed", so the type badge cannot simply be dropped.
  - The in-card PR expander (Approach line 130) needs the list of PRs, but `progress.prs` holds only counts.
  - For each of these the Spec must say whether it is a facet field, stays a non-facts `Card` field, or is removed.
- **"That kind's old card fields are removed" does not say which fields.** `Card.sprint`, `story`, `prs`, `controls` and `title` are also read by `lib/filters.ts` (12 reads), `Swimlanes.tsx`, `PlanModal.tsx`, `agent-rows/menus.tsx` and `App.tsx`. The Spec should list exactly what goes. As far as I can tell that is only `typeLabel` and `owner`.
- **A plan's `changedAt` has no reading.** `Card` carries no date at all (`schema.ts`, the `Card` object around lines 470-620). Either it is `null` for plans, which breaks the rule "owner and age in the same row on every kind", or a read is added, which contradicts "no projection adds a read".
- **`presentCard(facts, board)` has no defined `board` type.** `BoardTab` is `'discovery' | 'planning' | 'delivery'` (`packages/domain/src/rules/board-tab.ts:2`). Tickets and Stories share `discovery`. Emphasis is effectively per kind, so either use `kind` or define the enum.
- **The import gate is not specified enough to build.** The Spec does not give the file path of `card-presentation.ts`, the allowlist behind "UI helpers", or whether `import type … from '@plot-pm/domain'` passes while value imports from it are refused.
- **`deliver` is in `ActionKind`, but `cardControls` has no deliver flag.** `DeliverButton` renders today only in `agent-rows/menus.tsx`. Putting it on the plan card is new behaviour with no stated condition.

**Stories**
- **`add-plan` has no endpoint and no slice builds one.** No route exists: grep finds no add-plan anywhere, and `POST /api/idea` takes an issue number. A story with no ticket cannot use that route. Sending a story slug from the browser contradicts "no slug a browser could forge reaches the idea agent's prompt". Yet the matrix makes *Add plan* a story card's primary action.
- **The tracker key format is undefined.** `Tracker` is configured as `jira <baseUrl>` (`packages/domain/src/adapters/tracker/tracker-resolve.ts`, `trackerFor`) and names no project key, so "a key matching its configured tracker" has nothing to match against.
- **`statusDrift` has callers the plan does not name.** `packages/board/src/server/entry/standing.ts:83` feeds `skills/plot/scripts/plot-story-lint.sh`, and `StoryModal.tsx:182-187` renders the phrase. The Spec must say whether the phrase stays for these callers or a typed sibling is added.

**Tickets**
- **"Every item opens to the board's own detail view" requires a ticket detail view that does not exist.** The board has only `PlanModal` and `StoryModal`. The ticket card links out to the host today (`StoriesTab.tsx:496`). The slice does not list building one.
- **`POST /api/idea` must read the ticket → story index at request time.** The Spec does not say whether that read is cached or fresh. `referencedIssues` (`packages/board/src/server/idea.ts:406`) shows the house pattern: a fresh read, and a refusal on null.

### 2. Spec claims contradicted by the code as it is today
- **"`CardFacts` is computed … where `planCardView` and `cardControls` run today (`board.ts`)" is wrong for tickets.** `ticketCardView` runs in the browser (`StoriesTab.tsx:488`, `useMemo(() => ticketCardView(ticket, lane, Date.now()))`). Ticket lanes are built in `server/discovery-lanes.ts:65` and called from `controllers/board-answer.ts:90`, not from `board.ts`. Ticket facts have to be attached in `ticketLanes`, and that includes its kept-lanes path (`packages/domain/src/rules/ticket-lanes.ts:186-191`).
- **"Absent relations omitted" in `lineage` conflicts with invariant 5.** `ticketLanes` returns `plansUnreadable: true` with *kept* lanes when the plans cannot be read (`ticket-lanes.ts:174-191`, `discovery-lanes.ts:61-80`). `lineage: Ref[]` has no `Unknown`. So under a failed plan read, a ticket would read as "no plan" and offer `create-plan`. That is exactly the throttled-host case the Approach rules out (lines 81-88).
- **The check vocabulary does not match the code.**
  - `byChecks` uses `running`, while the code says `pending`, and it omits `conflicts`: see `ChecksSchema` usage at `schema.ts:2823` and `host-shell.ts:75` (`green, pending, failing, none, unknown`).
  - `byChecks: Known<Record<…>>` makes the whole aggregate unknown or known. Four green PRs plus two `unknown` ones cannot be expressed without losing the four or zero-filling the two.
- **"Two rules return words from the domain today" (Approach line 111) undercounts.** `checks-reading.ts:216` (`label: 'checks not asked'`), `plan-spend.ts:138-144` and `slice-spend-record.ts:279` (*not measured here*) also produce card words. They are the very chips the Motivation calls noise.
- **The `issue:` field is already defined, and the plan does not say so.** `docs/stories/the-master-agent-holds-the-fleet/DESIGN-story.md:484` defines `issue:` as the inbound link, in key form (`PROJ-100`). That document is binding vocabulary under CLAUDE.md. The plan should cite it and reconcile the key form with the URL form `POST /api/story` would write.
- **The plan's own citations check out.** I confirmed `ticket-card.ts:87`, `card-controls.ts:62` (callers `board.ts:2687` and `mock-fleet.ts:498`; test fixtures also call it), `fleet.ts:1710`, `ticket-phase.ts:4`, `entities/story.ts:56`, `StoriesTab.tsx:556` and `transitions/story.ts:468`.
- **The `/api/board` readers are as the plan says.** `release-smoke.sh:227` reads only `cards`/`plans` length plus a regex over the JSON, so it is unaffected. `plot-ask.mjs board` emits the `Board` object, and I found no skill that reads its card fields.

### 3. Does each "Done when" prove its slice?
- **Tracer: no.**
  - It could pass with a disabled Start work that still gives no reason, which is the third motivating defect. Nothing in the criteria asserts `next.primary.reason`.
  - It could pass with *not measured here* / *checks not asked* still rendered as chips, which is the second defect.
  - Plan cards render in both `Board.tsx:283` and `Swimlanes.tsx:232`. "The Plans board renders through `<Card>`" could pass with the sprint swimlane view left on the old card.
- **Stories: partly.**
  - The criteria are phrased against live items (story 3170) rather than fixtures.
  - Nothing proves the `jira:` legacy read.
  - Nothing proves that `POST /api/story` writes `issue:`. Today that field is written by an LLM agent following a prompt (`server/story.ts:237`), so the criterion is a rule, not a gate. A testable form is "the story prompt names `issue: <url>`".
  - The server-side double-create race survives: `POST /api/story` has no precondition like `referencedIssues`.
- **Tickets: partly.**
  - "Produces a plan whose `Story:` names it" depends on the idea agent's behaviour. The writable test is that the idea brief carries the slug.
  - Two matrix rows go untested: the story-not-live fallback and the unread-plans case.

### 4. Changes before approval
- **blocking:** Extend `Reason` to cover today's refusals:
  - server-unavailable, as a typed kind (the endpoint's reason kind, not its sentence)
  - no pulse yet, as an `Unknown`
  - nothing eligible
  - and define `waits-on`'s subject: add `slice` to `Ref.kind`, or drop `waits-on` until a reading exists.
- **blocking:** Decide where each current plan-card fact goes: `type`, `rounds`, `cost`/spend, `verification`, `notPushed`, spike state, and the per-PR list (`progress.prs.items` or similar). Then list exactly which `Card` fields are removed.
- **blocking:** Let `lineage` carry "not read" per relation. One shape is `lineage: { plans: Known<Ref[]>; stories: Known<Ref[]>; … }`. Invariant 4 then becomes "offers `create-plan` only when plans were read and none names it".
- **blocking:** Decide `add-plan`: name its endpoint and the trust-boundary rule for it, or remove it from the matrix and from `ActionKind` for now.
- **blocking:** Add the ticket detail view to the Tickets slice, or state that a ticket opens to the host until one exists.
- **should:** Fix the check vocabulary (`pending`, `conflicts`), and use per-state counts that include `unknown` instead of `Known<Record>`.
- **should:** Say that ticket facts are computed in `ticketLanes`/`discovery-lanes.ts`, including on the kept-lanes path, and that the browser's `ticketCardView` call is what retires.
- **should:** Name `standing.ts`/`plot-story-lint.sh` and `StoryModal.tsx` as `statusDrift` callers, and say how the lint output is preserved.
- **should:** Specify the import gate:
  - the path of `card-presentation.ts` and its allowlist, including the `import type` rule
  - a `test/reconcile/card-presentation-gate.test.mjs`, per convention
  - the edits to `ci.yml` and to CLAUDE.md's `Local checks` (enforced by `test/reconcile/local-checks-coverage-gate.test.mjs`), plus `./scripts/check-agents-md.sh --write`
  - `check-shell-lines.sh` is unaffected: it counts only shell under `skills/`.
- **should:** Define a plan's `changedAt` source, or state `null` and relax the age rule for plans.
- **should:** Define tracker-key acceptance, given that `Tracker` carries no project key, and cite `DESIGN-story.md:484`.
- **should:** Rewrite the Done-when items as fixture-based assertions:
  - prompt contents, not agent output
  - a disabled primary carries a reason
  - no absent-as-content chip
  - both `Board.tsx` and `Swimlanes.tsx` render the new card
- **should:** Give `deliver` on the plan card a condition, or drop it, since `cardControls` has no flag for it.
- **could:** Add a server precondition to `POST /api/story`, refusing when a story already names the ticket, mirroring `referencedIssues`.
- **could:** Name the Delivery tab's ticket row (`IssueRowView`, `agent-rows/rows.tsx:2854`) as out of scope. Its words were aligned with the Discovery ticket card on purpose and will drift from the new one.
- **could:** Consider splitting the tracer, for example entity + gates + `planCardFacts` in one branch and `<Card>` + board wiring in another. As specified it is one large spike branch.

### 5. What I did not check, and the evidence I used
- **Evidence:** I read the plan in full, CLAUDE.md, `DESIGN-story.md` §issue, and the code cited above. I grepped every caller of the six retiring rules, plus `cardControls`, `statusDrift`, `ticketPlansOf` and `trackerKeyOf`. I grepped the `/api/board` readers (`release-smoke.sh`, `ask.ts`, the boardctl/estate scripts), the CI gate registration (`ci.yml`, `local-checks-coverage-gate.test.mjs`) and the scope of `check-shell-lines.sh`.
- **Not run:** I ran no tests and no build. I made no `gh` calls.
- **Not checked:**
  - whether Zod introspection in the domain's Zod version supports the schema gate's walk over unions and nullables (I believe it does, but did not try it)
  - how many of the 78 browser tests break when `PlanCard` is replaced
  - the internals of `CreatePlanButton`/`CreateStoryButton` beyond their `DispatchInfo` and `issueAnswer` props
  - `PlanModal`'s field reads in detail
  - how `mock-fleet.ts` builds its fixture cards beyond the `cardControls` call
