# Panel: every-plan-reference-shows-its-issue

Round 1, 2026-11-01. Subject: `docs/plans/2026-11-01-every-plan-reference-shows-its-issue.md` (plan PR #2994, issue #2993). Four jurors, one rubric, lens as the only variable. Line numbers are against `origin/main` 251b2abfc.

**Reconciliation:** `unanimous amend` (layering, safety, testability, seams).

## What each juror looked at

- **layering:** read `App.tsx`, `rows.tsx`, `TupleRow.tsx`, `tuple-row.ts`, `server/fleet.ts` and the domain's view rules. Measured the saved payloads: `board.json` 794,765 bytes against `fleet.json` 88,201 bytes, issue arrays at 2,825 bytes over 596 cards, and 14 of 14 fleet plans with a card. It was the only juror to weigh how late `/api/board` arrives.
- **safety:** read every producer of `what: 'plan'` and the controls that print a slug. Measured the saved payloads: 51 fleet rows, 44 with a plan, 0 without a card; 298 of 596 cards with issue keys and 28 with two or three; no two cards share a slug or a basename. Ran `git grep "blob/"` and found no git-host link.
- **testability:** counted the `/plan/` href builders with `git grep` (9 sites in `packages/board/src/app`) and the existing tests that read the old texts and hooks (37 lines in `tuple-row.test.ts`, 6 selectors in 5 browser files). Resolved every reference kind against the cards with `node -e`: 44 of 44 rows, 44 of 44 slices, 14 of 14 sprint members, 75 of 77 story refs.
- **seams:** measured file sizes and commit churn (`tuple-row.ts` 1674 lines, `rows.tsx` 2893 lines; `fleet.ts` 22 commits and `schema.ts` 16 commits since 2026-10-25), read the files of open PR #2992, and counted 14 test files that name the helpers and 26 `'/plan/` assertions in `packages/board/test`. Checked every line number the plan cites; one was off.

Every juror measured something. All four used the same two saved payloads, so their resolution counts agree because they share one sample, not because four samples agree.

## Agreed findings

1. **The plan names no layer for the decision.** The label rule (`planNameLabel`, `tuple-row.ts:1278`) and the existence rule (`planFile ? href : ''`, four copies) live in the board's `lib/`. The rule belongs in `@plot-pm/domain`, beside `rules/plan-link-click.ts`. (all four)
2. **The git-host claim is false.** `PlanLink` without `onOpenPlan` opens the board's own `/plan/<file>` route in a new tab (`rows.tsx:372-374`). No surface links the git host. Open Question 2 therefore chooses an open mode, not a target. (all four)
3. **The plan misses sites.** `planHref` (`lib/plan.ts:13`), `rewritePlanLink` (`StoryModal.tsx:12-16`), the `App.tsx` fallbacks at `:952`, `:965`, `:980`, and the plan modal heading. layering adds `WorkerLogModal.tsx:108`, `:319` and `Swimlanes.tsx:244`; seams adds `server/board.ts:3186`. (layering, testability, seams; safety names `PlanModal` and the mixed-group heading)
4. **One slice is too large.** Every juror proposed a split into two to four slices, each deleting the helpers whose last caller it moves. (all four)
5. **The "Rebuild the board artifact" note contradicts CLAUDE.md.** A PR carries no generated bundle. (safety, seams; layering and testability did not address it)
6. **The name is the slug with the prefix, and the target is the in-app route.** All four recommended `1090: slug` with the title as hover text, and `/plan/<file>` with a plain click intercepted through `planLinkClick`.

## Disagreement

**Where the issue keys come from.** seams, testability and safety recommend one client-side lookup over the board's cards (and, for safety and seams, `fleet.draftPlans`): it resolved 44 of 44 rows, adds no bytes and no server work, and keeps every slice out of `server/fleet.ts` while the plan walk lands there. layering requires one plan index on the `/api/fleet` payload: the cards come from `/api/board`, which takes 4.4 to 4.9 s and can stay `null` (`App.tsx:123-146`), so a card lookup cannot meet rule (i) "always" on the Delivery tab. safety saw the same delay (finding 10) and judged it a late prefix, not a failure. The difference is whether "always" includes the seconds before `/api/board` arrives and the time while it fails. layering read it that way and the other three did not.

**Operator's decision:** both. The domain rule takes a plan index as a value. Slices 1 to 3 build it on the client from cards and drafts, as the three jurors proposed, so no early slice touches `server/fleet.ts`. Slice 4 adds the index to `/api/fleet`, as layering required, and waits on slice 3 and on the plan walk's `feature/scan-once-walks-in-process`, which edits `server/fleet.ts`. Seams' collision concern holds the order; layering's finding holds the outcome.

## Points one juror raised

- **layering:** three `onOpenPlan` signatures, `(card)`, `(file) => boolean` and `(slug)`; the `(file) => boolean` form is the standard. A fourth, `(planFile) => void`, exists at `WorkerLogModal.tsx:108`, which no juror named as a signature. `TupleRow.tsx:414` decodes the plan file back out of the href. The gate comment at `tuple-row.ts:1326` is stale. Issue keys have two sources (`number | string` and `string[]`), so the rule must normalise them.
- **safety:** `what: 'plan'` has three meanings; a slice's own name, text inside a button and a grouped branch row must stay non-links, and `agents-tab.browser.test.ts:545` guards the last. A Draft plan has no card, so a click on it navigates instead of opening the panel. A three-key prefix truncates away the slug, and two plans share issue 1090.
- **testability:** rule (i) cannot be proven by grep, because the rogue sites print raw fields; one catalogue browser test that searches by text proves it. `ROW_NAVIGATION` at `agent-list.test.ts:3398` permits a hand-built `/plan/` anchor. The `planNameLabel` and `planHref` tests must move to the domain, including the Windows-path case.
- **seams:** `AgentList.tsx` is the one file two migration slices both touch, so the panel slice waits on the row slice. The document-link rewriter in `server/board.ts` is server code and needs a scope decision.

## Shared blind spot

No juror checked accessibility beyond the existing accessible-name form. safety noted that `linkLabel` gives `Plan 1090: slug` and that a title link adds a tab stop, but nobody asked what a truncated slug means for a keyboard user. The decided design puts the full text in a `title` tooltip, which appears on mouse hover only, so a sighted keyboard user who focuses a truncated reference cannot read the full slug. The amended plan keeps the accessible name starting with the visible text (`Plan <label>`), so a screen reader announces the full label, and it names the hover-only tooltip as a known limit.

Jira keys were checked: testability gives a Jira row in its table and safety notes a Jira key is not confused with a PR number. No juror looked at a mixed key list (a GitHub number and a Jira key on one plan) or at the `#` prefix that `PlanMetaSchema`'s `number | string` allows; the amended rule strips a leading `#` and keeps keys as stored.

## Amendments made to the plan

1. `### Approach` written: `rules/plan-reference.ts` (`planIndexOf`, `planReference`, `planRoute`, `planRouteOfDocLink`) decides; `PlanReference.tsx` renders; one `onOpenPlan(file) => boolean`.
2. The three Open Questions closed with the operator's decisions, recorded under `### Decisions` with the juror reasoning.
3. Scope stated: what counts as a plan reference, what is the plan itself, and what is excluded.
4. The missed sites named: 10 `/plan/` builders, including `server/board.ts:3186`, which is in scope for its href and out of scope for its prose text.
5. Four slices with `waits:`, each naming the helpers it deletes. Slice 4 waits on slice 3 and on `feature/scan-once-walks-in-process`.
6. Two gates: `scripts/check-plan-routes.sh` for rule (ii), domain unit tests and one catalogue browser test for rule (i).
7. The existing tests that change are named and counted; the moved tests are named.
8. The git-host claim and the related-plan description corrected; the "Rebuild the board artifact" note replaced by the no-bundle rule.
9. A `## Done when` table maps every Changelog claim and both user rules to a test. `- **Rounds:** 1` added to `## Status`.
