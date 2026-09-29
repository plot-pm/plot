## Implementation brief — a-row-is-owned-by-more-than-its-pr

- **Plan (canonical):** `docs/plans/2026-09-28-a-row-is-owned-by-more-than-its-pr.md` on `main`
- **Approved:** 2026-09-29, jwloka, in-session
- **Branch:** `bug/a-row-is-owned-by-more-than-its-pr` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code
- **Issue:** #1046 (open)

Single-slice plan. Nothing waits on this branch and it waits on nothing.

### What to build

*Only my work* (`AgentList.tsx:556`, `rowsForReader`) hides a row only where `ownership` answers `theirs`. In production only PR rows ever reach the rule. `ownedFromRow` (`mine-filter.ts:86`) emits `pr` or `other` and never `agent`, so agents, plans and builds answer `unknown` and are kept. Measured on the live board: 17 rows, the filter removes 1, and that row is a bot's (`release/changeset-release/main`). The operator reported it as *"Only my work seems not to work correctly"*.

The fix is wiring, not a new rule. The domain already holds the mechanisms, and nothing gives them their inputs:

1. **Supply a `PersonDirectory`.** `resolvePerson(raw, directory)` (`packages/domain/src/entities/person.ts:42`) takes one, and `ownership.ts:54` calls it with none. The only directory in the estate is `packages/domain/test/person.test.ts:21`. This change is the precondition for every name-based population (see below).
2. **Give `ownedFromAgent` a caller** (`mine-filter.ts:95`, zero callers today). The registry agents render from `fleet.agents` and never pass through `rowsForReader`.
3. **Plans on the Kanban.** There are 341 cards (`App.tsx:687`), and they have no ownership filter at all. Either wire them to the filter, or state in the PR that they stay unfiltered. If you wire them, the PR must answer whether the one checkbox governs both views.
4. **Builds.** A `build` row kind exists (`RowKindSchema`, `contract/schema.ts:1415`; built in `tuple-row.ts:1552`). `ownedFromRow` discards it into `other`. Classify it only where the owner is obvious.

The plan is canonical. This brief is orientation only.

### Settled decisions — do not re-derive them

**The plan's `## Done when` wins over its `## Slices` sentence.** The slice line still reads *"Read `assignee` in `prOwnership`"*. That sentence predates round 1, and round 1 proved it false: `CardPrSchema` (`schema.ts:262-311`) and `AgentRowSchema.pr` (`:2595-2624`) carry no assignee, `/api/fleet` contains the string `assignee` zero times, and `plot-host.sh` never fetches one. `Done when` puts assigned PRs **out of scope** unless the payload gains the field deliberately, and it forbids a new payload field. **Do not add `assignee` to a PR schema, to `PrRecord` or to `pr-list --rich`.** The `assignee` hits at `schema.ts:70/:403` are `PlanMetaSchema`/`CardSchema`, which is a *plan's* `Assignee:` line, not a PR's.

**Spelling resolution comes first, or no name-based population ships.** Across 115 assigned plans the parser reports `jwloka` 60, `Jan Wloka` 51 and `eins78` 4 for one human. With `hostUser = jwloka`, a naive exact match hides 55 of them (48%). That is the exact failure the plan forbids (*"A guess encoded here hides rows a person needed"*). Where the directory's data comes from is the open design question. The predecessor argued against a config key for *identity* (`2026-09-24-the-board-shows-me-only-my-work.md:105`). A spelling directory is a different fact, but the PR must answer that argument explicitly and quote it. Do not assume it away.

**`unknown` stays permissive.** A filter must never hide work it cannot classify. Do not widen `unknown` to hide. Do not change `isMine`'s default. Do not change `agentOwnership`'s rule — wire it only.

**The branch name is never an ownership fact.** `mine-filter.ts:76-79` already refuses `feature/jw-something` as a claim. Branch ownership has no fact on the row today (no author of its own). The predecessor left *"Is an unowned row mine if I dispatched its agent?"* as an open question (`:143`). If the answer is not obvious from a fact the row already carries, defer branches and say why.

