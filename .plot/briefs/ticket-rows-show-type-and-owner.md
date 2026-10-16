## Implementation brief — ticket-rows-show-type-and-owner (wave: Ticket rows)

- **Plan (canonical):** docs/plans/2026-10-16-ticket-rows-show-type-and-owner.md on main
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1842 merged
- **Branch:** `feature/ticket-rows-show-type-and-owner` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** standard PR review (plan `Review:` = pr)

This is the plan's only branch — no sibling to wait on and nothing waits on it.

### What to build

Issue #1837: the four ticket rows under *Waiting on you* look alike. Every row's slot 2 reads the fixed word `Ticket` (`KIND_LABEL.ticket`, `packages/board/src/app/lib/tuple-row.ts:142`), and no row shows the tracker's type (bug, feature, …) or who owns it — the Discovery tab's ticket card already shows both (#1766, #1782, delivered in `ticket-cards-show-type-and-owner`).

Add `type`/`owner` to the *Waiting on you* ticket rows via the same domain rules the Discovery card uses, replace the repeated per-row `Ticket` label with one `Assigned to you · N` sub-header above the block, and move the existing hidden-count line under it in a smaller style.

### The decisions the plan settles — do not re-derive them

**The Discovery-card machinery already exists and is proven — reuse it, do not re-derive type/owner resolution.** `ticket-cards-show-type-and-owner` (delivered) added `type: string | null` and `owner: string | null` to `TicketLaneRow` (`packages/domain/src/rules/ticket-lanes.ts:6-23`) and to `ticketCardView`'s return (`packages/domain/src/rules/ticket-card.ts:116-130`). `IssueIndexRow` (`packages/domain/src/entities/issue-index.ts:38`) already carries an optional `type: string`. **The owner resolution logic is a private, unexported function** — `ownerOf` (`ticket-lanes.ts:80-88`), which takes `(assignees, { source, directory })` and returns the resolved handle or the raw spelling or `null`. It is not reachable from `waiting-tickets.ts` as written. Either export `ownerOf` from `ticket-lanes.ts` (simplest, smallest diff) or lift it one level if the plan's design intends a shared helper — but do not write a second resolution function; `ticket-cards-show-type-and-owner`'s brief already warned against exactly that duplication, for the Discovery card, and the warning applies again here.

