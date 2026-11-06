Position: amend

## Findings

Lens: security and trust boundary. Overall the plan keeps the existing boundary sound: no new shell interpolation, no new browser input, and `CardFacts` strings reach the browser as React text. The gaps are in the one new trust decision it adds, the ticket → story link. The Spec names the rule that guards it and leaves the rule's parts undefined, and it does not say what `POST /api/idea` does when that rule gives no single answer.

### 1. Decisions the Spec leaves open

- **Tracer:** buildable from the Spec. No trust-relevant decision is open. (Outside my lens: `identity.opens` for a *ticket* resolves to "the board's own detail view", and no ticket detail route exists today. Grep for `/ticket/` and `/issue/` routes in `packages/board/src` finds none. Today a ticket title opens the host URL in a new tab (`app/components/StoriesTab.tsx:495`). This becomes a decision in Tickets, not in the Tracer.)
- **Stories — what "this repository" means to the `issue:` validator.** Spec §Endpoints says "an issue URL on this repository's git host". Approach l.235 says "this repository's configured git host". Both read as *host* (github.com), while the threat named in the Approach and in Done-when is a link to *another repository*. Open decisions:
  - whether owner/repo must match, and where the board learns it (the git remote? `fleet.ts:482` treats `git remote get-url origin` as a per-row spawn to avoid);
  - case folding;
  - which URL shapes are accepted (`/issues/N` only, or `/pull/N` too; `http`; `www.`; a `#fragment` or `?query`);
  - look-alike hosts and paths (`github.com.evil/…`, `plot-pm/plot-fork`);
  - whether the plan convention `#3170` or a bare `3170` is accepted.
- **Stories — what "a key of its configured tracker" means.** `Tracker` holds only a scheme word. `plot-plan-meta.sh:376-384` reads its first token to turn the `LETTERS-digits` form on for `jira|linear`, and carries no project key. So nothing in config can reject `OTHER-12` from a foreign Jira project. The guarantee the Approach gives ("a stray cross-repository link cannot attach a story to the wrong ticket") cannot hold for the tracker case as specified. Either add a project-key source or state the limit.
- **Stories — the key form.** The index key that ticket rows, plan `Issue:` values (`#N`, or a Jira key) and story `issue:` URLs normalise to is unspecified. The index is useless unless all three reduce to one form.
- **Stories — what reads as absent.** The template's unfilled placeholder (`skills/story-tracking/STORY-template.md:4`, `jira: {JIRA_TICKET_URL}`) must read as absent, the way `plot-plan-meta.sh` does with `strip_placeholder` (`:640`). The Spec does not say so, and without it every story copied from the template shows an `issue-link-unreadable` alert.
- **Stories — which story source feeds the index.** `collectStories` reads stories from the ref and also from the working tree (`board.ts:2225-2262`). Ticket → plan is deliberately read from `origin/<default>` plus open drafts (`fleet.ts:1543-1580`). An uncommitted, unreviewed story in the board's checkout, written by any local agent, could then redirect or disable *Create plan* for a ticket. Decide whether the index is built from the same ref the plans come from.
- **Stories — how `POST /api/story` makes the story carry `issue:`.** The server writes no story. An agent does, from `composeStoryPrompt` (`story.ts:228-286`), whose prompt names no `issue:` field today. Decide:
  - that the prompt carries the host-returned `issue.url`;
  - that the URL passes the same validator before it enters the prompt (a transferred issue returns a foreign URL);
  - what happens when it fails the validator.
- **Tickets — what `POST /api/idea` does at click time** for each answer the index can give. The Spec covers only "exactly one live story → brief carries slug". It is silent on:
  - zero stories;
  - two or more stories, which can appear between render and click;
  - a story that went `done` between render and click;
  - an index that could not be built.

  Silence there implies a fallback to "plan outside any story". That is a person's click on *Create plan, inside story X* producing something else. It also contradicts the plan's own invariant 5 and "the index never says no": a failed read must refuse, as `referencedIssues` does at `idea.ts:403-416` and `idea.ts:~527-540`, never act as "no story". This needs named `IdeaRefusal`s (e.g. `linked-from-many-stories`, `story-index-unreadable`).
- **Tickets — the shape of the slug before it enters the brief.** Story slugs come from filenames via `/^STORY-(.+)\.md$/` (`board.ts:2228`, `:2251`), which admits backticks, spaces and markdown. The slug reaches no shell: the prompt goes to a file, and only its path travels (`idea.ts:601-606`, `:703-716`). It does reach the agent's prompt and the plan's `Story:` line. Decide a slug pattern, e.g. `^[a-z0-9][a-z0-9-]*$`, or refuse. Also place the story line in the server-authored "what this run knows" section, above the quoted issue body (`idea.ts:289-296`), so issue text cannot pose as it.

### 2. Spec claims checked against today's code

- **Confirmed:**
  - `trackerKeyOf` has no caller and matches only Jira-shaped slug prefixes (`packages/domain/src/entities/story.ts:56-59`).
  - Nothing parses `issue:` or `jira:` on a story (`board.ts:2061-2105` reads title, status, author, created and updated only).
  - The template writes `jira:` (`STORY-template.md:4`), and story 3170 has `issue: https://github.com/plot-pm/plot/issues/3170` (`docs/stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md:4`).
  - `POST /api/idea` takes `{number, type}`, with `type` allow-listed.
  - No issue text is interpolated into the `sh -c` fragment, for either route (`idea.ts:601-606`, `:703-716`; `story.ts:502-516`).