**Overturning the predecessor's deferral needs a quote.** The predecessor rejected plan `Assignee:` ownership (option A, `:77-78`) partly because `plot-plan-meta.sh` reported only 71 of 115 lines. That parser defect is fixed (`plot-plan-meta.sh:493`, 115 of 115 now). The PR may reconsider the deferral, but it must quote the argument it overturns.

**Order, and where to stop.** Take the populations in this order: directory, agents, plans, builds, branches. Stop where the answer stops being obvious. A partial PR that names what it left, and why, satisfies the plan.

Rules carried over from the estate:

- **Absent is not false.** `author` is `''` where the host did not answer, and `undefined` on a payload cast from an older server. Both must stay `unknown` and keep the row.
- **The client casts the fleet and never parses it.** A Zod default does not apply client-side, so a field the server omits reaches the renderer as `undefined`.
- **Off returns the array untouched** (`rowsForReader`'s contract). Array identity lets `rowsBySection` memoise. Keep that contract for any new call site.

### Done when

The plan's `## Done when` list is the specification. These assertions exist because a naive implementation passes without them:

- **Assert on the real spellings.** A test that resolves `Jan Wloka`, `jwloka` and `eins78` to one identity catches a directory that covers only the two spellings in `person.test.ts:21`. That test file has no `eins78`.
- **An agent row reaches `agentOwnership`** through the production path, not through a unit call to `ownedFromAgent`. A test that calls the function directly passes while the function still has no caller in production.
- **An explicit test per unclassified population** proves the row answers `unknown` and stays. Silence reads as coverage.
- **A test names `isMine`'s permissive default.** It catches a later change that makes `unknown` hide rows.
- **The PR body lists the populations** it covered and the ones it left. For each one it left, it gives the reason and whether the predecessor's reason still holds.

Repo gates: `nvm use` (Node 24), then `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` (it rebuilds the artifact — commit the rebuilt `skills/plot/scripts/board/board-server.mjs`) and `pnpm run typecheck`. Existing tests to keep green: `packages/domain/test/ownership.test.ts`, `packages/board/test/unit/agent-list.test.ts`, `packages/board/test/integration/mine-filter.browser.test.ts` (browser tests load the built artifact — build first). Domain code uses arrow functions and factual TSDoc (see `CLAUDE.md` › The Domain Package). Add a changeset with the description first: `'@plot-pm/board': patch` for the board. If domain behaviour changes, add a `plot` bump as well. Do **not** run `test:e2e` locally.

### Bookkeeping

- Push the first real commit as soon as it exists — the ref is already claimed at `origin/main`'s tip.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work still changes). Never use `gh pr create`.
- When the PR exists, append `→ #<number>` to the slice heading in the plan's `## Slices` section. In this plan's format the PR goes inside the heading: `(Branch: bug/a-row-is-owned-by-more-than-its-pr, PR: #N)`.
- The PR body closes #1046 only if it covers every population the issue names. Otherwise it references #1046 and names what remains.

### Scope guard

This branch owns:

- `packages/domain/src/rules/ownership.ts`, `packages/domain/src/entities/person.ts` and their tests
- `packages/board/src/app/lib/agent-rows/mine-filter.ts`
- the `mineOnly` wiring in `packages/board/src/app/components/AgentList.tsx` and, if plans are wired, `packages/board/src/app/App.tsx`
- the directory's source (wherever the PR decides it lives, with the argument above)

The following are **out of scope**: `contract/schema.ts` PR/row schemas (no new payload field), `plot-host.sh`, `fleet.ts`'s `PrRecord`, and the branch-name heuristic.

At dispatch (2026-09-29) there were no commits on these paths since the approval. The six W40 plans approved in `ef3c045b` may be in flight at the same time. Check `/plot-pulse` before touching `AgentList.tsx` or `App.tsx`, because those two files are the most-shared in the board.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
