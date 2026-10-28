## Implementation brief — draft-rows-obey-mine (wave 3: Draft rows)

- **Plan (canonical):** `docs/plans/2026-10-28-empty-jira-inbox-read-as-a.md` on main
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2809 merged
- **Branch:** `bug/draft-rows-obey-mine` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention (`Review: pr`)

Wave 3 of 3. Waves 1 (`bug/an-absent-inbox-guesses-no-spelling`, → #2814) and 2
(`bug/ticket-rows-appear-once`, → #2845) are both merged, so this wave is
eligible. Unlike waves 1 and 2, this one touches neither `waiting-tickets.ts`
nor its test — there is no file collision with the merged work, only sequencing
by plan order.

### What to build

With «Mine (Jan Wloka)» on, Draft plan rows stay visible no matter who owns
the plan — observed as three Draft plans that should have hidden on the
reporting board. `draftPlanRows` (`packages/board/src/app/lib/agent-rows/working-agents.ts:133-136`)
only decides which Draft plans get a row at all (one that already has a
branch row is excluded so it isn't shown twice); it says nothing about
ownership. `AgentList.tsx` then renders `drafts` (the `key === 'waiting-on-you'`
arm, `:1176`) straight from that array, with no call to `rowsForReader` or any
other mine-filter — contrast `rowsForReader` (`:1085`, `:726`) and
`boardForReader`, which every other row shape already goes through. Make a
Draft plan row behave like every other owned row: carry an owner, resolve it
through the existing `ownership` rule, and pass through the same filter.

### Settled decisions — do not re-derive them

- **No new precedence.** `ownership({ kind: 'plan', assignee, author, approver }, reader)` already exists in the domain (`packages/domain/src/rules/ownership.ts:135-141` calls `planOwnership`, used at `:267-268` inside the `ownership` switch's `'plan'` case). It answers `mine` where any of the three fields resolves to the reader, `theirs` where none does and at least one is a declared spelling of someone else, `unknown` otherwise. This slice does not touch `ownership.ts` — it only makes a Draft plan row supply the three fields that rule already expects.
- **The fields exist upstream and are being dropped on the floor.** `planEstate` (`packages/board/src/server/board.ts:2911-2937`) already computes `PlanOwnerFields` (`assignee`, `author`, `approver`) into `fieldsBySlug` for every plan it parses, Draft included (`:2928-2932`). But `draftPlanOf` (`:2789-2797`), which builds the `DraftPlan` object pushed into `draftPlans`, takes only `(meta, relPath)` — it has no access to `fieldsBySlug`'s `author`, because that value comes from a separate async lookup (`planAuthors.get(relPath)`, `:2855-2858,2930`) that happens in the caller, not in `meta`. `meta.assignee` and `approverOf(meta.approved_raw)` ARE derivable from `meta` alone (the caller already does exactly this at `:2929,2931` for the non-draft path), but `author` is not — so either thread `author` into `draftPlanOf` as a parameter, or build the owner fields at the call site (`:2933`) the same way `:2928-2932` already does for `fieldsBySlug`, and pass them into the `DraftPlan` literal. Do not call `approverOf` or re-derive assignee logic a second way — reuse exactly what `:2929,2931` already compute for the same `meta`/`relPath`.
- **`DraftPlanSchema` needs the three fields.** (`packages/board/src/contract/schema.ts:4180-4190`.) Add `assignee`, `author`, `approver` as the same shape `PlanOwnerFields` already uses — each a plain string, defaulting to `''` the way `title` does, not `undefined`, so an older server payload the client casts still reads as "no owner" (`''`) rather than crashing a destructure. `DraftPlan = z.infer<typeof DraftPlanSchema>` is what `draftPlanOf`'s return type is checked against, so the schema change and the `draftPlanOf` change land together.
- **The client-side filter reuses `ownedFromCard`'s shape, not a new mapper — unless the field names don't line up.** `ownedFromCard` (`packages/board/src/app/lib/agent-rows/mine-filter.ts:120-121`) already maps `{ assignee, author, approver }` into `{ kind: 'plan', ... }` for plan cards; a `DraftPlan` carrying the same three field names can go through the identical shape. Write the filtering the same way `rowsForReader`/`boardForReader` already do — `on ? drafts.filter(d => isMine(ownedFrom...(d), reader)) : drafts` — rather than inventing a fourth variant of the on/off/untouched-array contract. Reuse `ownedFromCard` directly if `DraftPlan`'s three fields are typed compatibly; only write a new `ownedFromDraft` if the types don't line up without a cast.
- **`unknown` stays visible.** This is a released contract, not a new judgment call: `docs/plans/delivered/the-board-shows-me-only-my-work.md` (released as `2026-09-24-the-board-shows-me-only-my-work.md`) settled that a row whose owner cannot be determined stays, in every row shape. A Draft plan with no `Assignee:`, no resolvable author, and no `Approved:` record reads `unknown`, not `theirs` — it must still show with the filter on. Do not add a stricter default for Draft rows specifically.
- **Filtering happens where the other filters happen — client-side in `AgentList.tsx`, before render, not in `draftPlanRows`.** `draftPlanRows` answers a different question (does this plan already have a branch row) and mixing ownership into it would make that function's existing tests (`draft-plan-row.test.ts`, `a-draft-plans-slices-nest-under-its-plan-row.browser.test.ts`) need re-reading for a concern they don't currently test. Filter `draftRows` the same place `visibleRows` and `boardForReader`'s result are filtered — alongside the `mineOnly` state (`AgentList.tsx:422`) — then pass the filtered array into the `key === 'waiting-on-you'` arm (`:1176`) instead of the raw `draftRows`.
- **Layering.** The ownership judgment is a domain property already (`ownership.ts`); nothing here adds domain code outside `packages/domain/src/rules/` or adds a new rule — this slice is wiring, not a new rule. Keep `draftPlanOf`/`planEstate` changes in `packages/board/src/server/`, the schema change in `packages/board/src/contract/schema.ts`, and the filter change in `packages/board/src/app/`.
- **Style:** any new function you write (a parameter addition is not new code; a small new mapper or filter call is) is an arrow function, per `CLAUDE.md`'s domain-package rule — though note none of these files are under `packages/domain/src/`, so this is the general "function you write or rewrite is an arrow" rule, not the gated one.

### People doc text

Add one sentence to the `People` row's text in the `plot-config.sh` row of
`skills/plot/scripts/README.md` (currently the long paragraph starting "`People`
declares each person's spellings..." at line 30): state that a Bitbucket PR
author is matched by its nickname, as a plain spelling — no new `People`
syntax, just documenting the existing match. This is documentation only; it
does not change `prOwnership` or any adapter.

### Done when

The plan's slice line is the specification: a Draft plan row carries its
`PlanOwnerFields`, `ownership({ kind: 'plan', … })` answers whose it is, and
the row passes the «Mine» filter; `unknown` stays visible; the `People` text
names the Bitbucket nickname match.

Tests, each catching a failure a naive implementation passes without:

- Board unit test (new, alongside `draft-plan-row.test.ts` or in a file
  named for this slice): a `DraftPlan` with `assignee` resolving to the
  reader stays visible with the filter on (catches the filter never being
  wired at all); one with `assignee`/`author`/`approver` all resolving to a
  *declared* spelling of someone else is hidden with the filter on (catches
  a no-op filter that always keeps everything); one with all three empty
  stays visible with the filter on (catches a stricter-than-`unknown`
  default — the regression this slice must not introduce); with the filter
  off, all three stay visible regardless of owner (catches the on/off
  contract breaking).
- `planEstate`/`draftPlanOf` unit test: a Draft plan whose `meta.assignee` or
  author-by-path resolves to a person produces a `DraftPlan` carrying that
  value in `assignee`/`author`/`approver` (catches the fields being computed
  upstream in `fieldsBySlug` but never reaching the `DraftPlan` object —
  the actual defect described above).
- Schema test or type-check: `DraftPlanSchema` accepts and defaults the three
  new fields the way `title` defaults to `''` (catches a payload from a
  server that predates this change failing to parse — it must still parse,
  with the three new fields reading `''`).
- Browser test (optional if the unit tests above already exercise the
  render path through `drafts`): confirm a Draft row rendered under
  *Waiting on you* disappears with «Mine» on when owned by someone else, and
  stays when unowned — extending `draft-plan-row.browser.test.ts` or
  `mine-filter.browser.test.ts` rather than writing a third browser
  harness for the same page.

Plus the repo gates: `node skills/plot/scripts/board/plot-local-checks.mjs`
before each push, and run what it prints; the suites in the `CI suites` key
run in CI, and a failure there comes back as a correction. List no full
suite. Add a changeset (description first, `bumps:` block last, a `plan:`
line naming this plan inside the block) per `CLAUDE.md` Versioning — this
touches `packages/board`, so the changeset's package is `@plot-pm/board`.
Rebuild the board artifact locally if you want to see the change render
(`pnpm build:board`), but do not commit the rebuilt bundle
(`scripts/check-no-bundle-diff.sh` refuses a PR carrying one) — `main`
rebuilds it after merge. This slice should touch no `.sh` file, so
`scripts/check-shell-lines.sh` is not in play.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it
moves), never `gh pr create`. When it exists, append `→ #<number>` to this
branch's line in the plan's `## Slices` section. Push the first real commit
as soon as it exists.

### Scope guard

This branch owns: `draftPlanOf` and its caller in
`packages/board/src/server/board.ts`, `DraftPlanSchema` in
`packages/board/src/contract/schema.ts`, the Draft-row filtering added in
`packages/board/src/app/components/AgentList.tsx` (and
`packages/board/src/app/lib/agent-rows/mine-filter.ts` only if a new mapper
is genuinely needed), the `People` sentence in
`skills/plot/scripts/README.md`, the new/extended tests named above, and a
changeset.

Not this branch: `waiting-tickets.ts`, `waiting-tickets.test.ts`,
`fold-issue-rows.ts`, `issue-write-through.ts`, and anything in
`packages/fleet` — those belong to waves 1 and 2, both already merged, and
nothing here should touch them again. The out-of-scope item the plan names
explicitly — «Mine» hiding `unknown` rows behind a count, and an
*Unassigned* section — belongs to its own feature plan; do not fold it into
this slice even if it looks like a two-line addition from here.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