- **Imprecise:** "`POST /api/story`: the story it creates carries `issue:`". The route does not write the story (`story.ts:455-522`). It writes a prompt for an agent. The Spec should name the prompt change and treat the result as agent behaviour, which no code gates.
- **Contradicted for the tracker case:** "a key of its configured tracker". Config carries no project (`plot-plan-meta.sh:373-384`), so a cross-project key cannot be told apart from a local one.
- **Pre-existing, on the path this plan routes every story open through.** `StoryModal.renderMarkdown` (`app/components/StoryModal.tsx:14-31`, used at `:217`, `:240` via `dangerouslySetInnerHTML`) escapes `& < >` but not `"`. It emits `href="${rewrittenHref}"` with any scheme passed through by `planRouteOfDocLink` (`packages/domain/src/rules/plan-reference.ts:180-186`). So `[x](javascript:…)` and `[x](a" onmouseover="…)` in a story's Objective or Design become live HTML. Not introduced here, but the story detail view becomes the title link's only destination.
- **`CardFacts` rendering is safe as specified.** There is no raw-HTML sink for card strings, routes are built with `encodeURIComponent` (`app/lib/plan.ts:16-18`, `plan-reference.ts:166`), and `Ref` carries no URL. That holds only while `alerts[].value` and `title` stay text. The Spec does not say so.

### 3. Do the "Done when" criteria prove each slice?

- **Tracer:** yes, for its scope. Both gates are proved by seeded violations.
- **Stories:** only partly.
  - "story 3170's card links ticket #3170" passes on a hand-written `issue:` that already exists, so it proves nothing about `POST /api/story` writing the field or the template change.
  - "a story with an `issue:` to another repository shows `issue-link-unreadable`" proves one negative case. A host-only check, which the Spec's own wording allows, passes it as long as the test uses a different host, while `github.com/someone/else/issues/3170` would still be indexed.
  - Not covered: a look-alike host, a same-host foreign repo, a foreign Jira project key, the placeholder value, and legacy `jira:`.
- **Tickets:**
  - "a ticket linked from two stories shows a disabled *Create plan*" proves the card and not the endpoint. A `POST /api/idea` sent directly, or after a race, with two stories (or an unreadable index) can still create a plan outside the story, and the criteria would stay green.
  - "produces a plan whose `Story:` names it" can be met by asserting the prompt contains the slug while the agent ignores it. Acceptable if stated as "the brief carries the slug". It is not a proof of the plan file.

### 4. Changes before approval

1. **blocking:** Define the `issue:` validator exactly, in the Spec:
   - git-host URLs require host *and* owner/repo equality with the repository, from a named source;
   - the accepted URL shapes;
   - case rules;
   - the normalised index key shared with ticket rows and plan `Issue:` values;
   - for trackers, either a project-key source or an explicit statement that the cross-project guarantee does not hold for keys.

   Add Done-when cases: same host / other repo, a look-alike host, and a foreign tracker key (or the stated limit).
2. **blocking:** Specify `POST /api/idea`'s server-side re-derivation at click time: exactly one live story → brief; ≥2 → refuse `linked-from-many-stories`; story not live → plan outside, as the card says; index unreadable → refuse, never "no story". Add a Done-when that posts directly with two stories and with an unreadable index and gets the refusals.
3. **should:** Build the ticket → story index from the same ref source as `ticketPlansOf` (`origin/<default>` and open drafts), not from the working tree.
4. **should:** Validate the story slug's shape before it enters the idea brief, and put the line in the server-authored section above the quoted issue body.
5. **should:** State that `alerts[].value`, `title` and every `Ref` string are rendered as text only, never as `href` or HTML. Cap `value`'s length. Keep the schema gate's free-string allow-list as is (invariant 1).
6. **should:** Specify `composeStoryPrompt`'s new instruction to write `issue: <host url>`, with the URL passed through the validator first, and a Done-when that asserts the prompt carries it.
7. **could:** Treat the template placeholder (`{…}`) as absent, matching `strip_placeholder`.
8. **could:** File or fix the `StoryModal.renderMarkdown` attribute/scheme injection (`StoryModal.tsx:20-23`) before the story detail view becomes every story title's destination. It is out of scope, but on this plan's path.

### 5. What I did not check, and the evidence I used

**Evidence used:**
- the whole plan file;
- `packages/board/src/server/idea.ts` (prompt composition, refusals, spawn path);
- `story.ts` (prompt composition, spawn);
- `board.ts` story parsing and collection;
- `fleet.ts` `ticketPlansOf` / `ticketLaneData`;
- `skills/plot/scripts/plot-plan-meta.sh` tracker handling;
- `entities/story.ts`;
- `rules/plan-reference.ts`;
- the story template;
- grep for `dangerouslySetInnerHTML`, `href={` and route builders in the board app.

**Not checked:**
- I ran nothing: no tests, and no rendering of the XSS case. The `StoryModal` finding comes from reading the code and is not demonstrated.
- `startBoardRun` / the `agentRun` connector internals beyond the call site.
- `mock-fleet.ts`, `release-smoke.sh`, `plot-ask.mjs board`.
- The CSRF/origin guard on `POST /api/idea` and `/api/story`. I saw the cross-origin refusal at `idea.ts:~475` and did not audit it.
- The `/api/board` response for other data leaks.
- Bitbucket issue URL shapes.
