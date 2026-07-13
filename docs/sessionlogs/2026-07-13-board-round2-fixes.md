# Board round-2: mobile badge wrap, inline-sprint filter, tiny-garden + real-browser tests

**Date:** 2026-07-13
**Scope:** Two board UX bugs surfaced by live-preview dogfooding, a reduced integration-test fixture, and a real-browser (Playwright) test layer — all landed in the existing board PR (#40), not a new one.
**Branch:** `idea/kanban-board-v1` (PR #40)

## Why one PR

A live preview of the board (PR #40) against two real Quatico adopter repos
surfaced two UX bugs. A third, config-parsing bug had already been split into its
own PR (#42) — which, on reflection, it should not have been. The rule going
forward: **keep follow-up work in the same PR unless there's a reason to split.**
So #42 was folded in (its single commit cherry-picked) and closed as redundant,
and the two UX bugs + test infrastructure joined it here.

## The two UX bugs

**(a) Long badge → horizontal page scroll on mobile.** Badges were
`whitespace-nowrap` with no max width. A long sprint/story slug therefore had a
min-content width equal to its whole text; grid/flex ancestors default to
`min-width: auto` and refuse to shrink below a child's min-content, so one long
badge propped the entire column — and the page — open on a phone.

*Fix* (`badge.tsx`): drop `whitespace-nowrap`; add `max-w-full [overflow-wrap:anywhere]`.
`overflow-wrap: anywhere` collapses an unbroken slug's min-content to ~1 char, so
every ancestor shrinks normally and the badge wraps within the card. (No `min-w-0`
on ancestors was needed — the real-pixel test confirmed the badge fix alone
clears the overflow.)

**(b) Sprint filter hidden despite inline sprints.** `App.tsx` derived both the
sprint options and the filter's visibility solely from `board.sprints` (the
sprint *directory*). A repo that tracks sprints inline on plans (a `Sprint:`
line) but has no `docs/sprints/` tree — like the adopter that surfaced this —
got no sprint filter at all, even though 5 plans carried sprint values.

*Fix*: a pure, unit-tested seam `sprintFilterOptions(board)` in `filters.ts`
unions the sprint directory (which carries human titles) with the distinct
`card.sprint` values found across the columns (directory title wins on a slug
collision; inline-only sprints fall back to their raw slug). `App.tsx` uses it
for both the options and `hasSprints`. **Client-side only — no `/api/board`
schema change.** The API already carries `card.sprint`; the client composes the
filter. A consequence worth stating: bug (b)'s fix is observable only at the
render layer, never in `/api/board` — which is exactly why the browser test
below is load-bearing.

## tiny-garden fixture

`packages/board/test/fixtures/tiny-garden/` is a reduced, backyard-garden-themed
stand-in for a real adopter repo:

- **Prose `CLAUDE.md` config** with backtick-quoted values + trailing prose, and
  deliberately **no `Sprint directory` key** — exercises the #42 parser and
  drives bug (b).
- **9 plans, 8 board-eligible** (Draft 2 / Approved 2 / Delivered 3 / Released 1),
  the 9th `Rejected` to verify exclusion; mixed frontmatter and `## Status`
  styles.
- **3 distinct inline sprints**, one deliberately very long
  (`the-great-heirloom-tomato-and-zucchini-overplanting-recovery-initiative`) for
  the badge-wrap test; **2 unknown-type plans** (one `type: chore`, one no type)
  that render as neutral `unknown` badges; **3 stories** in `docs/stories/`.

## Test strategy — vitest alongside node:test

The proven `node:test` artifact suite (`test/*.test.mjs`) is kept untouched.
Vitest is added **alongside** for the tiny-garden work, in `test/{unit,integration}/`:

- **Unit** (`filters.test.ts`): `sprintFilterOptions` in isolation — inline-only
  derivation, directory-title precedence, union, dedup, empty/null.
- **Data layer** (`tiny-garden.data.test.ts`): spawns the built artifact against
  the fixture (real server + real `plot-config.sh` / `plot-plan-meta.sh`) and
  asserts column counts, Rejected exclusion, empty `board.sprints` with inline
  `card.sprint` present, `unknown` types, and story discovery. The counts also
  guard the #42 config parse (a mis-parse would find 0 plans).
- **UI layer** (`tiny-garden.browser.test.ts`): drives a **real browser
  (Playwright)** against the shipped artifact's served page at a 390px viewport —
  asserts no horizontal overflow with the long badge present (bug a), that the
  sprint filter is visible (bug b), and that selecting an inline sprint narrows
  the board to the expected 2 cards (bug b, functional).

### Why not vitest "browser mode"

Vitest browser mode runs the test file inside a Vite-served page and renders
*recompiled* components — it can't `goto` the shipped artifact's served page and
keep the test context. A pixel-overflow assertion there would measure recompiled
components, not what plot ships, which is meaningless for bug (a). So the UI layer
uses vitest as the runner (node env) plus the **Playwright node API** to render
the real artifact. Max's intent — real browser, real pixels, real artifact — is
exactly met; only the specific vitest feature differs, and this is strictly more
faithful.

## Wiring

- `packages/board`: `test:integration` = `pnpm build && vitest run` (build first
  so the browser test never runs against stale bundled bytes).
- Root `test:board` = build → `node:test` → `vitest run`.
- CI (`ci.yml`): a `playwright install --with-deps chromium` step + a vitest
  integration step, after the existing board build/freshness and node:test steps.

## Verification

- `pnpm test:reconcile` **37/37** (includes the folded #42 config case).
- Board `node:test` **8/8**; vitest **13/13** (5 unit + 5 data + 3 browser).
- `pnpm typecheck` clean; artifact rebuilt and committed (CI freshness gate).
- Both live preview servers restarted on the fresh artifact so the fixes are
  visible on real adopter data.

## Notes

- No new changeset: the board is not changeset-managed (its version is
  hand-pinned), and no skill changed here except `plot-config.sh` — already
  covered by #42's changeset, which came along in the fold.
- Board version left at `1.0.0-rc.1`: nothing has shipped yet; this is all one
  unreleased PR.