**`WaitingTicket` and `IssueRow` do not carry `type`/`owner` today — this is additive, not a passthrough.** `WaitingTicket` (`packages/domain/src/rules/waiting-tickets.ts:5-16`) has no `type` or `owner` field, and `toWaitingTicket` (same file, line 39) does not set them. `IssueRowSchema` (`packages/board/src/contract/schema.ts:3451`) has no `type` or `owner` field either. Both need the two new fields added, following the same "absent, never defaulted to a guess" rule the rest of the row already follows (`status`/`statusCategory` use `.default('')` because the tracker's empty answer IS meaningful; `type`/`owner` should be `nullable()` — a ticket genuinely has no type or no owner, which is different from the tracker not being asked).

**`waitingTickets` needs `source` and `reader.directory` to resolve `owner`, and already receives both.** `waitingTickets(rows, inbox, reader, source, complete)` (`waiting-tickets.ts:109`) already takes `reader: Reader` (which carries `directory`) and `source: TicketSource | null` as parameters — the same two inputs `ownerOf` needs. No new parameter threading is required; `toWaitingTicket` just needs `source`/`reader.directory` passed down from the call sites already inside `waitingTickets`, not threaded in fresh from a caller.

**The per-row label to drop is `KIND_LABEL.ticket`, not a literal string search.** There is no bare `"TICKET"` string anywhere in `AgentList.tsx` or `rows.tsx` — grepping for one finds nothing. The rendered word comes from `tupleFromIssue` (`packages/board/src/app/lib/tuple-row.ts:1188-1192`) setting `kindLabel: KIND_LABEL.ticket`, where `KIND_LABEL.ticket = 'Ticket'` (`tuple-row.ts:142`, comment there is stale — it still says the label "said Story until 2026-08-20" but the live value today is `'Ticket'`). Dropping the per-row label for the *Waiting on you* block specifically means either passing a flag so `IssueRowView`/`tupleFromIssue` can render an empty slot-2 string in this one context, or rendering the ticket rows under the sub-header through a variant that skips the kind cell — whichever keeps the Discovery tab's own ticket rows (which still want `Ticket` as their kind label, since they are not grouped under a sub-header) unaffected. Check whether `tupleFromIssue`/`IssueRowView` is called from anywhere besides the *Waiting on you* block before changing its default.

**The plan cites `rows.ts`; the file is `rows.tsx`.** `AgentList.tsx` imports `IssueRowView` from `../lib/agent-rows/rows.js` which compiles from `rows.tsx` — a `.tsx` file, not `.ts`. Not a design decision, just save yourself the `find` that comes up empty.

**Rule carried over unchanged: absent is not false.** Per `IssueIndexRow`'s and `Issue`'s own doc comments, a field the tracker never answered is modeled as absent/`null`, never as an empty string or a guessed default. `type`/`owner` follow this on every new field they touch (`WaitingTicket`, `IssueRow`, and whatever intermediate shape carries them).

**The Open Questions are genuinely open — do not pick silently.** Three unresolved in the plan: (1) whether the sub-header still reads "Assigned to you" when *show every ticket* is on or the reader is unmatched (it would then hold tickets not actually assigned to the reader); (2) same question for the unmatched-reader fallback path (`waiting.notice` set); (3) whether a ticket with no type or no owner renders no badge or a placeholder (the Discovery card already answered this — no badge — so question 3 likely resolves by precedent, but say so explicitly in the PR rather than assuming). If these matter to the implementation, flag them in the PR description; do not resolve them by implementing one option unreviewed.

### Done when

The plan's `## Done when` is implicit in its Changelog line and Design section. Concretely:

- `waitingTickets`/`toWaitingTicket` return `type: string | null` and `owner: string | null` per ticket, resolved the same way `ticketCardView` resolves them for Discovery — unit-tested for: a resolved handle, an unresolved raw spelling, and an unassigned ticket (per the plan's own "Unit tests … carry the decision" line).
- `waitingView` gains the `Assigned to you · N` sub-header text and count, unit-tested with the *show every ticket* control both on and off (the plan names this explicitly as a `waitingView` test, not a browser test).
- `AgentList.tsx` renders the tickets under the one sub-header, drops the per-row `Ticket` kind label for this block only, and moves the hidden-count line under the sub-header in a smaller type style — a regression test or screenshot proving the Discovery tab's own ticket rows (if any share `IssueRowView`) still render their kind label unchanged, since this slice must not silently remove it everywhere `tupleFromIssue` is called.
- One browser test shows the sub-header and a row's type and owner rendered together (the plan names exactly one browser test — do not add more; `CLAUDE.md`'s *Every rendered state is a domain property* means the decision logic is proven in the unit tests above, and the browser test only proves it reaches the screen).
- A ticket with no type and no owner renders the row exactly as it does today — pinning the regression the naive implementation would miss: adding the two fields without the null-rendering path would show an empty badge instead of none.

Plus: `node skills/plot/scripts/board/plot-local-checks.mjs` run before each push, and whatever it prints — related domain/board tests and typecheck for touched packages. The `CI suites` config key (`pnpm run test:e2e`, `test:contracts`, `test:board`, domain coverage, `test/reconcile/*.test.mjs`) runs in CI on this PR; do not run `test:e2e` locally — it dispatches real workers into sandbox repos and is CI's gate, not a local one.

Name the shell gate explicitly only if this slice ends up touching a `.sh` file under `skills/` (unlikely — this is a TypeScript-only change across domain and board): `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows past its merge base.

A contract change (`IssueRowSchema` gaining fields) means rebuilding the board artifact before testing locally — see `CLAUDE.md`'s board-artifact-conflict procedure if a rebase or merge produces a conflict in the generated bundle; never commit a rebuilt bundle to the PR (`scripts/check-no-bundle-diff.sh`).

### Bookkeeping

Open the PR through the controller once the first real commit exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Do not run `gh pr create` — it has no access to the plan/wave title the controller derives. When the PR is created, append `→ #<number>` to this branch's line under `### Ticket rows` in the plan's `## Slices` section.

### Scope guard

This branch owns: `packages/domain/src/rules/waiting-tickets.ts`, `packages/domain/src/rules/ticket-lanes.ts` (only if `ownerOf` is exported rather than duplicated — a one-line change, not a rewrite), `packages/board/src/contract/schema.ts` (`IssueRowSchema`/`FleetWaitingSchema` additions), `packages/board/src/app/lib/agent-rows/waiting-view.ts`, `packages/board/src/app/components/AgentList.tsx` (the *Waiting on you* block only), and `packages/board/src/app/lib/tuple-row.ts`/`rows.tsx` only to the extent the per-row label needs a way to be suppressed for this one call site.

Do not touch `packages/domain/src/rules/ticket-card.ts` or the Discovery tab's `StoriesTab.tsx` — that machinery is already delivered and this slice only consumes it. This plan has no sibling branch in flight; there is no other slice to collide with.

If you find something the plan did not anticipate — in particular if suppressing the per-row label turns out to require a wider change than a flag (for example if `IssueRowView` is shared with a context this plan did not mean to touch) — report it rather than improvising outside scope.
