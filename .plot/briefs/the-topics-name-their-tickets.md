## Implementation brief — the-discovery-tag-cloud-is-built (wave 1: Topics)

- **Plan (canonical):** docs/plans/2026-10-14-the-discovery-tag-cloud-is-built.md on main
- **Approved:** 2026-10-14, Jan Wloka, plan-PR #1692 merged
- **Branch:** `feature/the-topics-name-their-tickets` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention; the PR is reviewed as code

This is wave 1 of two. Wave 2, `feature/the-lanes-filter-by-topic`, waits on this branch and on `feature/the-discovery-ticket-card-shows-its` — it renders the lane filter this wave's topics feed. Nothing else in flight touches `packages/board/src/server/topics.ts` or its call site (checked 2026-10-14).

### What to build

Today `extractTopics` (`packages/board/src/server/topics.ts`, called at `packages/board/src/server/board.ts:2466`, not line 2440 as the plan's Motivation section says — the call site has moved since the plan was drafted) takes only `StoryDocument[]` — `slug`, `title`, `planTitles` — and returns `TopicEntry[]` with `storySlugs`. It never sees a ticket. `StoriesTab.tsx`'s `topicToSlugs` filters story lanes from `storySlugs`; the ticket lanes (Open, In progress, Done) ignore the selection entirely, and a subject that only a ticket's title carries never becomes a chip.

Build the input and output wider, not the filtering logic narrower:

1. **Widen `StoryDocument` or add a sibling ticket-input type** carrying ticket `title` and `number` (the issue index's own key — see Decisions below) for each ticket the board already holds. Thread story file text in beside title and plan titles: `parseStoryContent` (`board.ts:1663`) already reads it via `fs.readFileSync(absPath, 'utf8')` for the story page; the call site at `board.ts:2466` passes only `title` and `planTitles` today and needs to pass the content too.
2. **Extend term extraction** (`extractCompounds`, `extractBigrams`, `keywordsFromSlug`) to run over ticket titles the same way it runs over plan titles — a ticket title yields terms as a plan title does, compound terms included (plan Decisions).
3. **Make `TopicEntry` carry `ticketKeys` beside `storySlugs`,** and fold ticket matches into `topicToStories`-equivalent bookkeeping so a topic found only in tickets still surfaces.
4. **Apply the "every row" exclusion across stories and tickets together,** not per-collection — a topic in every story and every ticket is dropped; one in every story but only some tickets stays (plan Decisions). `count` is matching stories plus matching tickets.
5. **`board.ts:2466`'s call site passes tickets into `extractTopics`.** The board already builds an issue-index-backed ticket list elsewhere (`fleet.ts`, `IssueIndexRow` — `.number` is the tracker's own key, `.title` its title); find the shape already assembled for the ticket lanes and reuse it rather than re-deriving a ticket list here.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

- **Story text is the story file the board already reads, not a new file read.** Pass it through the existing `parseStoryContent` read path (`board.ts:1649`); do not open `docs/stories/**` a second way.
- **The ticket body stays out.** The issue index (`IssueIndexRow`, `packages/domain/src/entities/issue-index.ts:36`) holds no body text — only `number`, `title`, `url`, and status/date fields. The plan is explicit that only the title contributes; there is nothing else to read even if you wanted more.
- **The "every row" rule counts stories and tickets together, as one denominator.** `allTopics.filter((t) => !NOISE_TERMS.has(t.topic) && t.count < stories.length)` in the current code compares only against `stories.length`; the combined version compares against `stories.length + tickets.length`, and a topic's `count` sums both kinds of match — not two separate exclusion passes.
- **`maxTopics` and the existing noise/stop-word filtering are kept, not replaced.** This is additive to `extractTopics`'s existing shape (multi-occurrence preference, compound-over-single preference), not a rewrite of its ranking.
- **This slice does not touch the group-toggle behavior** (plan Decisions: "the cloud counts only the groups on screen" for #1693) — that is a later concern layered on top once the toggle slice lands; do not pre-build a groups-visible parameter here unless the toggle slice is already in main when you start (it is not, per the plan's Order note).
- **Style:** `packages/board` keeps its existing function-declaration style (507 declarations to 6 arrows measured 2026-08-29) — do not convert `extractTopics` or its helpers to arrows. A new helper you write in this file follows the file's own convention, not the domain package's arrow rule, because `topics.ts` is not under `packages/domain/src/`.
- **Every rendered state is a domain property.** `ticketKeys` and the widened `TopicEntry` are the only things `StoriesTab.tsx` (wave 2) is allowed to read to decide which ticket rows a topic narrows — do not leave that decision in the component for wave 2 to improvise around; this wave's output shape is the contract wave 2 renders.

### Done when

The plan's `## Design` section is the specification: each topic carries `storySlugs` and `ticketKeys`; the cloud stays bounded by `maxTopics` with existing stop-word/noise filtering intact; a ticket title yields terms as a plan title does; the "every row" rule counts stories and tickets together; `board.ts` sends the result.

The assertions that exist because a naive implementation would pass without them:

- **A topic matched only by tickets (no story) must still appear.** A naive port that only widens the exclusion denominator but keeps iterating `stories` for term collection would silently drop ticket-only topics. Assert a fixture where one ticket title contains a term no story title or plan title carries, and the returned topics include it with an empty `storySlugs` and a non-empty `ticketKeys`.
- **The "every row" exclusion uses the combined count, not either collection's count alone.** Fixture: a term present in every story but only half the tickets must survive; a term present in every story AND every ticket must not.
- **`count` sums both kinds of match for a single topic**, not just whichever collection contributed more entries — assert on a topic matched by 2 stories and 1 ticket that `count === 3`.
- **Story file text contributes terms independently of title and plan titles** — a term appearing only in story body text (not title, not slug, not plan titles) must surface as a topic, proving the new content parameter is actually read rather than accepted and ignored.

Plus: bump the board package through a changeset in `.changeset/` using `'@plot-pm/board': patch` frontmatter (or `minor` if the `TopicEntry`/`StoryDocument` shape change is API-visible beyond this package — judge by whether anything outside `packages/board` imports these types), with no `bumps:` block. Copy the format from an existing board-only changeset in git history. The board artifact is generated: commit no bundle (`scripts/check-no-bundle-diff.sh`). Run `pnpm build` in `packages/board` before any browser test so it loads a fresh artifact. Under Node 24 (`nvm use`).

Run `node skills/plot/scripts/board/plot-local-checks.mjs` (resolved from `skills/plot/scripts/`) before each push and run what it prints. The suites in the `CI suites` config key run in CI on every PR; a failure there comes back as a correction. Do not run `test:e2e` locally — it is CI's gate.

This slice should touch no `.sh` file. If it does, `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base; pay for growth in the same change by removing shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line under `## Slices` in the plan.

### Scope guard

This branch owns:

- `packages/board/src/server/topics.ts` (the widened input/output shape and term extraction)
- the `extractTopics` call site in `packages/board/src/server/board.ts` (around line 2466) — wiring tickets and story content in
- new tests under `packages/board/test/` for the widened function
- one changeset

It does not touch `StoriesTab.tsx` or any lane-filtering component — that is wave 2's `feature/the-lanes-filter-by-topic`, which consumes this wave's `ticketKeys` output. It does not touch the issue index schema, `plot-host.sh`, the plan format, the plan template, or helper scripts (plan Board impact note). If you find something the plan did not anticipate, report it rather than improvising outside scope.
